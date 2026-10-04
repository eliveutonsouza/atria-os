import type { FastifyInstance } from 'fastify';
import type { OpsBoard, OpsCard, ScheduleOccurrence, StatsOverview } from '../../shared/protocol.ts';
import { db } from './db.ts';
import { findAgent, loadAgents } from './agents.ts';

// Estatísticas do dashboard (Visão geral, Operações, Agentes, Agendamentos). Tudo calculado do SQLite — nunca do LLM.

const DAY = 86400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const agentName = (id: string) => findAgent(id)?.name ?? id;
const tableExists = (name: string) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);

type RunRow = {
  id: string; agent_id: string; project: string | null; task: string; state: string; origin: string; progress: number;
  created_at: string; started_at: string | null; finished_at: string | null; cost_usd: number; tokens_in: number; tokens_out: number;
  tools: string; mission_id: string | null; workflow_run_id: string | null; routine_id: string | null;
};

const runTools = (r: RunRow): string[] => {
  try {
    return JSON.parse(r.tools) as string[];
  } catch {
    return [];
  }
};

function overview(days: number): StatsOverview {
  const today = startOfToday();
  const since30 = today - 29 * DAY;
  const sinceN = Date.now() - days * DAY;
  const rows = db.prepare(`SELECT * FROM runs WHERE created_at >= ?`).all(iso(Math.min(since30, sinceN))) as RunRow[];
  const recent = rows.filter((r) => r.created_at >= iso(sinceN));
  const done = recent.filter((r) => r.state === 'done').length;
  const failed = recent.filter((r) => r.state === 'failed').length;

  const daily = Array.from({ length: 30 }, (_, i) => ({ date: dayKey(new Date(since30 + i * DAY)), done: 0, failed: 0, routine: 0 }));
  const byDay = new Map(daily.map((x) => [x.date, x]));
  for (const r of rows) {
    const slot = byDay.get(dayKey(new Date(r.created_at)));
    if (!slot) continue;
    if (r.state === 'failed') slot.failed++;
    else if (r.state === 'done') {
      if (r.origin === 'routine') slot.routine++;
      else slot.done++;
    }
  }

  const agents = new Map<string, { runs: number; ok: number; fin: number; ms: number[]; cost: number; tokens: number }>();
  for (const r of recent) {
    const a = agents.get(r.agent_id) ?? { runs: 0, ok: 0, fin: 0, ms: [], cost: 0, tokens: 0 };
    a.runs++;
    if (r.state === 'done' || r.state === 'failed') a.fin++;
    if (r.state === 'done') a.ok++;
    if (r.started_at && r.finished_at) a.ms.push(new Date(r.finished_at).getTime() - new Date(r.started_at).getTime());
    a.cost += r.cost_usd || 0;
    a.tokens += (r.tokens_in || 0) + (r.tokens_out || 0);
    agents.set(r.agent_id, a);
  }
  const byAgent = [...agents.entries()]
    .map(([id, a]) => ({
      agentId: id,
      agent: agentName(id),
      runs: a.runs,
      success: a.fin ? Math.round((a.ok / a.fin) * 100) : null,
      avgMs: a.ms.length ? Math.round(a.ms.reduce((x, y) => x + y, 0) / a.ms.length) : null,
      costUsd: Math.round(a.cost * 100) / 100,
      tokens: a.tokens,
    }))
    .sort((x, y) => y.runs - x.runs);

  const toolCount = new Map<string, number>();
  for (const r of recent) for (const t of runTools(r)) toolCount.set(t, (toolCount.get(t) ?? 0) + 1);
  const topTools = [...toolCount.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10);

  const active = db.prepare(`SELECT COUNT(DISTINCT agent_id) AS n FROM runs WHERE state = 'running'`).get() as { n: number };
  const approvals = db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'`).get() as { n: number };
  return {
    kpis: {
      runsToday: rows.filter((r) => r.created_at >= iso(today)).length,
      runsYesterday: rows.filter((r) => r.created_at >= iso(today - DAY) && r.created_at < iso(today)).length,
      success7d: done + failed ? Math.round((done / (done + failed)) * 100) : null,
      failed7d: failed,
      agentsActive: active.n,
      agentsTotal: loadAgents().length,
      approvals: approvals.n,
      cost7d: Math.round(recent.reduce((s, r) => s + (r.cost_usd || 0), 0) * 100) / 100,
      tokens7d: recent.reduce((s, r) => s + (r.tokens_in || 0) + (r.tokens_out || 0), 0),
    },
    daily,
    byAgent,
    topTools,
  };
}

// Estatísticas de um agente (página Agentes › Estatísticas).
function agentStats(agentId: string) {
  const since = startOfToday() - 13 * DAY;
  const rows = db.prepare(`SELECT * FROM runs WHERE agent_id = ? AND created_at >= ?`).all(agentId, iso(startOfToday() - 29 * DAY)) as RunRow[];
  const daily = Array.from({ length: 14 }, (_, i) => ({ date: dayKey(new Date(since + i * DAY)), runs: 0, failed: 0 }));
  const byDay = new Map(daily.map((x) => [x.date, x]));
  const tools = new Map<string, number>();
  let ok = 0, fin = 0, cost = 0, tokens = 0;
  const ms: number[] = [];
  for (const r of rows) {
    const slot = byDay.get(dayKey(new Date(r.created_at)));
    if (slot) {
      slot.runs++;
      if (r.state === 'failed') slot.failed++;
    }
    if (r.state === 'done' || r.state === 'failed') fin++;
    if (r.state === 'done') ok++;
    if (r.started_at && r.finished_at) ms.push(new Date(r.finished_at).getTime() - new Date(r.started_at).getTime());
    cost += r.cost_usd || 0;
    tokens += (r.tokens_in || 0) + (r.tokens_out || 0);
    for (const t of runTools(r)) tools.set(t, (tools.get(t) ?? 0) + 1);
  }
  return {
    runs30d: rows.length,
    success: fin ? Math.round((ok / fin) * 100) : null,
    avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
    costUsd: Math.round(cost * 100) / 100,
    tokens,
    daily,
    topTools: [...tools.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
  };
}

function originLabel(r: RunRow): string | null {
  try {
    if (r.mission_id && tableExists('missions')) {
      const m = db.prepare('SELECT title FROM missions WHERE id = ?').get(r.mission_id) as { title: string } | undefined;
      return m?.title ?? null;
    }
    if (r.workflow_run_id && tableExists('workflow_runs')) {
      const w = db.prepare('SELECT workflow FROM workflow_runs WHERE id = ?').get(r.workflow_run_id) as { workflow: string } | undefined;
      return w?.workflow ?? null;
    }
    if (r.routine_id) {
      const ro = db.prepare('SELECT name FROM routines WHERE id = ?').get(r.routine_id) as { name: string } | undefined;
      return ro?.name ?? null;
    }
  } catch {
    /* ignora */
  }
  return null;
}

const ORIGINS = ['yui', 'manual', 'routine', 'mission', 'workflow'];
const toCard = (r: RunRow): OpsCard => ({
  id: r.id,
  kind: 'run',
  agent: agentName(r.agent_id),
  agentId: r.agent_id,
  task: r.task,
  origin: (ORIGINS.includes(r.origin) ? r.origin : 'yui') as OpsCard['origin'],
  originLabel: originLabel(r),
  project: r.project,
  startedAt: r.started_at,
  progress: Math.round(r.progress || 0),
});

function opsBoard(): OpsBoard {
  const today = iso(startOfToday());
  const since24 = iso(Date.now() - DAY);
  const live = db.prepare(`SELECT * FROM runs WHERE state IN ('queued','running','waiting_approval') ORDER BY created_at`).all() as RunRow[];
  const doneToday = db.prepare(`SELECT * FROM runs WHERE state = 'done' AND finished_at >= ? ORDER BY finished_at DESC LIMIT 12`).all(today) as RunRow[];
  const failed = db.prepare(`SELECT * FROM runs WHERE state = 'failed' AND finished_at >= ? ORDER BY finished_at DESC LIMIT 10`).all(since24) as RunRow[];
  const approvals = db.prepare(`SELECT id, run_id, title, created_at FROM approvals WHERE status = 'pending' ORDER BY created_at`).all() as {
    id: string; run_id: string; title: string; created_at: string;
  }[];
  const runById = (id: string) => db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
  const waiting: OpsCard[] = approvals.map((a) => {
    const r = runById(a.run_id);
    return {
      id: a.id,
      kind: 'approval',
      agent: r ? agentName(r.agent_id) : 'Workflow',
      agentId: r?.agent_id ?? '',
      task: a.title,
      origin: r && ORIGINS.includes(r.origin) ? (r.origin as OpsCard['origin']) : 'workflow',
      originLabel: r ? originLabel(r) : null,
      project: r?.project ?? null,
      startedAt: a.created_at,
      progress: Math.round(r?.progress ?? 0),
    };
  });
  const count = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;
  const missions = tableExists('missions') ? count(`SELECT COUNT(*) AS n FROM missions WHERE status IN ('running','paused','blocked')`) : 0;
  const workflows = tableExists('workflow_runs') ? count(`SELECT COUNT(*) AS n FROM workflow_runs WHERE status IN ('running','waiting_approval')`) : 0;

  const spans = db
    .prepare(`SELECT * FROM runs WHERE started_at IS NOT NULL AND (finished_at IS NULL OR finished_at >= ?) ORDER BY started_at`)
    .all(since24) as RunRow[];
  const gantt = new Map<string, OpsBoard['gantt'][number]>();
  for (const r of spans) {
    const g = gantt.get(r.agent_id) ?? { agentId: r.agent_id, agent: agentName(r.agent_id), spans: [] };
    g.spans.push({ start: r.started_at!, end: r.finished_at, state: r.state, task: r.task });
    gantt.set(r.agent_id, g);
  }
  return {
    pipeline: {
      inbound: count(`SELECT COUNT(*) AS n FROM messages WHERE who = 'user' AND at >= ?`, today),
      brain: count(`SELECT COUNT(*) AS n FROM runs WHERE origin = 'yui' AND created_at >= ?`, today),
      missions,
      workflows,
      running: live.filter((r) => r.state === 'running').length,
      queued: live.filter((r) => r.state === 'queued').length,
      approvals: approvals.length,
      doneToday: count(`SELECT COUNT(*) AS n FROM runs WHERE state = 'done' AND finished_at >= ?`, today),
    },
    columns: {
      queued: live.filter((r) => r.state === 'queued').map(toCard),
      running: live.filter((r) => r.state === 'running').map(toCard),
      waiting: [...waiting, ...live.filter((r) => r.state === 'waiting_approval' && !approvals.some((a) => a.run_id === r.id)).map(toCard)],
      doneToday: doneToday.map(toCard),
      failed: failed.map(toCard),
    },
    gantt: [...gantt.values()],
  };
}

// ---------- cron (5 campos) → ocorrências, no fuso do servidor (TZ) ----------
function field(spec: string, min: number, max: number): Set<number> | null {
  if (spec === '*') return null; // qualquer valor
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const [range, stepS] = part.split('/');
    const step = stepS ? Math.max(1, Number(stepS)) : 1;
    let lo = min, hi = max;
    if (range !== '*') {
      const [a, b] = range.split('-').map(Number);
      lo = a;
      hi = b === undefined || Number.isNaN(b) ? (stepS ? max : a) : b;
    }
    if (Number.isNaN(lo) || Number.isNaN(hi)) throw new Error(`cron inválido: ${spec}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function cronOccurrences(expr: string, from: Date, to: Date, limit = 500): Date[] {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return [];
  const [mi, ho, dom, mo, dow] = [field(p[0], 0, 59), field(p[1], 0, 23), field(p[2], 1, 31), field(p[3], 1, 12), field(p[4], 0, 7)];
  if (dow?.has(7)) dow.add(0);
  const out: Date[] = [];
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  const minutes = mi ? [...mi].sort((a, b) => a - b) : Array.from({ length: 60 }, (_, i) => i);
  const hours = ho ? [...ho].sort((a, b) => a - b) : Array.from({ length: 24 }, (_, i) => i);
  while (day <= to && out.length < limit) {
    const okMonth = !mo || mo.has(day.getMonth() + 1);
    const domOk = !dom || dom.has(day.getDate());
    const dowOk = !dow || dow.has(day.getDay());
    // cron padrão: com dia-do-mês e dia-da-semana ambos restritos, basta um casar
    const okDay = dom && dow ? domOk || dowOk : domOk && dowOk;
    if (okMonth && okDay) {
      for (const h of hours) {
        for (const m of minutes) {
          const t = new Date(day);
          t.setHours(h, m, 0, 0);
          if (t >= from && t <= to) out.push(t);
          if (out.length >= limit) return out;
        }
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return out;
}

function occurrences(from: Date, to: Date): ScheduleOccurrence[] {
  const routines = db.prepare('SELECT * FROM routines').all() as {
    id: string; name: string; cron: string; agent_id: string | null; workflow_id: string | null; enabled: number;
  }[];
  const out: ScheduleOccurrence[] = [];
  for (const r of routines) {
    let dates: Date[] = [];
    try {
      dates = cronOccurrences(r.cron, from, to, 200);
    } catch {
      continue;
    }
    for (const d of dates) out.push({ routineId: r.id, name: r.name, at: d.toISOString(), workflow: r.workflow_id, agentId: r.agent_id, enabled: !!r.enabled });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export function register(app: FastifyInstance): void {
  app.get('/api/stats/overview', (req) => {
    const days = Math.min(90, Math.max(1, Number((req.query as { days?: string }).days) || 7));
    return overview(days);
  });
  app.get('/api/stats/agent/:id', (req) => agentStats((req.params as { id: string }).id));
  app.get('/api/ops/board', () => opsBoard());
  app.get('/api/schedule/occurrences', (req) => {
    const q = req.query as { from?: string; to?: string };
    const from = q.from ? new Date(q.from) : new Date();
    const to = q.to ? new Date(q.to) : new Date(from.getTime() + 7 * DAY);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to.getTime() - from.getTime() > 62 * DAY) return [];
    return occurrences(from, to);
  });
}
