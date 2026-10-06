import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AgentConfig, AgentUsageRef, ApprovalInfo, MissionStep, RunInfo, ToolboxItem } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, kvGet, kvSet } from './db.ts';
import { emit } from './bus.ts';
import { agentsDir, agentsWorking, invalidateAgents, loadAllAgents, serializeAgent, type AgentDef } from './agents.ts';
import { registerAgentOptions, registerBrain, registerRunPrompt } from './extensions.ts';
import { getInit } from './capabilities.ts';
import { askApproval, toRunInfo } from './runs.ts';
import { listRoutines, updateRoutine } from './routines.ts';
import { listWorkflows, saveWorkflow } from './workflows.ts';
import { getMission } from './missions.ts';
import { narrate } from './live.ts';

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

// Agentes demitidos (excluídos de vez): o seed não os traz de volta.
const deletedIds = (): string[] => {
  try {
    const v = JSON.parse(kvGet('agents_deleted') ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

// Seeds novos (ex.: Designer) entram no workspace existente sem sobrescrever nada.
export function seedMissingAgents() {
  const seedDir = join(config.seedDir, '.claude', 'agents');
  if (!existsSync(seedDir)) return;
  const dir = agentsDir();
  mkdirSync(dir, { recursive: true });
  const deleted = new Set(deletedIds());
  for (const f of readdirSync(seedDir).filter((f) => f.endsWith('.md'))) {
    if (deleted.has(f.replace(/\.md$/, ''))) continue;
    if (!existsSync(join(dir, f))) {
      cpSync(join(seedDir, f), join(dir, f));
      console.log(`agentes: seed ${f} adicionado`);
    }
  }
  invalidateAgents();
}

// ---------- demitir (excluir de vez) ----------

const toolboxFile = () => join(config.workspaceDir, '.yui', 'toolbox.json');
type ToolboxRow = Omit<ToolboxItem, 'status'>;
function readToolbox(): ToolboxRow[] {
  try {
    const list = JSON.parse(readFileSync(toolboxFile(), 'utf8')) as ToolboxRow[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const ACTIVE_MISSION = ['draft', 'running', 'paused', 'blocked'];
const OPEN_STEP = new Set(['pending', 'waiting_approval', 'running', 'failed']);
const STEP_LABEL: Record<string, string> = { pending: 'na fila', waiting_approval: 'aguardando aprovação', running: 'rodando', failed: 'falhou' };
type MissionRow = { id: string; title: string; status: string; plan_json: string };
const activeMissions = () =>
  db.prepare(`SELECT id, title, status, plan_json FROM missions WHERE status IN (${ACTIVE_MISSION.map(() => '?').join(',')}) ORDER BY created_at`).all(...ACTIVE_MISSION) as MissionRow[];
const openStepsOf = (m: MissionRow, id: string) =>
  (JSON.parse(m.plan_json) as MissionStep[]).filter((st) => st.agentId === id && OPEN_STEP.has(st.status));
const listJoin = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}` : xs[0] ?? '');

// Onde o agente está escalado: rotinas, passos de workflow, etapas de missões em aberto e Caixa de Ferramentas.
export function agentUsage(id: string): AgentUsageRef[] {
  const refs: AgentUsageRef[] = [];
  for (const r of listRoutines()) if (r.agent_id === id) refs.push({ kind: 'routine', id: r.id, label: `${r.name} · ${r.cron}` });
  for (const w of listWorkflows()) {
    const steps = w.nodes.filter((n) => n.type === 'task' && n.agent === id).map((n) => n.id);
    if (steps.length) refs.push({ kind: 'workflow', id: w.slug, label: w.name, detail: `${steps.length > 1 ? 'passos' : 'passo'} ${listJoin(steps)}` });
  }
  for (const m of activeMissions()) {
    const steps = openStepsOf(m, id);
    if (steps.length) {
      const detail = steps.length === 1 ? `etapa ${steps[0].id} (${STEP_LABEL[steps[0].status] ?? steps[0].status})` : `etapas ${listJoin(steps.map((st) => st.id))}`;
      refs.push({ kind: 'mission', id: m.id, label: m.title, detail });
    }
  }
  for (const t of readToolbox()) if (t.agent === id) refs.push({ kind: 'toolbox', id: t.id, label: t.name });
  return refs;
}

const USAGE_KIND: Record<AgentUsageRef['kind'], string> = { routine: 'Rotina', workflow: 'Workflow', mission: 'Missão', toolbox: 'Ferramenta' };

// Linhas do modal de aprovação da Yui: onde ele é usado e quem assume.
export function agentDeleteSummary(a: AgentDef, usage: AgentUsageRef[], replacement: AgentDef | null): ApprovalInfo['rows'] {
  return [
    { label: 'Agente', value: `${a.name} [${a.id}]` },
    ...usage.map((u) => ({ label: USAGE_KIND[u.kind], value: u.detail ? `${u.label} · ${u.detail}` : u.label })),
    { label: 'Quem assume', value: replacement ? `${replacement.name} [${replacement.id}]` : usage.length ? '—' : 'ninguém (sem uso)' },
    { label: 'Desfazer', value: 'não é possível (cópia fica no histórico de agentes)', tone: 'crit' },
  ];
}

const activeAgent = (id: string | null | undefined) => (id ? loadAllAgents().find((a) => a.id === id && !a.archived) : undefined);

// Exclusão definitiva: reatribui o uso ao substituto, guarda cópia no histórico, apaga o .md e impede o seed de recriar.
export function deleteAgent(id: string, replaceWith: string | null): { ok: true; reassigned: number } | { ok: false; error: string; usage?: AgentUsageRef[] } {
  const a = findAny(id);
  if (!a) return { ok: false, error: 'agente não encontrado' };
  const usage = agentUsage(id);
  const rep = replaceWith && replaceWith !== id ? activeAgent(replaceWith) : undefined;
  if (replaceWith && !rep) return { ok: false, error: 'substituto inválido (precisa ser outro agente ativo)', usage };
  if (usage.length && !rep) return { ok: false, error: 'o agente está em uso: escolha quem assume', usage };

  if (rep) {
    for (const r of listRoutines()) if (r.agent_id === id) updateRoutine(r.id, { agentId: rep.id });
    for (const w of listWorkflows()) {
      const uses = w.nodes.some((n) => n.agent === id) || w.team.includes(id);
      if (!uses) continue;
      const nodes = w.nodes.map((n) => (n.agent === id ? { ...n, agent: rep.id } : n));
      const team = [...new Set(w.team.map((t) => (t === id ? rep.id : t)))];
      saveWorkflow({ def: { ...w, nodes, team } }, w.slug);
    }
    for (const m of activeMissions()) {
      if (!openStepsOf(m, id).length) continue;
      const steps = (JSON.parse(m.plan_json) as MissionStep[]).map((st) => (st.agentId === id && OPEN_STEP.has(st.status) ? { ...st, agentId: rep.id, agent: rep.name } : st));
      db.prepare('UPDATE missions SET plan_json = ? WHERE id = ?').run(JSON.stringify(steps), m.id);
      const info = getMission(m.id);
      if (info) emit({ type: 'mission.updated', mission: info });
    }
    const tb = readToolbox();
    if (tb.some((t) => t.agent === id)) {
      const f = toolboxFile();
      writeFileSync(`${f}.tmp`, `${JSON.stringify(tb.map((t) => (t.agent === id ? { ...t, agent: rep.id } : t)), null, 2)}\n`);
      renameSync(`${f}.tmp`, f);
    }
  }

  const file = join(agentsDir(), `${id}.md`);
  if (existsSync(file)) {
    mkdirSync(historyDir(), { recursive: true });
    cpSync(file, join(historyDir(), `${id}-demitido-${new Date().toISOString().replace(/[:.]/g, '-')}.md`));
    unlinkSync(file);
  }
  kvSet('agents_deleted', JSON.stringify([...new Set([...deletedIds(), id])]));
  invalidateAgents();
  emit({ type: 'agents.updated', agentsWorking: agentsWorking() });
  return { ok: true, reassigned: rep ? usage.length : 0 };
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

  app.get('/api/agents/:id/usage', async (req, reply) => {
    const a = findAny((req.params as { id: string }).id);
    if (!a) return reply.code(404).send({ error: 'not found' });
    return agentUsage(a.id);
  });

  // Sem ?hard = arquivar (volta com Reativar). Com ?hard=1 = demitir: exclui de vez, reatribuindo a ?replaceWith.
  app.delete('/api/agents/:id', async (req, reply) => {
    const a = findAny((req.params as { id: string }).id);
    if (!a) return reply.code(404).send({ error: 'not found' });
    const q = (req.query ?? {}) as { hard?: string; replaceWith?: string };
    if (q.hard === '1' || q.hard === 'true') {
      const r = deleteAgent(a.id, q.replaceWith?.trim() || null);
      if (!r.ok) return reply.code(r.usage ? 409 : 404).send({ error: r.error, usage: r.usage ?? [] });
      return r;
    }
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
        name: 'demitir_agente',
        strict: true,
        description: 'Pede a exclusão definitiva de um agente, passando rotinas, passos de workflow, etapas de missão e ferramentas dele para um substituto. Só exclui depois que o usuário aprovar no modal de ação destrutiva.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['agente', 'substituto'],
          properties: {
            agente: { type: 'string', description: 'id ou nome do agente a demitir' },
            substituto: { type: ['string', 'null'], description: 'id ou nome de quem assume os lugares dele; null se ele não é usado em nada' },
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
      if (tool === 'demitir_agente') {
        const byKey = (v: unknown) => {
          const k = String(v ?? '').toLowerCase().trim();
          return k ? loadAllAgents().find((x) => x.id === k || x.name.toLowerCase() === k) : undefined;
        };
        const a = byKey(args.agente);
        if (!a) return Promise.resolve({ ok: false, error: 'agente não encontrado', disponiveis: loadAllAgents().map((x) => x.id) });
        const usage = agentUsage(a.id);
        const rep = args.substituto ? byKey(args.substituto) : undefined;
        if (args.substituto && (!rep || rep.archived || rep.id === a.id)) return Promise.resolve({ ok: false, error: 'substituto inválido: precisa ser outro agente ativo' });
        if (usage.length && !rep) {
          return Promise.resolve({ ok: false, error: 'o agente está em uso: pergunte ao usuário quem assume', uso: usage.map((u) => `${USAGE_KIND[u.kind]} ${u.label}${u.detail ? ` (${u.detail})` : ''}`) });
        }
        if (ctx.dryRun) return Promise.resolve({ ok: true, status: 'aguardando_aprovacao' });
        // Não espera o clique: o turno da Yui termina já e a exclusão acontece só se o usuário aprovar.
        void askApproval(`delete:agent:${a.id}`, `Demitir o agente "${a.name}" definitivamente?`, agentDeleteSummary(a, usage, rep ?? null), undefined, { kind: 'destructive' }).then((ok) => {
          if (!ok) return narrate(`Ok, mantive o agente ${a.name}.`, { speak: true });
          const r = deleteAgent(a.id, rep?.id ?? null);
          narrate(r.ok ? `Agente ${a.name} demitido${rep ? `; ${rep.name} assumiu os lugares dele` : ''}.` : `Não consegui demitir ${a.name}: ${r.error}.`, { speak: true });
        });
        return Promise.resolve({ ok: true, status: 'aguardando_aprovacao', nome: a.name, substituto: rep?.name ?? null, aviso: 'Nada foi excluído ainda: só exclui se o usuário aprovar no modal.' });
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
      '- "Abre o agente X", "mostra a configuração do Designer" => open_agent. Se nenhum agente servir a um pedido recorrente, crie um com create_agent e delegue a ele. "Demite/exclui/apaga o agente X" => demitir_agente: é irreversível, use só quando o usuário pedir claramente para excluir aquele agente (nunca por iniciativa própria; para só pausar, ele pode Arquivar no painel). Se o agente estiver em uso, pergunte quem assume antes de chamar. Abre um modal de aprovação; diga que aguarda a aprovação dele e nunca diga que já demitiu.',
  });
}
