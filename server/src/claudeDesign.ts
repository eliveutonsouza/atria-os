import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config } from './config.ts';
import { kvGet, kvSet, now } from './db.ts';
import { emit } from './bus.ts';
import { getSetting } from './settings.ts';
import { getInit } from './capabilities.ts';
import { claudeEnv, inboxItems, runBus } from './runs.ts';
import { registerRunPrompt } from './extensions.ts';
import type { InboxItem } from '../../shared/protocol.ts';

// Claude Design sempre disponível para os agentes.
// A skill `design` e a ferramenta DesignSync do Claude Code só funcionam com duas coisas na conta:
//  1. login de Design (`designOauth` em ~/.claude/.credentials.json, feito uma vez com /design-login);
//  2. consentimento "agent_design_projects" gravado no servidor (POST /v1/design/consent).
// Agente headless não roda /design-consent sozinho e parava com "rode /design consent". Aqui o Atria
// confere os dois no boot, a cada 6 h e antes de cada execução de design, e repara rodando
// `claude -p /design-consent` (comando local: não gasta turno, renova o token e grava o consentimento).

export type DesignLogin = 'ok' | 'missing' | 'expired';
export type DesignConsent = 'granted' | 'missing' | 'unknown';
export interface DesignStatus {
  login: DesignLogin;
  consent: DesignConsent;
  grantedAt: string | null;
  checkedAt: string;
  repairedAt?: string | null;
  error?: string | null;
}

const API = 'https://api.anthropic.com/v1/design/consent';
const FRESH_MS = 10 * 60_000;
const PERIOD_MS = 6 * 3600_000;

interface DesignToken { accessToken: string; expiresAt?: number; scopes?: string[] }

const credsPath = () => join(process.env.HOME ?? '/data/home', '.claude', '.credentials.json');

export function readDesignToken(path = credsPath()): DesignToken | null {
  try {
    const t = JSON.parse(readFileSync(path, 'utf8'))?.designOauth;
    return t?.accessToken ? t : null;
  } catch {
    return null;
  }
}

/** Interpreta a resposta do GET /v1/design/consent. */
export function interpretConsent(status: number, body: unknown): { login: DesignLogin; consent: DesignConsent; grantedAt: string | null } {
  if (status === 401) return { login: 'expired', consent: 'unknown', grantedAt: null };
  if (status === 403) return { login: 'missing', consent: 'unknown', grantedAt: null };
  if (status !== 200) return { login: 'ok', consent: 'unknown', grantedAt: null };
  const g = (body as { granted_at?: string | null } | null)?.granted_at ?? null;
  return { login: 'ok', consent: g ? 'granted' : 'missing', grantedAt: g };
}

export const designReady = (s: DesignStatus | null) => !!s && s.login === 'ok' && s.consent === 'granted';

export function designStatus(): DesignStatus | null {
  const raw = kvGet('claude_design_status');
  return raw ? (JSON.parse(raw) as DesignStatus) : null;
}

async function fetchConsent(): Promise<Omit<DesignStatus, 'checkedAt'>> {
  const tok = readDesignToken();
  if (!tok) return { login: 'missing', consent: 'unknown', grantedAt: null };
  if (tok.expiresAt && tok.expiresAt < Date.now() + 60_000) return { login: 'expired', consent: 'unknown', grantedAt: null };
  try {
    const r = await fetch(API, { headers: { Authorization: `Bearer ${tok.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' }, signal: AbortSignal.timeout(8000) });
    const body = await r.json().catch(() => null);
    return { ...interpretConsent(r.status, body), error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) {
    return { login: 'ok', consent: 'unknown', grantedAt: null, error: (e as Error).message };
  }
}

/** `claude -p /design-consent`: renova o token de Design e grava o consentimento (idempotente). */
function runDesignConsent(): Promise<string> {
  const cwd = join(config.metaDir, 'scratch');
  mkdirSync(cwd, { recursive: true });
  return new Promise((resolve) => {
    execFile('claude', ['-p', '/design-consent'], { cwd, env: claudeEnv(), timeout: 90_000 }, (err, stdout, stderr) => {
      resolve(`${stdout}${stderr}`.trim() || (err ? err.message : ''));
    });
  });
}

let checking: Promise<DesignStatus> | null = null;

/** Confere login + consentimento; com `repair` (padrão, desligável em design.autoConsent=false) conserta sozinho. */
export function checkDesign(opts: { force?: boolean; repair?: boolean } = {}): Promise<DesignStatus> {
  const cur = designStatus();
  if (!opts.force && cur && designReady(cur) && Date.now() - Date.parse(cur.checkedAt) < FRESH_MS) return Promise.resolve(cur);
  checking ??= (async () => {
    const before = cur;
    let s: DesignStatus = { ...(await fetchConsent()), checkedAt: now(), repairedAt: cur?.repairedAt ?? null };
    const repair = opts.repair ?? getSetting('design.autoConsent') !== false;
    // login sumido (nunca fez /design-login) não tem conserto automático: precisa do navegador
    if (repair && s.login !== 'missing' && !designReady(s)) {
      const out = await runDesignConsent();
      s = { ...(await fetchConsent()), checkedAt: now(), repairedAt: now() };
      if (!designReady(s)) s.error = out.split('\n').at(-1)?.slice(0, 200) || s.error || null;
      console.log(`claude-design: reparo ${designReady(s) ? 'ok' : 'falhou'} (${s.login}/${s.consent})`);
    }
    kvSet('claude_design_status', JSON.stringify(s));
    if (designReady(before) !== designReady(s) || !before) emit({ type: 'inbox.updated', inbox: inboxItems() });
    if (before && designReady(before) && !designReady(s)) void notifyDown(s);
    return s;
  })().finally(() => {
    checking = null;
  });
  return checking;
}

async function notifyDown(s: DesignStatus) {
  try {
    const { sendPush } = await import('./push.ts');
    await sendPush({ title: 'Claude Design desconectado', body: designHint(s), url: '/app/claude', tag: 'claude-design' }, { force: true });
  } catch (e) {
    console.error('claude-design push', (e as Error).message);
  }
}

export function designHint(s: DesignStatus): string {
  if (s.login === 'missing') return 'Falta o login de Design: no servidor, rode `docker exec -it atria-os-atria-1 claude` e digite /design-login.';
  if (s.login === 'expired') return 'O login de Design expirou e não renovou sozinho: rode /design-login no Claude do container.';
  if (s.consent === 'missing') return 'O acesso dos agentes ao Claude Design está desligado. Toque em "Liberar acesso" ou ligue em claude.ai/design/settings.';
  return 'Não consegui confirmar o acesso ao Claude Design agora; tento de novo em instantes.';
}

/** Item do Inbox quando o Claude Design não está pronto (chamado por runs.inboxItems). */
export function designInboxItems(): InboxItem[] {
  const s = designStatus();
  if (!s || designReady(s) || s.consent === 'unknown' && s.login === 'ok') return [];
  return [{ id: 'claude-design', tag: 'Claude Design', label: designHint(s), tone: 'warn', action: { type: 'view', view: 'claude' } }];
}

// ---------- integração com as execuções ----------

const DESIGN_TASK = /\b(design|deck|slides?|apresenta[çc][ãa]o|prot[óo]tipo|mockup|wireframe|landing|identidade visual|design system|tela|artefato|artifact)\b/i;
const CONSENT_STUCK = /design[\s-]?consent|sem acesso ao Claude Design|acesso ao Claude Design|Connect to Claude Design/i;

export const isDesignTask = (skills: string[], instruction: string) => skills.includes('design') || skills.includes('design-sync') || DESIGN_TASK.test(instruction);

/** Antes de uma execução de design: garante consentimento (rápido quando o cache está fresco). */
export async function designPreflight(skills: string[], instruction: string): Promise<void> {
  if (!isDesignTask(skills, instruction)) return;
  await checkDesign().catch((e) => console.error('claude-design preflight', (e as Error).message));
}

const artifactToolAvailable = () => getInit()?.tools?.includes('Artifact') ?? false;

function promptLines(): string {
  const s = designStatus();
  const lines = ['Entregas visuais e criativas (use sem pedir permissão):'];
  if (designReady(s)) lines.push('- Claude Design está conectado e com acesso liberado: telas, protótipos, decks/slides, landing pages e design systems → skill `design` (e `design-sync`/DesignSync para sincronizar). Não peça /design consent ao usuário; devolva o link claude.ai/design.');
  else if (s) lines.push(`- Claude Design indisponível agora (${s.login}/${s.consent}). Não pare a tarefa: entregue pelo caminho alternativo abaixo e diga no resultado que o design ficou fora do Claude Design. ${designHint(s)}`);
  lines.push(
    '- Imagem, vídeo, áudio/voz → conector Higgsfield (generate_image, generate_video, generate_audio; acompanhe com jobs_wait) e devolva as URLs.',
    '- Slides em arquivo → skill pptx; documento → docx/pdf; arte estática (pôster, post) → canvas-design; gráficos → dataviz.',
    artifactToolAvailable()
      ? '- Página/artefato interativo → ferramenta Artifact (publica em claude.ai).'
      : '- Página/artefato interativo → gere HTML/Vite no projeto (ou em .atria/scratch) e entregue pelo preview do Atria; a ferramenta Artifact do claude.ai não existe nesta sessão.',
  );
  return lines.join('\n');
}

export function register(app: FastifyInstance): void {
  app.get('/api/claude-design/status', async () => {
    const s = await checkDesign({ repair: false });
    return { ...s, ready: designReady(s), hint: designReady(s) ? null : designHint(s), artifactTool: artifactToolAvailable() };
  });
  app.post('/api/claude-design/repair', async () => {
    const s = await checkDesign({ force: true, repair: true });
    return { ...s, ready: designReady(s), hint: designReady(s) ? null : designHint(s), artifactTool: artifactToolAvailable() };
  });

  registerRunPrompt(() => promptLines());

  // Run que mesmo assim parou pedindo consentimento: conserta na hora e avisa para pedir de novo.
  runBus.on('finished', (info) => {
    if (!info.result || !CONSENT_STUCK.test(info.result)) return;
    void checkDesign({ force: true }).then((s) => {
      if (!designReady(s)) return;
      void import('./push.ts').then(({ sendPush }) =>
        sendPush({ title: 'Claude Design liberado', body: `"${info.task.slice(0, 60)}" parou no acesso ao Claude Design; já liberei. Peça de novo.`, url: '/app/runs', tag: 'claude-design' }, { force: true }),
      );
    });
  });

  setTimeout(() => void checkDesign({ force: true }).catch(() => {}), 15_000).unref();
  setInterval(() => void checkDesign({ force: true }).catch(() => {}), PERIOD_MS).unref();
}
