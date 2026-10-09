import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { statfsSync } from 'node:fs';
import { hostname } from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { IngestResponse, TelemetryEvent, TelemetrySnapshot } from '../../shared/telemetry.ts';
import { config, readEnv } from './config.ts';
import { db, kvGet, kvSet, now } from './db.ts';
import { onEmit } from './bus.ts';
import { findAgent } from './agents.ts';
import { cpuNow, hostMem } from './metrics.ts';
import { dget } from './docker.ts';
import { claudeLimits, claudeAccount } from './claudeUsage.ts';
import { usageReport } from './usage.ts';
import { healthFull } from './health.ts';
import { getSetting, onSettingsChange, rawGet, validMonitorUrl } from './settings.ts';

// Telemetria para o Atria Central (painel do administrador de várias instalações do Atria OS). Contrato em shared/telemetry.ts.
// Só métricas: nada de tarefa, instrução, resultado, mensagem ou documento sai daqui.
// Dois caminhos com o mesmo JSON: o pulso (POST {monitor}/api/ingest a cada 30 s) e a URL de saúde (GET /api/telemetry).

export const VERSION = readEnv('ATRIA_VERSION') || 'dev';
const STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000));

export function instanceId(): string {
  let id = kvGet('instance_id');
  if (!id) {
    id = randomUUID();
    kvSet('instance_id', id);
  }
  return id;
}
instanceId();

// ---------- erros técnicos (console.error + logger do Fastify) ----------

const errMinutes = new Map<number, number>(); // minuto (epoch/60 s) → quantidade
const errRecent: { at: string; text: string }[] = [];

function errText(args: unknown[]): string {
  // só texto/erro: objetos podem carregar conteúdo do cliente
  const parts = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' || typeof a === 'number' ? String(a) : (a as { err?: unknown })?.err instanceof Error ? ((a as { err: Error }).err.message) : '')).filter(Boolean);
  return (parts.join(' ').split('\n')[0] ?? '').trim().slice(0, 160);
}

export function recordError(...args: unknown[]): void {
  const m = Math.floor(Date.now() / 60_000);
  errMinutes.set(m, (errMinutes.get(m) ?? 0) + 1);
  for (const k of errMinutes.keys()) if (k < m - 60) errMinutes.delete(k);
  errRecent.push({ at: now(), text: errText(args) || 'erro' });
  if (errRecent.length > 20) errRecent.shift();
}

const origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  try {
    recordError(...args);
  } catch {
    /* nunca atrapalha o log */
  }
  origConsoleError(...args);
};

function errorsSummary(): TelemetrySnapshot['errors'] {
  const m = Math.floor(Date.now() / 60_000);
  let lastHour = 0;
  for (const [k, n] of errMinutes) if (k > m - 60) lastHour += n;
  return { lastHour, recent: [...errRecent] };
}

// ---------- eventos (anel) ----------

const RING = 200;
const ring: { seq: number; ev: TelemetryEvent }[] = [];
let seq = 0;
let acked = 0; // último seq entregue com sucesso pelo pulso

export function pushEvent(ev: Omit<TelemetryEvent, 'at'>): void {
  ring.push({ seq: ++seq, ev: { at: now(), ...ev } });
  if (ring.length > RING) ring.shift();
}

const seen = new Set<string>();
const once = (k: string) => {
  if (seen.has(k)) return false;
  seen.add(k);
  if (seen.size > 1000) seen.delete(seen.values().next().value!);
  return true;
};
let voiceOn = false;

onEmit((ev) => {
  switch (ev.type) {
    case 'run.updated':
      if (ev.run.state === 'failed' && once(`fail:${ev.run.id}`)) pushEvent({ kind: 'run_failed', level: 'warn', text: `Execução falhou · agente ${ev.run.agentId}`, agent: ev.run.agentId });
      break;
    case 'approval.requested': {
      if (!once(`ap:${ev.approval.id}`)) break;
      const agent = (db.prepare('SELECT agent_id FROM runs WHERE id = ?').get(ev.approval.runId) as { agent_id: string } | undefined)?.agent_id;
      pushEvent({ kind: 'approval_requested', level: 'info', text: agent ? `Aprovação pedida · agente ${agent}` : 'Aprovação pedida', ...(agent ? { agent } : {}) });
      break;
    }
    case 'approval.resolved':
      if (once(`apr:${ev.approvalId}`)) pushEvent({ kind: 'approval_resolved', level: 'info', text: `Aprovação decidida · ${ev.approved ? 'aprovada' : 'negada'}` });
      break;
    case 'live.status':
      if (ev.active !== voiceOn) {
        voiceOn = ev.active;
        pushEvent({ kind: ev.active ? 'voice_on' : 'voice_off', level: 'info', text: ev.active ? 'Voz ligada' : 'Voz desligada' });
      }
      break;
  }
});

{
  const prev = kvGet('last_version');
  if (prev && prev !== VERSION) pushEvent({ kind: 'version_changed', level: 'info', text: `Versão ${prev} → ${VERSION}` });
  if (prev !== VERSION) kvSet('last_version', VERSION);
  pushEvent({ kind: 'boot', level: 'info', text: `Atria OS iniciou · versão ${VERSION}` });
}

// ---------- containers ----------

interface RawContainer { Id: string; Names: string[]; State: string; Labels?: Record<string, string> }
interface Inspect { RestartCount?: number; State?: { Status?: string; StartedAt?: string; Health?: { Status?: string } } }

let ownProject: string | null | undefined; // projeto compose desta instalação (undefined = ainda não lido)
const lastSeen = new Map<string, { restarts: number | null; startedAt: string | null }>();

async function containers(): Promise<TelemetrySnapshot['containers']> {
  try {
    const r = await dget('/containers/json?all=1');
    if (!r.ok) return [];
    const list = (await r.json()) as RawContainer[];
    if (ownProject === undefined) {
      const me = await dget(`/containers/${encodeURIComponent(hostname())}/json`).catch(() => null);
      if (me?.ok) ownProject = ((await me.json()) as { Config?: { Labels?: Record<string, string> } }).Config?.Labels?.['com.docker.compose.project'] ?? null;
    }
    // só os containers da stack desta instalação (outra coisa na VPS não é assunto do monitor)
    const mine = ownProject ? list.filter((c) => c.Labels?.['com.docker.compose.project'] === ownProject) : list;
    const out = await Promise.all(
      mine.map(async (c) => {
        const name = c.Names[0]?.replace(/^\//, '') ?? '?';
        const i = await dget(`/containers/${c.Id}/json`)
          .then((x) => (x.ok ? (x.json() as Promise<Inspect>) : null))
          .catch(() => null);
        const started = i?.State?.StartedAt && !i.State.StartedAt.startsWith('0001') ? i.State.StartedAt : null;
        return { name, state: i?.State?.Status ?? c.State, health: i?.State?.Health?.Status ?? null, restarts: i?.RestartCount ?? null, startedAt: started };
      }),
    );
    for (const c of out) {
      const prev = lastSeen.get(c.name);
      const restarted = prev && ((c.restarts !== null && prev.restarts !== null && c.restarts > prev.restarts) || (c.startedAt && prev.startedAt && c.startedAt !== prev.startedAt));
      if (restarted) pushEvent({ kind: 'container_restart', level: 'warn', text: `${c.name} reiniciou` });
      lastSeen.set(c.name, { restarts: c.restarts, startedAt: c.startedAt });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// ---------- canal de comandos (central.ts se inscreve) ----------
// O que a instância anuncia além das métricas (capabilities, suporte, atualizador) e o que fazer com
// os comandos que o Central devolve na resposta do pulso. Sem inscrito = só telemetria, como antes.

type InstanceExtras = Pick<TelemetrySnapshot['instance'], 'capabilities' | 'supportAllowed' | 'updatesAllowed' | 'updater'>;
let extrasProvider: (() => Promise<InstanceExtras>) | null = null;
let commandsHandler: ((res: IngestResponse, central: { url: string; key: string }) => void) | null = null;
export function setInstanceExtras(fn: () => Promise<InstanceExtras>) {
  extrasProvider = fn;
}
export function onIngestCommands(fn: (res: IngestResponse, central: { url: string; key: string }) => void) {
  commandsHandler = fn;
}

// ---------- coleta ----------

const diskPct = (path: string) => {
  try {
    const s = statfsSync(path);
    return Math.round((1 - s.bavail / s.blocks) * 100);
  } catch {
    return null;
  }
};
// contagem tolerante: a tabela pode não existir (módulo não carregado)
const count = (sql: string, ...p: unknown[]) => {
  try {
    return (db.prepare(sql).get(...p) as { n: number }).n;
  } catch {
    return 0;
  }
};

export async function collectTelemetry(opts: { events: 'since' | 'recent'; upto?: number }): Promise<TelemetrySnapshot> {
  const nowMs = Date.now();
  const d24 = new Date(nowMs - 24 * 3600_000).toISOString();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const [h, ctrs, extras] = await Promise.all([healthFull({ light: true }), containers(), extrasProvider ? extrasProvider().catch(() => ({})) : Promise.resolve({})]);
  const mem = hostMem();

  const states = Object.fromEntries((db.prepare(`SELECT state, COUNT(*) AS n FROM runs WHERE state IN ('queued','running','waiting_approval') GROUP BY state`).all() as { state: string; n: number }[]).map((r) => [r.state, r.n]));
  const byAgent = (
    db
      .prepare(`SELECT agent_id, COUNT(*) AS n, SUM(state = 'failed') AS failed, SUM(cost_usd) AS cost FROM runs WHERE created_at >= ? GROUP BY agent_id ORDER BY n DESC`)
      .all(d24) as { agent_id: string; n: number; failed: number | null; cost: number | null }[]
  ).map((r) => ({ id: r.agent_id, name: findAgent(r.agent_id)?.name ?? r.agent_id, runs24h: r.n, failed24h: r.failed ?? 0, cost24h: Math.round((r.cost ?? 0) * 10_000) / 10_000 }));

  const usage = usageReport(7);
  const limits = claudeLimits();
  const lim = (kind: string) => limits?.limits.find((l) => l.kind === kind);
  const pct = (v: number | null | undefined) => (typeof v === 'number' ? Math.round(v) : null);

  const upto = opts.upto ?? seq;
  const events = opts.events === 'since' ? ring.filter((e) => e.seq > acked && e.seq <= upto) : ring.slice(-50);

  return {
    schema: 1,
    at: new Date(nowMs).toISOString(),
    instance: {
      id: instanceId(),
      domain: config.domain,
      name: String(getSetting('user.name') ?? '') || null,
      version: VERSION,
      product: 'atria-os',
      startedAt: STARTED_AT.toISOString(),
      uptimeSec: Math.round(process.uptime()),
      hostUptimeSec: mem.uptimeSec,
      tz: config.timezone,
      ...extras,
    },
    host: {
      cpu: cpuNow(),
      ram: mem.ram,
      disk: diskPct(config.dataDir),
      diskWorkspace: diskPct(config.workspaceDir),
      load: mem.load.length === 3 ? [mem.load[0], mem.load[1], mem.load[2]] : null,
      memTotalMb: mem.memTotalMb,
    },
    containers: ctrs,
    runs: {
      today: count('SELECT COUNT(*) AS n FROM runs WHERE created_at >= ?', dayStart.toISOString()),
      done24h: count(`SELECT COUNT(*) AS n FROM runs WHERE state = 'done' AND COALESCE(finished_at, created_at) >= ?`, d24),
      failed24h: count(`SELECT COUNT(*) AS n FROM runs WHERE state = 'failed' AND COALESCE(finished_at, created_at) >= ?`, d24),
      queued: states.queued ?? 0,
      running: states.running ?? 0,
      waitingApproval: states.waiting_approval ?? 0,
      maxConcurrent: config.maxConcurrentRuns,
    },
    byAgent,
    work: {
      approvalsPending: count(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'`),
      missionsActive: count(`SELECT COUNT(*) AS n FROM missions WHERE status IN ('running','paused','blocked')`),
      workflowsRunning: count(`SELECT COUNT(*) AS n FROM workflow_runs WHERE status IN ('running','waiting_approval')`),
      remindersPending: count(`SELECT COUNT(*) AS n FROM reminders WHERE status = 'pending'`),
      voiceActive: h.live,
      lastUserActivity: kvGet('last_active'),
    },
    ai: {
      claude: {
        plan: claudeAccount()?.subscriptionType ?? null,
        session: pct(lim('five_hour')?.pct),
        sessionResetsAt: lim('five_hour')?.resetsAt ?? null,
        week: pct(lim('seven_day')?.pct),
        weekResetsAt: lim('seven_day')?.resetsAt ?? null,
        cost7d: Math.round(usage.claude.cost * 100) / 100,
        tokens7d: usage.claude.tokens,
        limitsAt: limits?.at ?? null,
      },
      openai: {
        today: Math.round(usage.openai.today * 100) / 100,
        d7: Math.round(usage.openai.d7 * 100) / 100,
        d30: Math.round(usage.openai.d30 * 100) / 100,
        unpriced: usage.openai.unpriced,
      },
    },
    services: { openai: h.openai, claude: h.claudeAuth, github: h.github, browser: h.browser, dockerProxy: h.dockerProxy, company: h.company },
    errors: errorsSummary(),
    events: events.map((e) => e.ev),
  };
}

// ---------- pulso ----------

export function monitorConfig(): { enabled: boolean; url: string; key: string } {
  const url = String(getSetting('monitor.url') ?? '').trim();
  const key = String(getSetting('monitor.key') ?? '').trim();
  // sem escolha explícita (painel ou ATRIA_MONITOR_ENABLED), endereço + chave no .env já ligam
  const raw = rawGet('monitor.enabled') ?? readEnv('ATRIA_MONITOR_ENABLED') ?? '';
  const enabled = raw === '' ? !!(url && key) : raw === 'true' || raw === '1';
  return { enabled, url, key };
}

export interface PulseResult { at: string; ok: boolean; status: number | null; ms: number; error: string | null }

/** 30 s, 30 s, 60 s, 120 s… até 5 min conforme as falhas seguidas. */
export const backoffMs = (fails: number) => Math.min(30_000 * 2 ** Math.max(0, fails - 1), 300_000);

let fails = 0;
let inflight: Promise<PulseResult> | null = null;
export const pulseState = () => ({ fails, acked, seq, pending: ring.filter((e) => e.seq > acked).length });

export function sendPulse(override?: { url?: string; key?: string }): Promise<PulseResult> {
  inflight ??= (async () => {
    const m = monitorConfig();
    const url = (override?.url || m.url).replace(/\/+$/, '');
    const key = override?.key || m.key;
    const t0 = Date.now();
    let res: PulseResult;
    if (!url || !key) res = { at: now(), ok: false, status: null, ms: 0, error: 'Informe o endereço do monitor e a chave.' };
    else if (!validMonitorUrl(url)) res = { at: now(), ok: false, status: null, ms: 0, error: 'Endereço inválido: use https://' };
    else {
      const upto = seq;
      try {
        const body = JSON.stringify(await collectTelemetry({ events: 'since', upto }));
        const r = await fetch(`${url}/api/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body, signal: AbortSignal.timeout(10_000) });
        // 200 com JSON = comandos do Central (204 = nada pendente). Corpo ruim não derruba o pulso.
        if (r.status === 200 && (r.headers.get('content-type') ?? '').includes('json')) {
          const j = (await r.json().catch(() => null)) as IngestResponse | null;
          if (j && Array.isArray(j.commands) && j.commands.length && commandsHandler) {
            try {
              commandsHandler(j, { url, key });
            } catch (e) {
              console.error('comandos do Central', (e as Error).message);
            }
          }
        } else await r.body?.cancel();
        res = { at: now(), ok: r.ok, status: r.status, ms: Date.now() - t0, error: r.ok ? null : r.status === 401 || r.status === 403 ? 'Chave recusada pelo monitor' : `Monitor respondeu ${r.status}` };
        if (r.ok) acked = Math.max(acked, upto);
      } catch (e) {
        const err = e as Error;
        res = { at: now(), ok: false, status: null, ms: Date.now() - t0, error: err.name === 'TimeoutError' ? 'Sem resposta em 10 s' : (err.cause as Error | undefined)?.message ?? err.message };
      }
    }
    fails = res.ok ? 0 : fails + 1;
    kvSet('monitor_last', JSON.stringify(res));
    return res;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

let timer: NodeJS.Timeout | null = null;
function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = null;
  const m = monitorConfig();
  if (!m.enabled || !m.url || !m.key) return;
  timer = setTimeout(async () => {
    await sendPulse().catch(() => null);
    schedule(backoffMs(fails));
  }, ms);
  timer.unref();
}

let started = false;
export function startMonitor() {
  if (started) return;
  started = true;
  onSettingsChange((keys) => {
    if (!keys.some((k) => k.startsWith('monitor.'))) return;
    fails = 0;
    schedule(2_000);
  });
  schedule(10_000); // dá tempo da primeira amostra de CPU
}

// ---------- HTTP ----------

const digest = (s: string) => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export function register(app: FastifyInstance): void {
  // erros do Fastify (rotas que estouram) e do app.log.error contam como erro técnico
  app.addHook('onError', async (_req, reply, err) => {
    if ((reply.statusCode ?? 500) >= 500 || !(err as { statusCode?: number }).statusCode) recordError(err);
  });
  const logError = app.log.error.bind(app.log) as (...a: unknown[]) => void;
  app.log.error = ((...a: unknown[]) => {
    recordError(...a);
    logError(...a);
  }) as typeof app.log.error;

  // URL de saúde: pública no guard de sessão, protegida pela chave do monitor
  app.get('/api/telemetry', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const m = monitorConfig();
    if (!m.key) return reply.code(503).send({ error: 'monitoramento não configurado' });
    const got = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1]?.trim() ?? '';
    if (!got || !sameSecret(got, m.key)) return reply.code(401).send({ error: 'unauthorized' });
    if (!m.enabled) return reply.code(503).send({ error: 'monitoramento desligado' });
    reply.header('cache-control', 'no-store');
    return collectTelemetry({ events: 'recent' });
  });

  // com sessão (painel)
  app.get('/api/telemetry/preview', () => collectTelemetry({ events: 'recent' }));
  app.get('/api/telemetry/status', () => {
    const m = monitorConfig();
    const last = kvGet('monitor_last');
    return { enabled: m.enabled, url: m.url, hasKey: !!m.key, last: last ? (JSON.parse(last) as PulseResult) : null, instanceId: instanceId(), version: VERSION };
  });
  app.post('/api/telemetry/test', async (req) => {
    const b = (req.body ?? {}) as { url?: unknown; key?: unknown };
    const r = await sendPulse({ url: typeof b.url === 'string' ? b.url.trim() : undefined, key: typeof b.key === 'string' ? b.key.trim() : undefined });
    return { ok: r.ok, status: r.status, ms: r.ms, error: r.error };
  });
}
