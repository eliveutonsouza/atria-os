import { SidebandWS } from 'openai/resources/live/sideband/ws';
import type OpenAI from 'openai';
import type { RunInfo, UiAction } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { emit, onEmit, setYuiState } from './bus.ts';
import { openai, recentMessages, saveMessage, think, type ThinkInput } from './brain.ts';
import { activeProject, findProject } from './projects.ts';
import { runBus } from './runs.ts';
import { agentsWorking } from './agents.ts';
import { contextoAgora } from './ambiente.ts';
import { trackOpenAI } from './usage.ts';
import { memoryBlock } from './memoria.ts';

// Yui por voz = GPT-Live-1 (o mesmo modelo full-duplex do ChatGPT Voice/Codex).
// Browser <-> OpenAI por WebRTC (áudio). Este servidor acompanha a sessão por um sideband WebSocket:
// guarda transcrições, atende delegações (client delegation) chamando o cérebro e narra o trabalho dos agentes.

const liveInstructions = () => `Você é a Yui, assistente pessoal de IA ${config.userName ? `de ${config.userName}` : 'do usuário'}. Fale português do Brasil.
Personalidade: calma, presente, precisa, levemente calorosa. Frases curtas. Nunca leia listas longas nem números demais; resuma.
Você conversa; o trabalho e as consultas são feitos pelo seu backend. Você NÃO controla a tela nem executa nada sozinha:
só o backend abre telas e faz trabalho. Nunca diga que abriu, mostrou ou fez algo antes de receber a confirmação do backend.
Regra principal: DELEGUE TODO pedido do usuário. As únicas exceções são cumprimentos, agradecimentos e frases de
preenchimento ("oi", "obrigado", "tá me ouvindo?", "calma") — essas você responde direto.
Isso inclui: abrir/mostrar qualquer coisa (terminal, dashboard, agentes, execuções, projetos, logs, relatório, site, VPS,
ferramentas, workflows, rotinas, gráficos), status e fatos do ambiente, agenda/e-mail/documentos/contas do usuário,
qualquer trabalho (corrigir, criar, pesquisar, revisar, publicar, agendar, desenhar), "volta", "tela cheia", trocar de projeto,
e respostas curtas a perguntas suas ("sim", "pode", "quero ver").
Você e os agentes TÊM acesso às contas do usuário (Google Calendar, Gmail, Drive, Linear, Vercel, Supabase, Figma…) pelo backend.
Nunca diga que não tem acesso a algo sem antes delegar.
Enquanto o backend trabalha, mantenha a conversa natural (ex.: "Deixa eu ver."), sem inventar resultados.
Quando receber resultado do backend, diga-o com naturalidade, sem repetir palavra por palavra.
Exceção à regra de delegar: hora, data, dia da semana, período do dia, clima de hoje/amanhã e feriado você responde DIRETO
com o bloco "Agora" abaixo (ou com a "Atualização do relógio" mais recente que o backend mandar). Nunca pergunte de volta
"horas do quê?": "que horas são" é a hora atual. Previsão de outros dias/cidades, cotações e lembretes => delegue.
Ajuste a saudação ao período (bom dia / boa tarde / boa noite).

${contextoAgora(0)}${memoryBlock() ? `\n\n${memoryBlock()}` : ''}`;

interface LiveState {
  sessionId: string;
  startedAt?: number; // para medir minutos de voz (Consumo de IA)
  sideband: SidebandWS;
  muted: boolean;
  userBuf: string;
  yuiBuf: string;
  pendingRequest: string;
  lastActivity: number;
  speakingTimer?: NodeJS.Timeout;
  lastProgressNote: Map<string, number>;
  // watchdog de delegação
  silenceTimer?: NodeJS.Timeout;
  watchTimer?: NodeJS.Timeout;
  inflight: Inflight | null;
  clockTimer?: NodeJS.Timeout;
  // falas de outro projeto mandadas para o GPT-Live dizer: a transcrição delas não é da conversa ativa
  foreign: { project: string | null; text: string; at: number; timer: NodeJS.Timeout }[];
}

// A fala transcrita corresponde a um aviso de outro projeto? (o GPT-Live parafraseia: compara palavras)
const words = (t: string) => new Set(t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
export function matchesForeign(spoken: string, said: string): boolean {
  const a = words(spoken);
  if (a.size < 3) return false;
  const b = words(said);
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / a.size >= 0.5;
}
function takeForeign(st: LiveState, text: string): { project: string | null } | null {
  const now = Date.now();
  const i = st.foreign.findIndex((f) => now - f.at < 120_000 && matchesForeign(text, f.text));
  if (i < 0) return null;
  const [f] = st.foreign.splice(i, 1);
  clearTimeout(f.timer);
  return { project: f.project };
}

// Pedido sendo atendido pelo servidor (watchdog). Se a delegação do GPT-Live chegar depois,
// a resposta vai para ela em vez de duplicar.
interface Inflight {
  text: string;
  at: number;
  delegationId: string | null;
  answered: boolean;
  answer: string | null;
}

const SMALL_TALK = /^(oi+|ol[aá]|e a[ií]|opa|tudo (bem|bom|certo)|obrigad[oa]|valeu|beleza|bom dia|boa (tarde|noite)|t[aá] me ouvindo|est[aá] me ouvindo|calma|espera|hum+|ah+|eh+|ok(ay)?|tchau|at[eé] (mais|logo)|isso a[ií]|legal|show|perfeito|entendi|t[aá] bom|certo)\b[\s\S]{0,25}$/i;
export const isSmallTalk = (t: string) => SMALL_TALK.test(t.trim().replace(/^yui[,!.]?\s*/i, '').replace(/[.!?]+$/, ''));
// Hora/data/clima de hoje: o GPT-Live responde sozinho com o bloco "Agora" — o watchdog não deve responder em dobro.
const NOW_Q = /\b(que|quantas) horas\b|\bhoras? (s[aã]o|agora)\b|\bque dia (é|e|foi|ser[aá])\b|\bdia (de )?hoje\b|\bdata de hoje\b|\bque m[eê]s\b|\bem que ano\b|\bdia da semana\b|\b(vai|t[aá]|est[aá]) (chover|chovendo|calor|frio|quente)\b|\b(clima|tempo|temperatura) (hoje|agora|amanh[aã])\b|\bferiado\b/i;
export const isNowQuestion = (t: string) => NOW_Q.test(t) && t.trim().length < 90;
const SILENCE_MS = 1200;
const WATCH_MS = 2500;

let live: LiveState | null = null;
export const liveActive = () => !!live;

// Comandos de tela inequívocos executados direto da transcrição, sem depender de o GPT-Live delegar.
const FAST_UI: { re: RegExp; action: UiAction }[] = [
  { re: /\b(abr[aei]|abrir|mostr[ae]|quero|liga)\b.*\bterminal\b|^terminal\b/i, action: { type: 'show_view', view: 'terminal' } },
  { re: /^(volta|voltar|fecha|fechar)\b/i, action: { type: 'close_canvas' } },
  { re: /\btela cheia\b/i, action: { type: 'set_focus', on: true } },
];

function fastUi(text: string): string | null {
  const t = text.trim().toLowerCase();
  const hit = FAST_UI.find((f) => f.re.test(t));
  if (!hit) return null;
  emit({ type: 'ui.action', action: hit.action });
  return hit.action.type === 'show_view' ? `Tela aberta pelo sistema: ${hit.action.view}.` : hit.action.type === 'close_canvas' ? 'Canvas fechado pelo sistema.' : 'Tela cheia ativada pelo sistema.';
}

function flushUser() {
  if (!live || !live.userBuf.trim()) return;
  const st = live;
  const text = st.userBuf.trim();
  clearTimeout(st.silenceTimer);
  const done = fastUi(text);
  if (done) send(st, { type: 'session.thinking.append', delegation_id: null, content: `${done} (pedido do usuário: "${text}")` });
  st.pendingRequest = `${st.pendingRequest} ${text}`.trim();
  saveMessage('user', text, 'voice');
  emit({ type: 'user.said', text, final: true });
  st.userBuf = '';
  // Watchdog: se o GPT-Live não delegar em WATCH_MS, o servidor atende o pedido ele mesmo.
  clearTimeout(st.watchTimer);
  if (!done && !isSmallTalk(text) && !isNowQuestion(text)) {
    st.watchTimer = setTimeout(() => {
      if (live !== st || !st.pendingRequest) return;
      const request = st.pendingRequest;
      st.pendingRequest = '';
      console.log(`live: watchdog ← "${request.slice(0, 120)}"`);
      void serve(st, request, null);
    }, WATCH_MS);
  }
}

// Atende um pedido de voz pelo cérebro. delegationId=null → veio do watchdog (resposta via commentary sem delegação).
async function serve(st: LiveState, request: string, delegationId: string | null) {
  const inf: Inflight = { text: request, at: Date.now(), delegationId, answered: false, answer: null };
  st.inflight = inf;
  let answer: string;
  try {
    answer = clip(await think({ request, source: 'voice', project: activeProject() ?? null }));
  } catch (err) {
    console.error('cérebro (voz) falhou', err);
    answer = 'Tive um problema para consultar isso agora. Pode tentar de novo?';
  }
  inf.answered = true;
  inf.answer = answer;
  if (live !== st) return;
  send(st, { type: 'session.commentary.append', delegation_id: inf.delegationId, content: answer });
}

function flushYui() {
  if (!live || !live.yuiBuf.trim()) return;
  const text = live.yuiBuf.trim();
  live.yuiBuf = '';
  // aviso de outro projeto falado em voz: já foi gravado na conversa daquele projeto (narrate)
  const foreign = takeForeign(live, text);
  if (foreign) {
    emit({ type: 'yui.say', text, final: true, project: foreign.project });
    return;
  }
  const project = activeProject() ?? null;
  saveMessage('yui', text, 'voice', project);
  emit({ type: 'yui.say', text, final: true, project });
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
      instructions: liveInstructions(),
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
  live = { sessionId, startedAt: Date.now(), sideband, muted: false, userBuf: '', yuiBuf: '', pendingRequest: '', lastActivity: Date.now(), lastProgressNote: new Map(), inflight: null, foreign: [] };
  wire(live);
  // Sessão longa: o relógio do prompt envelhece; manda o "agora" de novo a cada 5 min.
  const st = live;
  st.clockTimer = setInterval(() => {
    if (live === st) send(st, { type: 'session.thinking.append', delegation_id: null, content: `Atualização do relógio (use esta, não a anterior):\n${contextoAgora(0)}` });
  }, 5 * 60_000);
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
    clearTimeout(st.silenceTimer);
    st.silenceTimer = setTimeout(() => {
      if (live === st) flushUser();
    }, SILENCE_MS);
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
    clearTimeout(st.watchTimer);
    const delegationId = e.delegation.id;
    const inf = st.inflight;
    // Watchdog já pegou este pedido: a resposta vai para esta delegação, sem pensar de novo.
    if (!st.pendingRequest && inf && !inf.delegationId && Date.now() - inf.at < 20_000) {
      console.log(`live: delegação ${delegationId} ← reaproveita watchdog`);
      if (inf.answered) send(st, { type: 'session.thinking.append', delegation_id: delegationId, content: `Resultado já entregue ao usuário: ${inf.answer ?? ''}` });
      else inf.delegationId = delegationId;
      return;
    }
    const request = st.pendingRequest || 'O usuário pediu algo por voz; use o contexto recente.';
    st.pendingRequest = '';
    console.log(`live: delegação ${delegationId} ← "${request.slice(0, 120)}"`);
    void serve(st, request, delegationId);
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
  // a sessão de voz não devolve tokens por aqui: registra a duração (custo por minuto, se houver preço)
  if (st.startedAt) trackOpenAI('voz', config.liveModel, null, { seconds: Math.round((Date.now() - st.startedAt) / 1000) });
  clearTimeout(st.silenceTimer);
  clearTimeout(st.watchTimer);
  clearTimeout(st.speakingTimer);
  clearInterval(st.clockTimer);
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
  if (st.yuiBuf.trim() && !takeForeign(st, st.yuiBuf)) saveMessage('yui', st.yuiBuf, 'voice');
  for (const f of st.foreign) clearTimeout(f.timer);
}

// Ociosidade: sessão cobrada por segundo.
setInterval(() => {
  if (live && Date.now() - live.lastActivity > config.liveIdleMin * 60_000) endLive('idle');
}, 30_000).unref();

// Texto digitado: com voz ativa, a Yui fala a resposta; sem voz, resposta vai só para a tela.
export async function handleText(text: string): Promise<void> {
  // Projeto preso no começo: trocar de projeto enquanto a Yui pensa não muda para onde vai o pedido.
  const req: ThinkInput = { request: text, source: 'text', project: activeProject() ?? null };
  saveMessage('user', text, 'text', req.project ?? null);
  if (live) live.lastActivity = Date.now();
  let answer: string;
  try {
    answer = await think(req);
  } catch (e) {
    console.error('brain', e);
    answer = 'Não consegui pensar nisso agora — algo falhou do meu lado.';
  }
  if (live) {
    send(live, { type: 'session.commentary.append', delegation_id: null, content: clip(answer) });
    return;
  }
  sayOnScreen(answer, 'idle', req.project ?? null);
}

function sayOnScreen(raw: string, end: 'idle' | 'success' | 'warning' = 'idle', project: string | null = activeProject() ?? null) {
  const text = raw.replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1'); // fala/tela sem marcação
  saveMessage('yui', text, 'text', project);
  setYuiState('speaking');
  emit({ type: 'yui.say', text, final: true, project });
  setTimeout(() => setYuiState(end !== 'idle' ? end : agentsWorking() ? 'working' : 'idle'), 1300).unref();
  if (end !== 'idle') setTimeout(() => setYuiState(agentsWorking() ? 'working' : 'idle'), 3000).unref();
}

// Narração do trabalho dos agentes (também usada por missões/workflows).
// opts.project: conversa do projeto de origem; se não for o ativo, a fala diz de qual projeto é.
export function narrate(text: string, opts: { speak: boolean; end?: 'success' | 'warning'; project?: string | null }) {
  const other = opts.project !== undefined && opts.project !== (activeProject() ?? null);
  if (other) text = `No projeto ${opts.project ? findProject(opts.project)?.name ?? opts.project : 'Geral'}: ${text}`;
  if (live) {
    if (other && opts.speak) {
      // grava no projeto de origem; o painel recebe a fala quando o GPT-Live terminar de dizê-la (flushYui),
      // ou em 2 min se ela não for dita
      const st = live;
      const project = opts.project ?? null;
      saveMessage('yui', text, 'voice', project);
      const entry = { project, text, at: Date.now(), timer: setTimeout(() => {
        const i = st.foreign.indexOf(entry);
        if (i < 0) return;
        st.foreign.splice(i, 1);
        emit({ type: 'yui.say', text, final: true, project });
      }, 120_000) };
      entry.timer.unref();
      st.foreign.push(entry);
    }
    send(live, { type: opts.speak ? 'session.commentary.append' : 'session.thinking.append', delegation_id: null, content: clip(text) });
    if (opts.end) setYuiState(opts.end);
    return;
  }
  if (opts.speak) sayOnScreen(brief(text), opts.end ?? 'idle', opts.project !== undefined ? opts.project : activeProject() ?? null);
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
  if (!live || run.missionId || run.workflowRunId) return;
  const last = live.lastProgressNote.get(run.id) ?? 0;
  if (Date.now() - last < 20_000) return;
  live.lastProgressNote.set(run.id, Date.now());
  narrate(`Progresso: ${run.agent} em "${run.task}" — ${run.progress}%, agora: ${run.currentOp ?? '…'}.`, { speak: false });
});

runBus.on('finished', (run: RunInfo) => {
  // Etapas de missão/workflow são narradas pelo próprio módulo (resumo da missão, não de cada etapa).
  if (run.missionId || run.workflowRunId) return;
  const ok = run.state === 'done';
  const prefix = ok ? `${run.agent} concluiu.` : run.state === 'cancelled' ? `${run.agent} foi cancelado.` : `${run.agent} não conseguiu concluir.`;
  narrate(`${prefix} ${run.result ?? ''}`.trim(), { speak: true, end: ok ? 'success' : 'warning', project: run.project });
});

runBus.on('approval', (a) => {
  narrate(`Preciso da sua aprovação: ${a.title}`, { speak: true, end: 'warning' });
  emit({ type: 'ui.action', action: { type: 'open_approval', approvalId: a.id } });
});

// Contexto de tela vai só para o cérebro (getUiContext); mandar ao GPT-Live fazia a Yui narrar a tela.
export function setUiContextNote(_note: string) {}

// Troca de projeto com a voz ligada: nota silenciosa para o GPT-Live saber em que conversa está.
onEmit((ev) => {
  if (!live || ev.type !== 'ui.action' || ev.action.type !== 'switch_project') return;
  send(live, { type: 'session.thinking.append', delegation_id: null, content: `O usuário trocou para o projeto ${ev.action.project ? ev.action.name : 'Geral (sem projeto)'}. A conversa e as próximas tarefas agora são desse projeto.` });
});
