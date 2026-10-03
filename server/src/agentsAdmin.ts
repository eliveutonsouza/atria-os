import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AgentConfig, RunInfo } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db } from './db.ts';
import { emit } from './bus.ts';
import { agentsDir, invalidateAgents, loadAllAgents, serializeAgent, type AgentDef } from './agents.ts';
import { registerAgentOptions, registerBrain, registerRunPrompt } from './extensions.ts';
import { getInit } from './capabilities.ts';
import { toRunInfo } from './runs.ts';

// Agentes navegáveis e configuráveis: skills, MCP (allowlist), plugins, modelo e turnos por agente,
// gravados no frontmatter de /workspace/.claude/agents/<id>.md (o mesmo arquivo que o Claude Code lê).

const historyDir = () => join(config.workspaceDir, '.yui', 'agents-history');

export function toConfig(a: AgentDef): AgentConfig {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    group: a.group,
    prompt: a.prompt,
    model: a.model ?? null,
    maxTurns: a.maxTurns ?? null,
    skills: a.skills,
    mcp: a.mcp,
    plugins: a.plugins,
    color: a.color ?? null,
    archived: a.archived,
  };
}

const findAny = (id: string) => loadAllAgents().find((a) => a.id === id);

function writeAgent(a: AgentDef, keepHistory = true) {
  const dir = agentsDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${a.id}.md`);
  if (keepHistory && existsSync(file)) {
    mkdirSync(historyDir(), { recursive: true });
    cpSync(file, join(historyDir(), `${a.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`));
  }
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, serializeAgent(a));
  renameSync(tmp, file);
  invalidateAgents();
}

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agente';

function uniqueId(base: string): string {
  const ids = new Set(loadAllAgents().map((a) => a.id));
  let id = slugify(base);
  for (let i = 2; ids.has(id); i++) id = `${slugify(base)}-${i}`;
  return id;
}

const str = (v: unknown, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 100) : undefined);

function applyPatch(a: AgentDef, b: Partial<AgentConfig>): AgentDef {
  const turns = b.maxTurns === null ? undefined : typeof b.maxTurns === 'number' && b.maxTurns > 0 ? Math.min(500, Math.round(b.maxTurns)) : a.maxTurns;
  return {
    ...a,
    name: str(b.name, 80)?.trim() || a.name,
    description: str(b.description, 600) ?? a.description,
    group: str(b.group, 40)?.trim() || a.group,
    prompt: str(b.prompt) ?? a.prompt,
    model: b.model === null ? undefined : str(b.model, 80)?.trim() || a.model,
    maxTurns: turns,
    skills: strs(b.skills) ?? a.skills,
    mcp: strs(b.mcp) ?? a.mcp,
    plugins: strs(b.plugins) ?? a.plugins,
    color: b.color === null ? undefined : str(b.color, 20) ?? a.color,
    archived: typeof b.archived === 'boolean' ? b.archived : a.archived,
  };
}

export function createAgent(input: Partial<AgentConfig> & { name: string }): AgentConfig {
  const blank: AgentDef = { id: uniqueId(input.name), name: input.name, description: '', group: 'Geral', nextWake: 'sob demanda', prompt: '', skills: [], mcp: [], plugins: [], archived: false, extra: {} };
  const a = applyPatch(blank, input);
  writeAgent(a, false);
  return toConfig(a);
}

// Nome do servidor MCP (como aparece no init) → prefixo das tools (`mcp__<prefixo>__*`).
export const mcpPrefix = (server: string) => server.replace(/[^a-zA-Z0-9_-]/g, '_');

function recentRuns(agentId: string): RunInfo[] {
  const rows = db
    .prepare(`SELECT * FROM runs WHERE agent_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 20`)
    .all(agentId, new Date(Date.now() - 24 * 3600_000).toISOString()) as Parameters<typeof toRunInfo>[0][];
  return rows.map(toRunInfo);
}

// Seeds novos (ex.: Designer) entram no workspace existente sem sobrescrever nada.
function seedMissingAgents() {
  const seedDir = join(config.seedDir, '.claude', 'agents');
  if (!existsSync(seedDir)) return;
  const dir = agentsDir();
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(seedDir).filter((f) => f.endsWith('.md'))) {
    if (!existsSync(join(dir, f))) {
      cpSync(join(seedDir, f), join(dir, f));
      console.log(`agentes: seed ${f} adicionado`);
    }
  }
  invalidateAgents();
}

export function register(app: FastifyInstance): void {
  seedMissingAgents();

  app.get('/api/agents/all', () => loadAllAgents().map(toConfig));

  app.get('/api/agents/:id', async (req, reply) => {
    const a = findAny((req.params as { id: string }).id);
    if (!a) return reply.code(404).send({ error: 'not found' });
    return { ...toConfig(a), runs: recentRuns(a.id) };
  });

  app.put('/api/agents/:id', async (req, reply) => {
    const a = findAny((req.params as { id: string }).id);
    if (!a) return reply.code(404).send({ error: 'not found' });
    const next = applyPatch(a, (req.body ?? {}) as Partial<AgentConfig>);
    writeAgent(next);
    return toConfig(next);
  });

  app.post('/api/agents', async (req, reply) => {
    const b = (req.body ?? {}) as Partial<AgentConfig>;
    if (!b.name?.trim()) return reply.code(400).send({ error: 'name' });
    return createAgent({ ...b, name: b.name });
  });

  app.post('/api/agents/:id/duplicate', async (req, reply) => {
    const a = findAny((req.params as { id: string }).id);
    if (!a) return reply.code(404).send({ error: 'not found' });
    const copy: AgentDef = { ...a, id: uniqueId(`${a.id}-copia`), name: `${a.name} (cópia)`, archived: false };
    writeAgent(copy, false);
    return toConfig(copy);
  });

  app.delete('/api/agents/:id', async (req, reply) => {
    const a = findAny((req.params as { id: string }).id);
    if (!a) return reply.code(404).send({ error: 'not found' });
    writeAgent({ ...a, archived: true });
    return reply.code(204).send();
  });

  // MCP fora da allowlist do agente fica bloqueado; modelo, turnos e plugins por agente.
  registerAgentOptions((agentId) => {
    const a = findAny(agentId);
    if (!a) return {};
    const opts: Record<string, unknown> = {};
    if (a.mcp.length) {
      // Allowlist aceita "Google Calendar" ou "claude.ai Google Calendar" (como aparece no init).
      const norm = (s: string) => s.toLowerCase().replace(/^claude\.ai\s+/, '').replace(/[^a-z0-9]/g, '');
      const allowed = new Set(a.mcp.map(norm));
      const servers = (getInit()?.mcp ?? []).map((m) => m.name);
      opts.disallowedTools = servers.filter((s) => !allowed.has(norm(s))).map((s) => `mcp__${mcpPrefix(s)}`);
    }
    if (a.maxTurns) opts.maxTurns = a.maxTurns;
    if (a.model) opts.model = a.model;
    if (a.plugins.length) {
      const paths = new Map((getInit()?.plugins ?? []).map((p) => [p.name, p.path]));
      opts.plugins = a.plugins.filter((p) => paths.has(p)).map((p) => ({ type: 'local' as const, path: paths.get(p)! }));
    }
    return opts;
  });

  // Skills, plugins e conectores preferidos entram como orientação no system prompt do agente.
  registerRunPrompt(({ agentId }) => {
    const a = findAny(agentId);
    if (!a) return null;
    const parts: string[] = [];
    if (a.skills.length) parts.push(`- Skills deste agente (use via Skill quando fizer sentido; evite outras): ${a.skills.join(', ')}.`);
    if (a.plugins.length) parts.push(`- Plugins preferidos: ${a.plugins.join(', ')}.`);
    if (a.mcp.length) parts.push(`- Conectores MCP liberados para você: ${a.mcp.join(', ')}.`);
    return parts.join('\n') || null;
  });

  registerBrain({
    name: 'agents-admin',
    tools: [
      {
        type: 'function',
        name: 'create_agent',
        strict: true,
        description: 'Cria um agente especialista novo quando nenhum existente serve (aparece em Agentes e pode ser usado na hora).',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'description', 'group', 'prompt', 'mcp'],
          properties: {
            name: { type: 'string' },
            description: { type: 'string', description: 'especialidade em uma frase (usada para roteamento)' },
            group: { type: 'string', description: 'Engineering | Operações | Growth | Design | outro' },
            prompt: { type: 'string', description: 'instruções de trabalho do agente em português' },
            mcp: { type: 'array', items: { type: 'string' }, description: 'servidores MCP liberados (vazio = todos)' },
          },
        },
      },
      {
        type: 'function',
        name: 'open_agent',
        strict: true,
        description: 'Abre a ficha de um agente (prompt, skills, MCP, plugins, execuções) para o usuário ver/editar.',
        parameters: { type: 'object', additionalProperties: false, required: ['agent'], properties: { agent: { type: 'string' } } },
      },
    ],
    run(tool, args, ctx) {
      if (tool === 'create_agent') {
        if (ctx.dryRun) return Promise.resolve({ ok: true });
        const a = createAgent({
          name: String(args.name),
          description: String(args.description),
          group: String(args.group),
          prompt: String(args.prompt),
          mcp: Array.isArray(args.mcp) ? (args.mcp as string[]) : [],
        });
        return Promise.resolve({ ok: true, id: a.id, nome: a.name });
      }
      if (tool === 'open_agent') {
        if (ctx.dryRun) return Promise.resolve({ ok: true });
        const k = String(args.agent).toLowerCase().trim();
        const a = loadAllAgents().find((x) => x.id === k || x.name.toLowerCase() === k);
        if (!a) return Promise.resolve({ ok: false, error: 'agente não encontrado' });
        emit({ type: 'ui.action', action: { type: 'show_view', view: 'agent', params: { agentId: a.id } } });
        return Promise.resolve({ ok: true });
      }
      return undefined;
    },
    instructions:
      '- "Abre o agente X", "mostra a configuração do Designer" => open_agent. Se nenhum agente servir a um pedido recorrente, crie um com create_agent e delegue a ele.',
  });
}
