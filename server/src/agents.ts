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
  maxTurns?: number;
  skills: string[]; // vazio = todas
  mcp: string[]; // allowlist de servidores MCP; vazio = todos
  plugins: string[];
  color?: string;
  archived: boolean;
  // chaves de frontmatter desconhecidas preservadas na serialização
  extra: Record<string, string>;
}

export const agentsDir = () => join(config.workspaceDir, '.claude', 'agents');

const KNOWN = new Set(['name', 'description', 'group', 'next_wake', 'model', 'max_turns', 'skills', 'mcp', 'plugins', 'color', 'archived']);

export function parseFrontmatter(src: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = unquote(line.slice(i + 1).trim());
  }
  return { meta, body: m[2].trim() };
}

function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"');
  return v;
}

// Listas YAML simples: `[a, b]` ou `a, b`.
export function parseList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((x) => x.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

export function parseAgent(id: string, src: string): AgentDef {
  const { meta, body } = parseFrontmatter(src);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) if (!KNOWN.has(k)) extra[k] = v;
  const turns = Number(meta.max_turns);
  return {
    id,
    name: meta.name || id,
    description: meta.description ?? '',
    group: meta.group || 'Geral',
    nextWake: meta.next_wake || 'sob demanda',
    model: meta.model || undefined,
    maxTurns: Number.isFinite(turns) && turns > 0 ? turns : undefined,
    skills: parseList(meta.skills),
    mcp: parseList(meta.mcp),
    plugins: parseList(meta.plugins),
    color: meta.color || undefined,
    archived: meta.archived === 'true',
    prompt: body,
    extra,
  };
}

// Valor de frontmatter numa linha (descrições longas não podem ter quebra).
// O Claude Code lê este frontmatter como YAML: valores com caracteres especiais vão entre aspas simples.
const one = (v: string) => {
  const t = v.replace(/\s*\n\s*/g, ' ').trim();
  return /^[\s'"[{>|*&!%@`-]|[#:]|\s$/.test(t) ? `'${t.replace(/'/g, "''")}'` : t;
};
const list = (xs: string[]) => `[${xs.map((x) => one(x.replace(/[,\]\['"]/g, ''))).join(', ')}]`;

export function serializeAgent(a: AgentDef): string {
  const lines = [`name: ${one(a.name)}`, `description: ${one(a.description)}`, `group: ${one(a.group)}`];
  if (a.nextWake && a.nextWake !== 'sob demanda') lines.push(`next_wake: ${one(a.nextWake)}`);
  if (a.model) lines.push(`model: ${one(a.model)}`);
  if (a.maxTurns) lines.push(`max_turns: ${a.maxTurns}`);
  if (a.skills.length) lines.push(`skills: ${list(a.skills)}`);
  if (a.mcp.length) lines.push(`mcp: ${list(a.mcp)}`);
  if (a.plugins.length) lines.push(`plugins: ${list(a.plugins)}`);
  if (a.color) lines.push(`color: ${one(a.color)}`);
  if (a.archived) lines.push('archived: true');
  for (const [k, v] of Object.entries(a.extra)) lines.push(`${k}: ${one(v)}`);
  return `---\n${lines.join('\n')}\n---\n${a.prompt.trim()}\n`;
}

let cache: { at: number; defs: AgentDef[] } | null = null;
export const invalidateAgents = () => {
  cache = null;
};

// Todos os agentes, inclusive arquivados (admin).
export function loadAllAgents(): AgentDef[] {
  if (cache && Date.now() - cache.at < 10_000) return cache.defs;
  const dir = agentsDir();
  const defs: AgentDef[] = [];
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
      defs.push(parseAgent(f.replace(/\.md$/, ''), readFileSync(join(dir, f), 'utf8')));
    }
  }
  cache = { at: Date.now(), defs };
  return defs;
}

// Agentes ativos (arquivados somem das listas, do cérebro e da fila).
export function loadAgents(): AgentDef[] {
  return loadAllAgents().filter((a) => !a.archived);
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
