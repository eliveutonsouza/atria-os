import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentInfo } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db } from './db.ts';

export interface AgentDef {
  id: string;
  name: string;
  description: string;
  group: string;
  nextWake: string;
  prompt: string;
  model?: string;
}

const agentsDir = () => join(config.workspaceDir, '.claude', 'agents');

function parseFrontmatter(src: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2].trim() };
}

let cache: { at: number; defs: AgentDef[] } | null = null;

export function loadAgents(): AgentDef[] {
  if (cache && Date.now() - cache.at < 10_000) return cache.defs;
  const dir = agentsDir();
  const defs: AgentDef[] = [];
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
      const { meta, body } = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
      const id = f.replace(/\.md$/, '');
      defs.push({
        id,
        name: meta.name ?? id,
        description: meta.description ?? '',
        group: meta.group ?? 'Geral',
        nextWake: meta.next_wake ?? 'sob demanda',
        model: meta.model || undefined,
        prompt: body,
      });
    }
  }
  cache = { at: Date.now(), defs };
  return defs;
}

export function findAgent(idOrName: string): AgentDef | undefined {
  const k = idOrName.toLowerCase().replace(/\s*agent$/, '').trim();
  return loadAgents().find((a) => a.id.toLowerCase() === k || a.name.toLowerCase() === k || a.name.toLowerCase().replace(/\s*agent$/, '') === k);
}

export function agentInfos(): AgentInfo[] {
  const active = db
    .prepare(`SELECT agent_id, state, task FROM runs WHERE state IN ('running','queued','waiting_approval') ORDER BY created_at DESC`)
    .all() as { agent_id: string; state: string; task: string }[];
  const last = db
    .prepare(`SELECT agent_id, MAX(COALESCE(finished_at, started_at, created_at)) AS at FROM runs GROUP BY agent_id`)
    .all() as { agent_id: string; at: string }[];
  const lastBy = new Map(last.map((r) => [r.agent_id, r.at]));
  return loadAgents().map((a) => {
    const run = active.find((r) => r.agent_id === a.id);
    const status = !run ? 'sleeping' : run.state === 'running' ? 'running' : 'waiting';
    return {
      id: a.id,
      name: a.name,
      group: a.group,
      status,
      task: run?.task ?? null,
      lastActivity: lastBy.get(a.id) ?? null,
      nextWake: run ? '—' : a.nextWake,
    } satisfies AgentInfo;
  });
}

export function agentsWorking(): number {
  const r = db.prepare(`SELECT COUNT(DISTINCT agent_id) AS n FROM runs WHERE state = 'running'`).get() as { n: number };
  return r.n;
}
