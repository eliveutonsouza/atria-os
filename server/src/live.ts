import { SidebandWS } from 'openai/resources/live/sideband/ws';
import type OpenAI from 'openai';
import type { RunInfo } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { emit, setYuiState } from './bus.ts';
import { openai, recentMessages, saveMessage, think } from './brain.ts';
import { runBus } from './runs.ts';
import { agentsWorking } from './agents.ts';

// Yui por voz = GPT-Live-1 (o mesmo modelo full-duplex do ChatGPT Voice/Codex).
// Browser <-> OpenAI por WebRTC (áudio). Este servidor acompanha a sessão por um sideband WebSocket:
// guarda transcrições, atende delegações (client delegation) chamando o cérebro e narra o trabalho dos agentes.

const LIVE_INSTRUCTIONS = `Você é a Yui, assistente pessoal de IA do ${config.userName}. Fale português do Brasil.
Personalidade: calma, presente, precisa, levemente calorosa. Frases curtas. Nunca leia listas longas nem números demais; resuma.
Você conversa; o trabalho e as consultas são feitos pelo seu backend. Delegue SEMPRE que o usuário:
- pedir para ver/abrir/mostrar algo na tela (dashboard, agentes, execuções, projetos, logs, relatório, site, VPS),
- perguntar status, números ou fatos do ambiente,
- pedir qualquer trabalho (corrigir, criar, pesquisar, revisar, publicar, agendar),
- disser "volta", "fecha", "tela cheia", ou mudar de projeto.
Enquanto o backend trabalha, mantenha a conversa natural (ex.: "Deixa eu ver."), sem inventar resultados.
Quando receber resultado do backend, diga-o com naturalidade, sem repetir palavra por palavra.
Papo leve, cumprimentos e esclarecimentos você responde direto, sem delegar.`;

interface LiveState {
  sessionId: string;
  sideband: SidebandWS;
  muted: boolean;
  userBuf: string;
  yuiBuf: string;
  pendingRequest: string;
  lastActivity: number;
  speakingTimer?: NodeJS.Timeout;
  lastProgressNote: Map<string, number>;
}

let live: LiveState | null = null;
export const liveActive = () => !!live;

function flushUser() {
  if (!live || !live.userBuf.trim()) return;
  const text = live.userBuf.trim();
  live.pendingRequest = `${live.pendingRequest} ${text}`.trim();
  saveMessage('user', text, 'voice');
  emit({ type: 'user.said', text, final: true });
  live.userBuf = '';
}

function flushYui() {
  if (!live || !live.yuiBuf.trim()) return;
  const text = live.yuiBuf.trim();
  saveMessage('yui', text, 'voice');
  emit({ type: 'yui.say', text, final: true });
  live.yuiBuf = '';
}

function seedInput(): OpenAI.Live.InitialItem[] {
  return recentMessages(30).map((m) =>
    m.who === 'user'
      ? ({ role: 'user', type: 'message', content: [{ type: 'input_text', text: m.text }] } as OpenAI.Live.InitialItem)
      : ({ role: 'assistant', type: 'message', content: [{ type: 'output_text', text: m.text }] } as OpenAI.Live.InitialItem),
  );
}

export async function startLive(offerSdp: string): Promise<{ sdp: string; sessionId: string }> {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY ausente');
  if (live) endLive('replaced');
  const res = await openai.live.create({
    session: {
      model: config.liveModel,
      instructions: LIVE_INSTRUCTIONS,
      audio: { output: { voice: config.voice } },
      input: seedInput(),
      delegation: { type: 'client' },
      client: {
        data_channel: {
          allowed_client_events: ['session.input_audio.mute', 'session.input_audio.unmute'],
          allowed_server_events: [
            { type: 'session.started' },
            { type: 'session.input_transcript.delta' },
            { type: 'session.output_transcript.delta' },
            { type: 'session.delegation.created' },
            { type: 'session.input_audio.muted' },
            { type: 'session.input_audio.unmuted' },
            { type: 'session.closed' },
          ],
        },
      },
    },
    transport: { type: 'webrtc', sdp: offerSdp },
  });
  const sessionId = res.session.id;
  const sideband = new SidebandWS(openai, { session_id: sessionId, graceful_close: true });
  live = { sessionId, sideband, muted: false, userBuf: '', yuiBuf: '', pendingRequest: '', lastActivity: Date.now(), lastProgressNote: new Map() };
  wire(live);
  emit({ type: 'live.status', active: true, muted: false });
  return { sdp: res.transport.sdp, sessionId };
}

function wire(st: LiveState) {
  const sb = st.sideband;
  sb.on('session.input_transcript.delta', (e) => {
    if (live !== st) return;
    flushYui();
    st.userBuf += e.delta;
    st.lastActivity = Date.now();
    emit({ type: 'user.said', text: st.userBuf, final: false });
    setYuiState('listening');
  });
  sb.on('session.output_transcript.delta', (e) => {
    if (live !== st) return;
    flushUser();
    st.yuiBuf += e.delta;
    st.lastActivity = Date.now();
    emit({ type: 'yui.say', text: st.yuiBuf, final: false });
    setYuiState('speaking');
    clearTimeout(st.speakingTimer);
    st.speakingTimer = setTimeout(() => {
      flushYui();
      setYuiState(agentsWorking() ? 'working' : 'idle');
    }, 1400);
  });
  sb.on('session.delegation.created', (e) => {
    if (live !== st) return;
    flushUser();
    const request = st.pendingRequest || 'O usuário pediu algo por voz; use o contexto recente.';
    st.pendingRequest = '';
    const delegationId = e.delegation.id;
    think({ request, source: 'voice' })
      .then((answer) => {
        if (live === st) send(st, { type: 'session.commentary.append', delegation_id: delegationId, content: clip(answer) });
      })
      .catch((err) => {
        console.error('delegação falhou', err);
        if (live === st) send(st, { type: 'session.commentary.append', delegation_id: delegationId, content: 'Tive um problema para consultar isso agora. Pode tentar de novo?' });
      });
  });
  sb.on('session.input_audio.muted', () => {
    st.muted = true;
    emit({ type: 'live.status', active: true, muted: true });
  });
  sb.on('session.input_audio.unmuted', () => {
    st.muted = false;
    emit({ type: 'live.status', active: true, muted: false });
  });
  sb.on('session.closed', () => {
    if (live === st) endLive('closed');
  });
  sb.on('error', (err) => console.error('live sideband', err.message));
  sb.on('close', () => {
    if (live === st) endLive('sideband-close');
  });
}

function send(st: LiveState, ev: OpenAI.Live.Sideband.ConnectClientEvent) {
  try {
    st.sideband.send(ev);
  } catch (e) {
    console.error('live send', (e as Error).message);
  }
}

const clip = (s: string) => (s.length > 1500 ? `${s.slice(0, 1500)}…` : s);

export function endLive(reason = 'user') {
  const st = live;
  if (!st) return;
  live = null;
  flushUserOf(st);
  try {
    st.sideband.send({ type: 'session.close' });
  } catch {
    /* já fechado */
  }
  setTimeout(() => st.sideband.close(), 1500).unref();
  emit({ type: 'live.status', active: false, muted: false });
  setYuiState(agentsWorking() ? 'working' : 'idle');
  console.log(`live encerrada (${reason})`);
}

function flushUserOf(st: LiveState) {
  if (st.userBuf.trim()) saveMessage('user', st.userBuf, 'voice');
  if (st.yuiBuf.trim()) saveMessage('yui', st.yuiBuf, 'voice');
}

// Ociosidade: sessão cobrada por segundo.
setInterval(() => {
  if (live && Date.now() - live.lastActivity > config.liveIdleMin * 60_000) endLive('idle');
}, 30_000).unref();

// Texto digitado: com voz ativa, a Yui fala a resposta; sem voz, resposta vai só para a tela.
export async function handleText(text: string): Promise<void> {
  saveMessage('user', text, 'text');
  if (live) live.lastActivity = Date.now();
  let answer: string;
  try {
    answer = await think({ request: text, source: 'text' });
  } catch (e) {
    console.error('brain', e);
    answer = 'Não consegui pensar nisso agora — algo falhou do meu lado.';
  }
  if (live) {
    send(live, { type: 'session.commentary.append', delegation_id: null, content: clip(answer) });
    return;
  }
  sayOnScreen(answer);
}

function sayOnScreen(text: string, end: 'idle' | 'success' | 'warning' = 'idle') {
  saveMessage('yui', text, 'text');
  setYuiState('speaking');
  emit({ type: 'yui.say', text, final: true });
  setTimeout(() => setYuiState(end !== 'idle' ? end : agentsWorking() ? 'working' : 'idle'), 1300).unref();
  if (end !== 'idle') setTimeout(() => setYuiState(agentsWorking() ? 'working' : 'idle'), 3000).unref();
}

// Narração do trabalho dos agentes.
function narrate(text: string, opts: { speak: boolean; end?: 'success' | 'warning' }) {
  if (live) {
    send(live, { type: opts.speak ? 'session.commentary.append' : 'session.thinking.append', delegation_id: null, content: clip(text) });
    if (opts.end) setYuiState(opts.end);
    return;
  }
  if (opts.speak) sayOnScreen(brief(text), opts.end ?? 'idle');
}

// Na tela (sem voz) a narração precisa caber ao lado do orb: até ~2 frases.
function brief(text: string): string {
  const clean = text.replace(/`/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 220) return clean;
  const cut = clean.slice(0, 220);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

runBus.on('progress', (run: RunInfo) => {
  if (!live) return;
  const last = live.lastProgressNote.get(run.id) ?? 0;
  if (Date.now() - last < 20_000) return;
  live.lastProgressNote.set(run.id, Date.now());
  narrate(`Progresso: ${run.agent} em "${run.task}" — ${run.progress}%, agora: ${run.currentOp ?? '…'}.`, { speak: false });
});

runBus.on('finished', (run: RunInfo) => {
  const ok = run.state === 'done';
  const prefix = ok ? `${run.agent} concluiu.` : run.state === 'cancelled' ? `${run.agent} foi cancelado.` : `${run.agent} não conseguiu concluir.`;
  narrate(`${prefix} ${run.result ?? ''}`.trim(), { speak: true, end: ok ? 'success' : 'warning' });
});

runBus.on('approval', (a) => {
  narrate(`Preciso da sua aprovação: ${a.title}`, { speak: true, end: 'warning' });
  emit({ type: 'ui.action', action: { type: 'open_approval', approvalId: a.id } });
});

export function setUiContextNote(note: string) {
  if (live) send(live, { type: 'session.thinking.append', delegation_id: null, content: note });
}
