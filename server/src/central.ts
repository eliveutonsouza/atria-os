import type { FastifyInstance } from 'fastify';
import type { CentralCommand, CommandResult, IngestResponse, InstanceCapability, UpdaterState, UpdateStep } from '../../shared/telemetry.ts';
import { readEnv } from './config.ts';
import { kvGet, kvSet, now } from './db.ts';
import { emit } from './bus.ts';
import { getSetting } from './settings.ts';
import { busyRuns, holdQueue, queueHeld } from './runs.ts';
import { monitorConfig, onIngestCommands, pushEvent, setInstanceExtras, VERSION } from './telemetry.ts';

// Canal de comandos do Atria Central (contrato em shared/telemetry.ts). O Central devolve comandos na
// resposta do pulso; cada um roda uma vez (dedupe por id, guardado no kv) e o andamento volta em
// POST {central}/api/commands/:id/result com a mesma chave. Também fala com o atualizador (atria-updater),
// o sidecar que troca a versão das imagens; ele só existe nas instalações por imagem.

type Final = { status: 'done' | 'failed'; step?: UpdateStep | string; text?: string };
export interface CommandCtx {
  id: string;
  progress: (step: UpdateStep | string, text?: string) => void;
}
/** null = o resultado final chega depois, por outro caminho (atualização: reconciliação com o atualizador). */
type Handler = (payload: unknown, ctx: CommandCtx) => Promise<Final | null>;

const handlers = new Map<string, Handler>();
export function registerCommand(kind: CentralCommand['kind'], handler: Handler) {
  handlers.set(kind, handler);
}

// ---------- dedupe: últimos 200 ids com o resultado final (reentrega reenvia o resultado) ----------

const DONE_KEY = 'central_cmds_done';
type DoneEntry = [string, CommandResult | null];
function doneList(): DoneEntry[] {
  try {
    const v = JSON.parse(kvGet(DONE_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function remember(id: string, result: CommandResult | null) {
  const list = doneList().filter((e) => e[0] !== id);
  list.push([id, result]);
  kvSet(DONE_KEY, JSON.stringify(list.slice(-200)));
}

const short = (s: string | null | undefined, n = 160) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export async function postResult(id: string, result: CommandResult, central?: { url: string; key: string }): Promise<boolean> {
  const m = central ?? monitorConfig();
  const url = m.url.replace(/\/+$/, '');
  if (!url || !m.key) return false;
  try {
    const r = await fetch(`${url}/api/commands/${encodeURIComponent(id)}/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${m.key}` },
      body: JSON.stringify(result),
      signal: AbortSignal.timeout(10_000),
    });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}

async function runCommand(cmd: CentralCommand, central: { url: string; key: string }) {
  const finish = (r: Final) => {
    const full: CommandResult = { status: r.status, at: now(), ...(r.step ? { step: r.step } : {}), ...(r.text ? { text: short(r.text) } : {}) };
    remember(cmd.id, full);
    return postResult(cmd.id, full, central);
  };
  const h = handlers.get(cmd.kind);
  if (!h) return finish({ status: 'failed', step: 'unsupported', text: `Comando não suportado nesta versão: ${short(cmd.kind, 40)}` });
  const ctx: CommandCtx = {
    id: cmd.id,
    progress: (step, text) => void postResult(cmd.id, { status: 'progress', step, at: now(), ...(text ? { text: short(text) } : {}) }, central),
  };
  try {
    const r = await h(cmd.payload, ctx);
    if (r) await finish(r);
  } catch (e) {
    await finish({ status: 'failed', text: (e as Error).message });
  }
}

/** Comandos vindos na resposta do pulso. Não espera: cada um roda em segundo plano. */
export function dispatchCommands(res: IngestResponse, central: { url: string; key: string }) {
  const done = new Map(doneList());
  for (const cmd of res.commands.slice(0, 20)) {
    if (!cmd || typeof cmd.id !== 'string' || !cmd.id || cmd.id.length > 100 || typeof cmd.kind !== 'string') continue;
    if (done.has(cmd.id)) {
      const prev = done.get(cmd.id);
      if (prev) void postResult(cmd.id, prev, central); // o Central não recebeu o resultado da primeira vez
      continue;
    }
    remember(cmd.id, null);
    done.set(cmd.id, null);
    void runCommand(cmd, central);
  }
}

// ---------- atualizador (atria-updater, rede interna do compose) ----------

export interface UpdaterJob {
  commandId: string;
  jobId: string;
  tag: string;
  fromTag: string | null;
  startedAt: string;
  finishedAt: string | null;
  result: null | 'done' | 'rolled_back' | 'failed';
  error: string | null;
  reported: boolean;
}
export interface UpdaterStatus {
  status: 'ready' | 'busy' | 'error';
  tag: string | null;
  previousTag: string | null;
  step: string | null;
  version: string | null;
  job: UpdaterJob | null;
}

const updaterToken = () => readEnv('ATRIA_UPDATER_TOKEN') ?? '';
const updaterUrl = () => (readEnv('ATRIA_UPDATER_URL') || 'http://atria-updater:8787').replace(/\/+$/, '');

async function updaterCall(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response | null> {
  const token = updaterToken();
  if (!token) return null;
  try {
    return await fetch(`${updaterUrl()}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return null;
  }
}

let cache: { at: number; st: UpdaterStatus | null } | null = null;
/** GET /status do atualizador, com cache de 60 s. null = sem atualizador (sem token) ou sem resposta. */
export async function updaterStatus(force = false): Promise<UpdaterStatus | null> {
  if (!updaterToken()) return null;
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.st;
  const r = await updaterCall('GET', '/status');
  let st: UpdaterStatus | null = null;
  if (r?.ok) st = (await r.json().catch(() => null)) as UpdaterStatus | null;
  else await r?.body?.cancel();
  if (st && !['ready', 'busy', 'error'].includes(st.status)) st = null;
  cache = { at: Date.now(), st };
  return st;
}

export function updaterState(st: UpdaterStatus | null): UpdaterState {
  return st ? { status: st.status, tag: st.tag ?? null, step: st.step ?? null } : { status: 'missing', tag: null, step: null };
}

// ---------- atualização (comando 'update') ----------

const TAG = /^v\d+\.\d+\.\d+$/;
/** Espera das execuções em andamento antes de atualizar (os testes encurtam). */
export const drain = { maxMs: 20 * 60_000, pollMs: 5_000, watchdogMs: 30 * 60_000 };

// Andamento local, para Configurações › Suporte e atualizações (sobrevive ao reinício da atualização).
export interface LocalUpdate {
  jobId: string;
  commandId: string;
  tag: string;
  fromVersion: string;
  step: UpdateStep | string;
  startedAt: string;
  finishedAt: string | null;
  result: 'done' | 'rolled_back' | 'failed' | 'refused' | null;
  error: string | null;
}
const CURRENT_KEY = 'update_current';
export function localUpdate(): LocalUpdate | null {
  try {
    return JSON.parse(kvGet(CURRENT_KEY) ?? 'null');
  } catch {
    return null;
  }
}
function saveLocal(u: LocalUpdate) {
  kvSet(CURRENT_KEY, JSON.stringify(u));
  emit({ type: 'support.updated' });
}

const STEP_TEXT: Record<string, string> = {
  received: 'pedido recebido',
  draining: 'esperando as execuções terminarem',
  pulling: 'baixando a nova versão',
  restarting: 'reiniciando',
  healthy: 'concluída',
  rolled_back: 'revertida para a versão anterior',
  failed: 'falhou',
  refused: 'recusada (atualizações desligadas)',
};

let watchdog: NodeJS.Timeout | null = null;
let holdingFor: string | null = null; // commandId que segurou a fila

function release(commandId: string) {
  if (holdingFor !== commandId) return;
  holdingFor = null;
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
  holdQueue(false);
}

async function handleUpdate(payload: unknown, ctx: CommandCtx): Promise<Final | null> {
  const p = (payload ?? {}) as { jobId?: unknown; tag?: unknown };
  if (typeof p.jobId !== 'string' || !p.jobId || typeof p.tag !== 'string' || !TAG.test(p.tag)) return { status: 'failed', step: 'failed', text: 'Pedido de atualização inválido' };
  const jobId = p.jobId.slice(0, 100);
  const tag = p.tag;
  const u: LocalUpdate = { jobId, commandId: ctx.id, tag, fromVersion: VERSION, step: 'received', startedAt: now(), finishedAt: null, result: null, error: null };
  const step = (s: UpdateStep, text?: string) => {
    u.step = s;
    saveLocal(u);
    pushEvent({ kind: 'update_step', level: s === 'failed' || s === 'rolled_back' ? 'warn' : 'info', text: `Atualização ${tag}: ${STEP_TEXT[s] ?? s}`, ref: jobId });
    if (s !== 'refused' && s !== 'failed') ctx.progress(s, text);
  };
  const fail = (s: 'failed' | 'refused', text: string): Final => {
    u.finishedAt = now();
    u.result = s;
    u.error = text;
    step(s);
    release(ctx.id);
    return { status: 'failed', step: s, text };
  };

  if (!getSetting('update.allowRemote')) return fail('refused', 'Atualizações remotas desligadas pelo cliente');
  if (!updaterToken()) return fail('failed', 'Atualizador não instalado nesta instância');
  if (holdingFor) return fail('failed', 'Já existe uma atualização em andamento');

  step('received');
  holdingFor = ctx.id;
  holdQueue(true);
  step('draining');
  const until = Date.now() + drain.maxMs;
  while (busyRuns() > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, drain.pollMs));

  const r = await updaterCall('POST', '/update', { tag, commandId: ctx.id, jobId });
  const code = r?.status ?? 0;
  await r?.body?.cancel();
  if (code !== 202 && code !== 200) {
    return fail('failed', code === 409 ? 'Atualizador ocupado com outra atualização' : code === 400 ? `Versão recusada pelo atualizador: ${tag}` : code ? `Atualizador respondeu ${code}` : 'Atualizador sem resposta');
  }
  cache = null;
  step('pulling');
  // O atualizador reinicia este processo. Se ele voltar sem reiniciar (ex.: revertido para a mesma imagem),
  // a reconciliação manda o resultado e solta a fila; o vigia solta de qualquer jeito depois de 30 min.
  watchdog = setTimeout(() => {
    const cur = localUpdate();
    if (cur?.commandId === ctx.id && !cur.finishedAt) saveLocal({ ...cur, error: 'Sem notícia do atualizador' });
    release(ctx.id);
  }, drain.watchdogMs);
  watchdog.unref();
  return null;
}

/** Resultado de uma atualização que o atualizador terminou e ainda não foi informado ao Central (boot e a cada minuto). */
export async function reconcileUpdate(): Promise<boolean> {
  if (!updaterToken()) return false;
  const st = await updaterStatus(true);
  const job = st?.job;
  if (!job?.result || job.reported || !job.commandId) return false;
  const err = short(job.error, 120);
  const result: CommandResult =
    job.result === 'done'
      ? { status: 'done', step: 'healthy', text: `Atualizado para ${job.tag}`, at: now() }
      : job.result === 'rolled_back'
        ? { status: 'failed', step: 'rolled_back', text: `Voltou para ${job.fromTag ?? 'a versão anterior'}${err ? ` · ${err}` : ''}`, at: now() }
        : { status: 'failed', step: 'failed', text: err || 'A atualização falhou', at: now() };
  if (!(await postResult(job.commandId, result))) return false; // Central fora: tenta no próximo ciclo
  remember(job.commandId, result);
  const ack = await updaterCall('POST', '/ack', { commandId: job.commandId });
  await ack?.body?.cancel();
  cache = null;
  const step = result.step as UpdateStep;
  pushEvent({ kind: 'update_step', level: job.result === 'done' ? 'info' : 'warn', text: `Atualização ${job.tag}: ${STEP_TEXT[step] ?? step}`, ref: job.jobId });
  const cur = localUpdate();
  const base: LocalUpdate = cur?.commandId === job.commandId ? cur : { jobId: job.jobId, commandId: job.commandId, tag: job.tag, fromVersion: job.fromTag ?? '', step, startedAt: job.startedAt, finishedAt: null, result: null, error: null };
  saveLocal({ ...base, step, finishedAt: job.finishedAt ?? now(), result: job.result, error: job.result === 'done' ? null : result.text ?? null });
  release(job.commandId);
  return true;
}

// ---------- o que a instância anuncia no pulso ----------

async function instanceExtras() {
  const st = await updaterStatus();
  const capabilities: InstanceCapability[] = ['commands', 'support', 'notice', ...(st ? (['update'] as const) : [])];
  return { capabilities, supportAllowed: !!getSetting('support.remoteAccess'), updatesAllowed: !!getSetting('update.allowRemote'), updater: updaterState(st) };
}

let started = false;
export function startCentral(opts: { timers?: boolean } = {}) {
  if (started) return;
  started = true;
  setInstanceExtras(instanceExtras);
  onIngestCommands(dispatchCommands);
  registerCommand('update', handleUpdate);
  if (opts.timers === false || !updaterToken()) return;
  setTimeout(() => void reconcileUpdate(), 5_000).unref();
  setInterval(() => void reconcileUpdate(), 60_000).unref();
}

export function register(app: FastifyInstance): void {
  startCentral();
  app.get('/api/updates/status', async () => {
    const st = await updaterStatus();
    return {
      version: VERSION,
      allowRemote: !!getSetting('update.allowRemote'),
      updater: { ...updaterState(st), version: st?.version ?? null },
      current: localUpdate(),
      queueHeld: queueHeld(),
    };
  });
}
