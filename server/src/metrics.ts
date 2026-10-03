import { existsSync, readdirSync, readFileSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import type { Brief, InfraPayload, Overview, ReportPayload, Tone } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, kvGet } from './db.ts';
import { agentsWorking, loadAgents } from './agents.ts';
import { projectSummaries, hhmm } from './projects.ts';
import { listContainers } from './docker.ts';

// KPIs vêm do banco, nunca do LLM (§110).

export async function overview(): Promise<Overview> {
  const nowMs = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const runsToday = (db.prepare('SELECT COUNT(*) AS n FROM runs WHERE created_at >= ?').get(dayStart.toISOString()) as { n: number }).n;
  const fin = db
    .prepare(`SELECT state, created_at, finished_at FROM runs WHERE created_at >= ? AND state IN ('done','failed')`)
    .all(new Date(nowMs - 30 * 86400_000).toISOString()) as { state: string; created_at: string; finished_at: string | null }[];
  const last24 = db.prepare('SELECT created_at FROM runs WHERE created_at >= ?').all(new Date(nowMs - 24 * 3600_000).toISOString()) as {
    created_at: string;
  }[];

  const bars24h = Array<number>(24).fill(0);
  for (const r of last24) {
    const hoursAgo = Math.floor((nowMs - new Date(r.created_at).getTime()) / 3600_000);
    if (hoursAgo >= 0 && hoursAgo < 24) bars24h[23 - hoursAgo]++;
  }
  const days: { ok: number; total: number }[] = Array.from({ length: 30 }, () => ({ ok: 0, total: 0 }));
  for (const r of fin) {
    const d = Math.floor((nowMs - new Date(r.created_at).getTime()) / 86400_000);
    if (d >= 0 && d < 30) {
      days[29 - d].total++;
      if (r.state === 'done') days[29 - d].ok++;
    }
  }
  const okAll = fin.filter((r) => r.state === 'done').length;
  return {
    agentsTotal: loadAgents().length,
    agentsActive: agentsWorking(),
    runsToday,
    successRate: fin.length ? Math.round((okAll / fin.length) * 100) : null,
    bars24h,
    success30d: days.map((d) => (d.total ? Math.round((d.ok / d.total) * 100) : null)),
    projects: await projectSummaries(),
  };
}

export function brief(): Brief {
  const since = kvGet('last_seen');
  const from = since ?? new Date(Date.now() - 12 * 3600_000).toISOString();
  const rows = db
    .prepare(`SELECT task, state, origin, agent_id, finished_at, created_at FROM runs WHERE created_at >= ? ORDER BY created_at`)
    .all(from) as { task: string; state: string; origin: string; agent_id: string; finished_at: string | null; created_at: string }[];
  const routines = rows.filter((r) => r.origin === 'routine' && r.state === 'done').length;
  const done = rows.filter((r) => r.state === 'done').length;
  const failed = rows.filter((r) => r.state === 'failed').length;
  const approvals = (db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'`).get() as { n: number }).n;
  const attention = failed + approvals;
  const reports = latestReport() ? 1 : 0;
  const lines: Brief['lines'] = [];
  if (routines) lines.push({ n: String(routines), text: routines === 1 ? 'rotina foi executada.' : 'rotinas foram executadas.', tone: 'cyan' });
  if (done - routines > 0) lines.push({ n: String(done - routines), text: 'tarefas foram concluídas.', tone: 'ok' });
  if (attention) lines.push({ n: String(attention), text: attention === 1 ? 'item precisa da sua atenção.' : 'itens precisam da sua atenção.', tone: 'warn' });
  return {
    since,
    kpis: [
      { value: String(routines), label: 'automações concluídas', tone: 'cyan' },
      { value: String(done), label: 'execuções concluídas', tone: 'ok' },
      { value: String(reports), label: 'relatório pronto', tone: 'lav' },
      { value: String(attention), label: attention === 1 ? 'alerta' : 'alertas', tone: attention ? 'warn' : 'muted' },
    ],
    lines,
    timeline: rows.slice(-12).map((r) => ({
      t: hhmm(r.finished_at ?? r.created_at),
      label: r.task,
      result: r.state === 'done' ? '✓' : r.state === 'failed' ? 'atenção' : r.state === 'running' ? 'rodando' : 'na fila',
      tone: (r.state === 'done' ? 'ok' : r.state === 'failed' ? 'warn' : 'cyan') as Tone,
    })),
  };
}

export function latestReport(): ReportPayload | null {
  const dir = join(config.workspaceDir, '.yui', 'reports');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const f of files.reverse()) {
    try {
      const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const ts = f.replace(/\.json$/, '');
      return {
        id: ts,
        generatedBy: j.generatedBy ?? 'Report Agent',
        generatedAt: j.generatedAt ?? ts,
        title: String(j.title ?? 'Relatório'),
        lead: String(j.lead ?? ''),
        kpis: Array.isArray(j.kpis) ? j.kpis.slice(0, 4) : [],
        sections: Array.isArray(j.sections) ? j.sections : [],
      };
    } catch {
      /* próximo */
    }
  }
  return null;
}

let lastCpu: { idle: number; total: number } | null = null;
function cpuPercent(): number | null {
  try {
    const line = readFileSync(join(config.hostProc, 'stat'), 'utf8').split('\n')[0];
    const n = line.split(/\s+/).slice(1).map(Number);
    const idle = n[3] + (n[4] ?? 0);
    const total = n.reduce((a, b) => a + b, 0);
    const prev = lastCpu;
    lastCpu = { idle, total };
    if (!prev || total === prev.total) return null;
    return Math.round((1 - (idle - prev.idle) / (total - prev.total)) * 100);
  } catch {
    return null;
  }
}
setInterval(cpuPercent, 5000).unref();

export async function infra(): Promise<InfraPayload> {
  let ram: number | null = null;
  let load: number[] = [];
  try {
    const mem = readFileSync(join(config.hostProc, 'meminfo'), 'utf8');
    const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(mem)?.[1] ?? 0);
    ram = Math.round((1 - kb('MemAvailable') / kb('MemTotal')) * 100);
    load = readFileSync(join(config.hostProc, 'loadavg'), 'utf8').split(' ').slice(0, 3).map(Number);
  } catch {
    /* sem /proc do host */
  }
  let disk: number | null = null;
  try {
    const s = statfsSync('/');
    disk = Math.round((1 - s.bavail / s.blocks) * 100);
  } catch {
    /* ignore */
  }
  const containers = await listContainers()
    .then((l) =>
      l.map((c) => ({
        name: c.name,
        state: c.state,
        health: c.health,
        tone: (c.state !== 'running' ? 'crit' : c.health === 'unhealthy' ? 'warn' : 'ok') as Tone,
      })),
    )
    .catch(() => []);
  return { cpu: cpuPercent(), ram, disk, load, containers };
}
