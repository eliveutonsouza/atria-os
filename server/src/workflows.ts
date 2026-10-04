import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import cron from 'node-cron';
import type OpenAI from 'openai';
import type { ApprovalInfo, StepStatus, WorkflowDef, WorkflowNode, WorkflowRunInfo } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, now, uid } from './db.ts';
import { emit, setYuiState } from './bus.ts';
import { findAgent, loadAgents } from './agents.ts';
import { cancelRun, enqueueRun, inboxItems, runBus } from './runs.ts';
import { registerBrain } from './extensions.ts';
import { openai } from './brain.ts';
import { narrate } from './live.ts';
import { createRoutine, deleteRoutine, registerRoutineRoutes, routinesForWorkflow, setWorkflowRunner } from './routines.ts';
import { parseWorkflowMarkdown, serializeWorkflow, slugify, toMermaid, validateWorkflow } from './workflowMarkdown.ts';

// Workflows de decisão: definidos em markdown canônico (/workspace/.yui/workflows/<slug>.md),
// editados como fluxograma no console e executados passo a passo por agentes (manual ou rotina cron).

db.exec(`
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow TEXT NOT NULL,
  status TEXT NOT NULL,
  current TEXT,
  nodes TEXT NOT NULL DEFAULT '{}',
  routine_id TEXT,
  origin TEXT NOT NULL DEFAULT 'manual',
  input TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS workflow_runs_wf ON workflow_runs(workflow, started_at);
`);

const wfDir = () => join(config.workspaceDir, '.yui', 'workflows');

// ---------- arquivos ----------

function seedWorkflows() {
  const src = join(config.seedDir, '.yui', 'workflows');
  if (!existsSync(src)) return;
  mkdirSync(wfDir(), { recursive: true });
  const row = db.prepare(`SELECT value FROM kv WHERE key = 'workflows_seeded'`).get() as { value: string } | undefined;
  const seeded = new Set<string>(JSON.parse(row?.value ?? '[]'));
  for (const f of readdirSync(src).filter((f) => f.endsWith('.md'))) {
    // Semeia uma vez: se o usuário apagar um seed, ele não volta.
    if (seeded.has(f)) continue;
    if (!existsSync(join(wfDir(), f))) copyFileSync(join(src, f), join(wfDir(), f));
    seeded.add(f);
  }
  db.prepare(`INSERT INTO kv(key, value) VALUES('workflows_seeded', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify([...seeded]));
}

// Arquivos de antes do Mermaid ganham o diagrama uma vez (com backup <slug>.md.bak).
function migrateToMermaid() {
  if (!existsSync(wfDir())) return;
  for (const f of readdirSync(wfDir()).filter((x) => x.endsWith('.md'))) {
    const file = join(wfDir(), f);
    const md = readFileSync(file, 'utf8');
    if (/```mermaid/i.test(md)) continue;
    try {
      const def = parseWorkflowMarkdown(md, f.replace(/\.md$/, ''));
      if (!existsSync(`${file}.bak`)) copyFileSync(file, `${file}.bak`);
      writeFileSync(`${file}.tmp`, serializeWorkflow(def));
      renameSync(`${file}.tmp`, file);
      console.log(`workflow ${f}: fluxo convertido para Mermaid`);
    } catch (e) {
      console.error(`workflow ${f}: não converti para Mermaid:`, (e as Error).message);
    }
  }
}

// Diagrama da execução: passos feitos/pulados/falhos marcados e o atual destacado.
function runDiagram(ex: Exec, current: string): string {
  const status: Record<string, 'done' | 'skipped' | 'failed'> = {};
  for (const [id, st] of Object.entries(ex.nodes)) {
    if (st.status === 'done') status[id] = 'done';
    else if (st.status === 'skipped') status[id] = 'skipped';
    else if (st.status === 'failed' || st.status === 'cancelled') status[id] = 'failed';
  }
  return toMermaid(ex.def, { current, status, compact: true });
}

export function loadWorkflow(slug: string): WorkflowDef | null {
  const s = slugify(slug);
  const f = join(wfDir(), `${s}.md`);
  if (!existsSync(f)) return null;
  const markdown = readFileSync(f, 'utf8');
  const def = parseWorkflowMarkdown(markdown, s);
  return { ...def, slug: s, markdown, updatedAt: statSync(f).mtime.toISOString() };
}

export function listWorkflows(): WorkflowDef[] {
  if (!existsSync(wfDir())) return [];
  return readdirSync(wfDir())
    .filter((f) => f.endsWith('.md'))
    .map((f) => loadWorkflow(f.replace(/\.md$/, '')))
    .filter((w): w is WorkflowDef => !!w)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Salva a partir de markdown (fonte da verdade) ou de def (editor visual). Devolve o def salvo.
export function saveWorkflow(input: { markdown?: string; def?: Partial<WorkflowDef> }, slugHint?: string): WorkflowDef {
  let def: Omit<WorkflowDef, 'markdown' | 'updatedAt'>;
  if (typeof input.markdown === 'string') def = parseWorkflowMarkdown(input.markdown, slugHint);
  else if (input.def) {
    const d = input.def;
    def = {
      slug: slugify(d.slug || slugHint || d.name || 'workflow'),
      name: d.name || 'Workflow',
      description: d.description ?? '',
      trigger: d.trigger ?? { type: 'manual' },
      project: d.project ?? null,
      team: d.team ?? [],
      nodes: d.nodes ?? [],
    };
  } else throw new Error('envie markdown ou def');
  if (slugHint) def.slug = slugify(slugHint);
  if (def.trigger.type === 'cron' && (!def.trigger.cron || !cron.validate(def.trigger.cron))) throw new Error(`cron inválido: ${def.trigger.cron}`);
  const markdown = serializeWorkflow(def);
  mkdirSync(wfDir(), { recursive: true });
  const f = join(wfDir(), `${def.slug}.md`);
  writeFileSync(`${f}.tmp`, markdown);
  renameSync(`${f}.tmp`, f);
  syncTriggerRoutine(def);
  return loadWorkflow(def.slug)!;
}

// Gatilho cron no frontmatter ⇄ uma rotina "Workflow · <nome>" vinculada.
function syncTriggerRoutine(def: Pick<WorkflowDef, 'slug' | 'name' | 'trigger'>) {
  const linked = routinesForWorkflow(def.slug).filter((r) => r.name.startsWith('Workflow · '));
  if (def.trigger.type === 'cron' && def.trigger.cron) {
    if (linked[0] && linked[0].cron === def.trigger.cron) return;
    for (const r of linked) deleteRoutine(r.id);
    createRoutine({ name: `Workflow · ${def.name}`, cron: def.trigger.cron, workflowId: def.slug });
  } else for (const r of linked) deleteRoutine(r.id);
}

export function deleteWorkflow(slug: string): boolean {
  const s = slugify(slug);
  const f = join(wfDir(), `${s}.md`);
  if (!existsSync(f)) return false;
  for (const r of routinesForWorkflow(s)) deleteRoutine(r.id);
  unlinkSync(f);
  return true;
}

// ---------- execução ----------

type NodeState = WorkflowRunInfo['nodes'][string];
interface RunRow {
  id: string; workflow: string; status: WorkflowRunInfo['status']; current: string | null; nodes: string; started_at: string; finished_at: string | null;
}

const toInfo = (r: RunRow): WorkflowRunInfo => ({
  id: r.id, workflow: r.workflow, status: r.status, current: r.current, nodes: JSON.parse(r.nodes), startedAt: r.started_at, finishedAt: r.finished_at,
});

export function getWorkflowRun(id: string): WorkflowRunInfo | null {
  const r = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as RunRow | undefined;
  return r ? toInfo(r) : null;
}

export function listWorkflowRuns(slug: string, limit = 20): WorkflowRunInfo[] {
  return (db.prepare('SELECT * FROM workflow_runs WHERE workflow = ? ORDER BY started_at DESC LIMIT ?').all(slugify(slug), limit) as RunRow[]).map(toInfo);
}

interface Exec {
  id: string;
  def: WorkflowDef;
  nodes: Record<string, NodeState>;
  outputs: { node: WorkflowNode; result: string }[];
  input: string | null;
  cancelled: boolean;
  activeRuns: Set<string>;
  visits: Map<string, number>;
  steps: number;
}
const executions = new Map<string, Exec>();

function persist(ex: Exec, fields: { status?: WorkflowRunInfo['status']; current?: string | null; finished?: boolean } = {}) {
  const sets = ['nodes = @nodes'];
  const p: Record<string, unknown> = { id: ex.id, nodes: JSON.stringify(ex.nodes) };
  if (fields.status) {
    sets.push('status = @status');
    p.status = fields.status;
  }
  if (fields.current !== undefined) {
    sets.push('current = @current');
    p.current = fields.current;
  }
  if (fields.finished) {
    sets.push('finished_at = @finished_at');
    p.finished_at = now();
  }
  db.prepare(`UPDATE workflow_runs SET ${sets.join(', ')} WHERE id = @id`).run(p);
  const info = getWorkflowRun(ex.id);
  if (info) emit({ type: 'workflow.run.updated', run: info });
}

function setNode(ex: Exec, id: string, st: Partial<NodeState>) {
  ex.nodes[id] = { ...(ex.nodes[id] ?? { status: 'pending' as StepStatus }), ...st };
}

// Fala com voz ligada (GPT-Live) ou mostra na tela — mesmo caminho da narração dos agentes.
function announce(text: string) {
  narrate(text, { speak: true });
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const byId = (ex: Exec, id: string) => ex.def.nodes.find((n) => n.id === id);

export async function runWorkflow(slug: string, opts: { routineId?: string; origin?: 'manual' | 'routine' | 'yui'; input?: string } = {}): Promise<WorkflowRunInfo> {
  const def = loadWorkflow(slug);
  if (!def) throw new Error(`workflow não encontrado: ${slug}`);
  const errs = validateWorkflow(def);
  const unknownAgents = def.nodes
    .filter((n) => n.type === 'task' && n.agent && !findAgent(n.agent))
    .map((n) => `passo ${n.id}: agente "${n.agent}" não existe`);
  if (errs.length || unknownAgents.length) throw new Error(`workflow inválido: ${[...errs, ...unknownAgents].join('; ')}`);
  const id = uid();
  const nodes: Record<string, NodeState> = Object.fromEntries(def.nodes.map((n) => [n.id, { status: 'pending' as StepStatus }]));
  db.prepare(`INSERT INTO workflow_runs(id, workflow, status, current, nodes, routine_id, origin, input, started_at) VALUES(?, ?, 'running', NULL, ?, ?, ?, ?, ?)`)
    .run(id, def.slug, JSON.stringify(nodes), opts.routineId ?? null, opts.origin ?? 'manual', opts.input ?? null, now());
  const ex: Exec = { id, def, nodes, outputs: [], input: opts.input ?? null, cancelled: false, activeRuns: new Set(), visits: new Map(), steps: 0 };
  executions.set(id, ex);
  persist(ex);
  setYuiState('delegating');
  void (async () => {
    try {
      const first = def.nodes.find((n) => n.type === 'start') ?? def.nodes[0];
      await walk(ex, first.id, null);
      if (ex.cancelled) return finish(ex, 'cancelled', `Workflow "${def.name}" cancelado.`);
      const last = ex.outputs.filter((o) => o.node.type === 'task').at(-1);
      finish(ex, 'done', `Workflow "${def.name}" concluído.${last ? ` ${clip(last.result.replace(/\s+/g, ' '), 220)}` : ''}`);
    } catch (e) {
      finish(ex, ex.cancelled ? 'cancelled' : 'failed', ex.cancelled ? `Workflow "${def.name}" interrompido: ${(e as Error).message}.` : `Workflow "${def.name}" parou: ${(e as Error).message}.`);
    }
  })();
  return getWorkflowRun(id)!;
}

function finish(ex: Exec, status: WorkflowRunInfo['status'], msg: string) {
  for (const [k, n] of Object.entries(ex.nodes)) if (n.status === 'pending') ex.nodes[k] = { ...n, status: 'skipped' };
  persist(ex, { status, current: null, finished: true });
  executions.delete(ex.id);
  announce(msg);
  setYuiState(status === 'done' ? 'success' : 'warning');
  setTimeout(() => setYuiState('idle'), 2500).unref();
}

function reachable(ex: Exec, from: string): string[] {
  const seen: string[] = [];
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.includes(id)) continue;
    seen.push(id);
    const n = byId(ex, id);
    queue.push(...(n?.next ?? []), ...(n?.branches ?? []).map((b) => b.to));
  }
  return seen;
}

// Percorre a partir de `id` até o fim (ou até `stopAt`, o ponto de junção de um paralelo).
async function walk(ex: Exec, start: string | undefined, stopAt: string | null): Promise<void> {
  let id = start;
  while (id && id !== stopAt) {
    if (ex.cancelled) return;
    const node = byId(ex, id);
    if (!node) throw new Error(`passo ${id} não existe`);
    const v = (ex.visits.get(id) ?? 0) + 1;
    ex.visits.set(id, v);
    if (v > 3 || ++ex.steps > 60) throw new Error(`laço detectado no passo ${id} (${node.title})`);
    persist(ex, { current: id });

    if (node.type === 'end') {
      setNode(ex, id, { status: 'done' });
      persist(ex);
      return;
    }
    if (node.type === 'decision') {
      id = await decide(ex, node);
      continue;
    }
    if (node.type === 'task') await task(ex, node);
    else if (node.type === 'approval') await approval(ex, node);
    else setNode(ex, id, { status: 'done' }); // start / parallel
    persist(ex);
    if ((node.next?.length ?? 0) > 1) {
      await parallel(ex, node.next!);
      return;
    }
    id = node.next?.[0];
  }
}

async function parallel(ex: Exec, branches: string[]) {
  // Junção = primeiro passo (em largura) alcançável por todos os ramos.
  const sets = branches.map((b) => new Set(reachable(ex, b)));
  const join = reachable(ex, branches[0]).find((n) => !branches.includes(n) && sets.every((s) => s.has(n))) ?? null;
  await Promise.all(branches.map((b) => walk(ex, b, join)));
  if (join && !ex.cancelled) await walk(ex, join, null);
}

function contextFor(ex: Exec): string {
  const parts: string[] = [];
  if (ex.input) parts.push(`Entrada desta execução: ${ex.input}`);
  for (const o of ex.outputs.slice(-6)) {
    parts.push(`### Passo ${o.node.id} — ${o.node.title}${o.node.output ? ` (saída "${o.node.output}")` : ''}\n${clip(o.result, 8000)}`);
  }
  return parts.join('\n\n');
}

function waitRun(runId: string): Promise<{ state: string; result: string }> {
  return new Promise((resolve) => {
    const on = (info: { id: string; state: string; result: string | null }) => {
      if (info.id !== runId) return;
      runBus.off('finished', on);
      resolve({ state: info.state, result: info.result ?? '' });
    };
    runBus.on('finished', on);
  });
}

async function task(ex: Exec, node: WorkflowNode) {
  const agent = findAgent(node.agent ?? '');
  if (!agent) throw new Error(`agente "${node.agent}" não existe`);
  const hints = [
    node.mcp?.length ? `Ferramentas/conectores preferidos: ${node.mcp.join(', ')}.` : '',
    node.skills?.length ? `Skills recomendadas: ${node.skills.join(', ')}.` : '',
  ].filter(Boolean);
  const ctx = contextFor(ex);
  const instruction = [
    `Você está executando o passo ${node.id} ("${node.title}") do workflow "${ex.def.name}".`,
    'Fluxo completo (Mermaid; seu passo está na classe "atual", os concluídos em "feito"):',
    '```mermaid',
    runDiagram(ex, node.id),
    '```',
    '',
    node.instruction ?? '',
    ...hints,
    ctx ? `\nResultados dos passos anteriores:\n${ctx}` : '',
    '\nResponda com o resultado concreto deste passo (ele alimenta os próximos passos).',
  ].join('\n');
  const run = enqueueRun({ agentId: agent.id, project: ex.def.project, instruction, task: `${ex.def.name} · ${node.title}`, origin: 'workflow', workflowRunId: ex.id });
  ex.activeRuns.add(run.id);
  setNode(ex, node.id, { status: 'running', runId: run.id });
  persist(ex);
  const done = await waitRun(run.id);
  ex.activeRuns.delete(run.id);
  if (done.state !== 'done') {
    setNode(ex, node.id, { status: ex.cancelled || done.state === 'cancelled' ? 'cancelled' : 'failed', result: done.result });
    persist(ex);
    throw new Error(`passo ${node.id} (${node.title}) ${done.state === 'cancelled' ? 'cancelado' : 'falhou'}`);
  }
  setNode(ex, node.id, { status: 'done', result: done.result });
  ex.outputs.push({ node, result: done.result });
}

async function decide(ex: Exec, node: WorkflowNode): Promise<string> {
  const branches = node.branches ?? [];
  setNode(ex, node.id, { status: 'running' });
  persist(ex);
  let choice = branches[0];
  let motivo = 'sem avaliação';
  try {
    const res = await openai.responses.create({
      model: process.env.YUI_BRAIN_MODEL || 'gpt-6-luna',
      instructions:
        'Você avalia um ponto de decisão de um workflow. Escolha o ramo que responde à condição com base nos resultados dos passos. Seja criterioso; motivo curto em português.',
      input: `Workflow: ${ex.def.name}\nCondição: ${node.condition ?? node.title}\nRamos: ${branches.map((b) => b.label).join(' | ')}\n\nResultados até aqui:\n${contextFor(ex) || '(nenhum)'}`,
      text: {
        format: {
          type: 'json_schema',
          name: 'decisao',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['ramo', 'motivo'],
            properties: { ramo: { type: 'string', enum: branches.map((b) => b.label) }, motivo: { type: 'string' } },
          },
        },
      },
    });
    const out = JSON.parse(res.output_text) as { ramo: string; motivo: string };
    choice = branches.find((b) => b.label === out.ramo) ?? choice;
    motivo = out.motivo;
  } catch (e) {
    console.error('workflow decisão', (e as Error).message);
    motivo = `avaliação falhou (${(e as Error).message}); seguindo o primeiro ramo`;
  }
  setNode(ex, node.id, { status: 'done', decision: choice.label, result: motivo });
  ex.outputs.push({ node, result: `Decisão: ${choice.label} — ${motivo}` });
  persist(ex);
  return choice.to;
}

// Aprovação humana: usa a tabela/fluxo de aprovações do console (modal + inbox + narração da Yui).
// O run_id da aprovação é o id da execução do workflow; a resolução chega por POST /api/approvals/:id
// (runs.resolveApproval grava o status) e aqui é observada por polling da tabela.
async function approval(ex: Exec, node: WorkflowNode) {
  const id = uid();
  const lastTask = ex.outputs.filter((o) => o.node.type === 'task').at(-1);
  const rows: ApprovalInfo['rows'] = [
    { label: 'Workflow', value: ex.def.name },
    { label: 'Passo', value: `${node.id}. ${node.title}` },
    ...(lastTask ? [{ label: 'Último resultado', value: clip(lastTask.result.replace(/\s+/g, ' '), 90) }] : []),
  ];
  const title = `${ex.def.name}: ${node.instruction ?? `"${node.title}" precisa da sua aprovação.`}`;
  db.prepare(`INSERT INTO approvals(id, run_id, title, rows, created_at) VALUES(?, ?, ?, ?, ?)`).run(id, ex.id, title, JSON.stringify(rows), now());
  const info: ApprovalInfo = { id, runId: ex.id, title, rows, createdAt: now() };
  setNode(ex, node.id, { status: 'waiting_approval' });
  persist(ex, { status: 'waiting_approval' });
  emit({ type: 'approval.requested', approval: info });
  emit({ type: 'inbox.updated', inbox: inboxItems() });
  runBus.emit('approval', info);
  const status = await new Promise<string>((resolve) => {
    const t = setInterval(() => {
      if (ex.cancelled) {
        db.prepare(`UPDATE approvals SET status = 'expired', resolved_at = ? WHERE id = ? AND status = 'pending'`).run(now(), id);
        emit({ type: 'inbox.updated', inbox: inboxItems() });
        clearInterval(t);
        return resolve('cancelled');
      }
      const r = db.prepare('SELECT status FROM approvals WHERE id = ?').get(id) as { status: string } | undefined;
      if (r && r.status !== 'pending') {
        clearInterval(t);
        resolve(r.status);
      }
    }, 1500);
  });
  if (status !== 'approved') {
    setNode(ex, node.id, { status: 'cancelled', result: status === 'rejected' ? 'rejeitado' : status });
    ex.cancelled = true;
    persist(ex);
    throw new Error(status === 'rejected' ? `aprovação rejeitada no passo ${node.id}` : `aprovação ${status}`);
  }
  setNode(ex, node.id, { status: 'done', result: 'aprovado' });
  persist(ex, { status: 'running' });
}

export function cancelWorkflowRun(id: string): boolean {
  const ex = executions.get(id);
  if (!ex) return false;
  ex.cancelled = true;
  for (const r of ex.activeRuns) cancelRun(r);
  return true;
}

function recoverWorkflowRuns() {
  db.prepare(`UPDATE workflow_runs SET status = 'failed', finished_at = ? WHERE status IN ('running','waiting_approval')`).run(now());
}

// ---------- geração por linguagem natural (Yui cria workflows) ----------

const NODE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'title', 'agent', 'instruction', 'output', 'condition', 'branches', 'next', 'mcp'],
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['start', 'task', 'decision', 'approval', 'parallel', 'end'] },
    title: { type: 'string' },
    agent: { type: ['string', 'null'] },
    instruction: { type: ['string', 'null'] },
    output: { type: ['string', 'null'] },
    condition: { type: ['string', 'null'] },
    branches: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['label', 'to'], properties: { label: { type: 'string' }, to: { type: 'string' } } },
    },
    next: { type: 'array', items: { type: 'string' } },
    mcp: { type: 'array', items: { type: 'string' } },
  },
};

export async function generateWorkflow(input: { descricao: string; nome?: string | null; cron?: string | null; projeto?: string | null }): Promise<WorkflowDef> {
  const agents = loadAgents()
    .map((a) => `- ${a.id}: ${a.name} — ${a.description}`)
    .join('\n');
  const res = await openai.responses.create({
    model: process.env.YUI_PLANNER_MODEL || process.env.YUI_BRAIN_MODEL || 'gpt-6-luna',
    instructions: `Você desenha workflows de trabalho para agentes Claude Code do Yui Console. Gere passos numerados ("1", "2"…) na ordem de execução.
Tipos: task (um agente executa; instrução completa e autossuficiente em português, citando ferramentas/conectores quando útil), decision (condição objetiva + 2 ramos, normalmente "sim"/"não", com "to" = id do passo), approval (revisão humana antes de ação externa irreversível: publicar, enviar, deploy, pagar), parallel (next com 2+ passos em paralelo), end (último passo).
Use SOMENTE estes agentes (campo agent = id):
${agents}
Em tasks preencha agent, instruction e output (nome curto da saída). Fora de tasks use null nesses campos. next = próximo(s) id(s) (vazio em decision/end). Termine sempre com um passo end. Inclua approval antes de qualquer ação externa irreversível. Uma aprovação rejeitada já interrompe o workflow: NÃO crie decisão para checar se foi aprovado. Não crie passo start só para descrever agenda/recorrência (o agendamento é configurado à parte).`,
    input: `Pedido do usuário: ${input.descricao}${input.nome ? `\nNome desejado: ${input.nome}` : ''}${input.projeto ? `\nProjeto: ${input.projeto}` : ''}`,
    text: {
      format: {
        type: 'json_schema',
        name: 'workflow',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'description', 'nodes'],
          properties: { name: { type: 'string' }, description: { type: 'string' }, nodes: { type: 'array', items: NODE_SCHEMA } },
        },
      },
    },
  });
  type GenNode = { id: string; type: WorkflowNode['type']; title: string; agent: string | null; instruction: string | null; output: string | null; condition: string | null; branches: { label: string; to: string }[]; next: string[]; mcp: string[] };
  const raw = JSON.parse(res.output_text) as { name: string; description: string; nodes: GenNode[] };
  const nodes: WorkflowNode[] = raw.nodes.map((n) => {
    const out: WorkflowNode = { id: n.id, type: n.type, title: n.title };
    if (n.agent) out.agent = findAgent(n.agent)?.id ?? n.agent;
    if (n.instruction) out.instruction = n.instruction;
    if (n.output) out.output = n.output;
    if (n.condition) out.condition = n.condition;
    if (n.branches?.length) out.branches = n.branches;
    if (n.next?.length && n.type !== 'decision' && n.type !== 'end') out.next = n.next;
    if (n.mcp?.length) out.mcp = n.mcp;
    return out;
  });
  const name = input.nome || raw.name;
  return saveWorkflow({
    def: {
      slug: slugify(name),
      name,
      description: raw.description,
      trigger: input.cron ? { type: 'cron', cron: input.cron } : { type: 'manual' },
      project: input.projeto ?? null,
      team: [],
      nodes,
    },
  });
}

// ---------- registro: rotas + cérebro ----------

const findWf = (s: unknown) => {
  const k = slugify(String(s ?? ''));
  const all = listWorkflows();
  return all.find((w) => w.slug === k || slugify(w.name) === k) ?? all.find((w) => w.slug.includes(k) || k.includes(w.slug));
};

export function register(app: FastifyInstance): void {
  seedWorkflows();
  migrateToMermaid();
  recoverWorkflowRuns();
  // gatilho cron do frontmatter (inclusive seeds e arquivos colados direto na pasta) → rotina vinculada
  for (const w of listWorkflows()) {
    try {
      syncTriggerRoutine(w);
    } catch (e) {
      console.error(`workflow ${w.slug}: gatilho ignorado:`, (e as Error).message);
    }
  }
  setWorkflowRunner((slug, opts) => runWorkflow(slug, opts));
  registerRoutineRoutes(app);

  app.get('/api/workflows', () =>
    listWorkflows().map((w) => ({
      ...w,
      lastRun: listWorkflowRuns(w.slug, 1)[0] ?? null,
      routines: routinesForWorkflow(w.slug).map((r) => ({ id: r.id, name: r.name, cron: r.cron, enabled: !!r.enabled })),
    })),
  );
  app.post('/api/workflows/parse', async (req, reply) => {
    const md = (req.body as { markdown?: unknown } | undefined)?.markdown;
    if (typeof md !== 'string') return reply.code(400).send({ error: 'markdown' });
    const def = parseWorkflowMarkdown(md);
    return { ...def, markdown: serializeWorkflow(def), errors: validateWorkflow(def) };
  });
  app.post('/api/workflows/generate', async (req, reply) => {
    const b = (req.body ?? {}) as { descricao?: string; nome?: string; cron?: string; projeto?: string };
    if (!b.descricao) return reply.code(400).send({ error: 'descricao' });
    try {
      return await generateWorkflow({ descricao: b.descricao, nome: b.nome, cron: b.cron, projeto: b.projeto });
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
  app.get('/api/workflows/:slug', async (req, reply) => loadWorkflow((req.params as { slug: string }).slug) ?? reply.code(404).send({ error: 'not found' }));
  app.put('/api/workflows/:slug', async (req, reply) => {
    try {
      const w = saveWorkflow(req.body as { markdown?: string; def?: Partial<WorkflowDef> }, (req.params as { slug: string }).slug);
      return { ...w, errors: validateWorkflow(w) };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
  app.delete('/api/workflows/:slug', async (req, reply) => reply.code(deleteWorkflow((req.params as { slug: string }).slug) ? 204 : 404).send());
  app.post('/api/workflows/:slug/run', async (req, reply) => {
    try {
      const input = (req.body as { input?: string } | undefined)?.input;
      return await runWorkflow((req.params as { slug: string }).slug, { origin: 'manual', input });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
  app.post('/api/workflows/:slug/schedule', async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    const c = (req.body as { cron?: string | null } | undefined)?.cron;
    const w = loadWorkflow(slug);
    if (!w) return reply.code(404).send({ error: 'not found' });
    try {
      return saveWorkflow({ def: { ...w, trigger: c ? { type: 'cron', cron: c } : { type: 'manual' } } }, slug);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
  app.get('/api/workflows/:slug/runs', (req) => listWorkflowRuns((req.params as { slug: string }).slug));
  app.get('/api/workflow-runs/:id', async (req, reply) => getWorkflowRun((req.params as { id: string }).id) ?? reply.code(404).send({ error: 'not found' }));
  app.post('/api/workflow-runs/:id/cancel', async (req, reply) => reply.code(cancelWorkflowRun((req.params as { id: string }).id) ? 204 : 404).send());

  registerBrain({
    name: 'workflows',
    instructions:
      '- Workflows = rotinas de trabalho repetíveis com vários passos, decisões, aprovações e agentes (ex.: "post pro Instagram", "leads diários"). Quando o usuário quiser criar um processo/rotina de trabalho, use create_workflow com uma descrição detalhada (objetivo, passos, agentes, decisões, aprovações) — ele abre no editor para o usuário ajustar. "Roda o workflow X" → run_workflow. "Agenda / todo dia / toda segunda" para um workflow → schedule_workflow com cron de 5 campos (fuso America/Sao_Paulo). Lista de workflows: show_view workflows; rotinas agendadas: show_view routines. create_routine fica só para uma instrução simples de um agente.',
    snapshot: () => {
      const ws = listWorkflows();
      return ws.length
        ? `Workflows: ${ws.map((w) => `${w.name} [${w.slug}] (${w.trigger.type === 'cron' ? `cron ${w.trigger.cron}` : 'manual'})`).join('; ')}.`
        : 'Workflows: nenhum ainda.';
    },
    tools: [
      {
        type: 'function',
        name: 'create_workflow',
        strict: true,
        description: 'Cria um workflow (fluxograma de passos com agentes, decisões e aprovações) a partir de uma descrição e abre no editor.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['descricao', 'nome', 'cron', 'projeto'],
          properties: {
            descricao: { type: 'string', description: 'objetivo e passos desejados, em detalhe' },
            nome: { type: ['string', 'null'] },
            cron: { type: ['string', 'null'], description: 'cron de 5 campos se o usuário pediu recorrência' },
            projeto: { type: ['string', 'null'], description: 'slug do projeto, se houver' },
          },
        },
      },
      {
        type: 'function',
        name: 'run_workflow',
        strict: true,
        description: 'Executa um workflow agora e mostra a execução.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['slug', 'entrada'],
          properties: { slug: { type: 'string' }, entrada: { type: ['string', 'null'], description: 'contexto extra para esta execução' } },
        },
      },
      {
        type: 'function',
        name: 'schedule_workflow',
        strict: true,
        description: 'Agenda um workflow num cron (ou desagenda com cron null).',
        parameters: { type: 'object', additionalProperties: false, required: ['slug', 'cron'], properties: { slug: { type: 'string' }, cron: { type: ['string', 'null'] } } },
      },
      {
        type: 'function',
        name: 'get_workflow',
        strict: true,
        description: 'Mostra como um workflow está desenhado: fluxo em Mermaid e detalhes de cada passo (agente, instrução, condição).',
        parameters: { type: 'object', additionalProperties: false, required: ['slug'], properties: { slug: { type: 'string' } } },
      },
      {
        type: 'function',
        name: 'list_workflows',
        strict: true,
        description: 'Lista os workflows com gatilho e última execução.',
        parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
      },
    ] satisfies OpenAI.Responses.FunctionTool[],
    run(tool, args) {
      switch (tool) {
        case 'create_workflow':
          return (async () => {
            const w = await generateWorkflow({
              descricao: String(args.descricao),
              nome: (args.nome as string | null) ?? null,
              cron: (args.cron as string | null) ?? null,
              projeto: (args.projeto as string | null) ?? null,
            });
            emit({ type: 'ui.action', action: { type: 'show_view', view: 'workflow', params: { workflowId: w.slug } } });
            setYuiState('showing');
            return { ok: true, slug: w.slug, nome: w.name, fluxo: toMermaid(w, { compact: true }), passos: w.nodes.map((n) => `${n.id}. ${n.title}${n.agent ? ` (${n.agent})` : ''}`), gatilho: w.trigger, erros: validateWorkflow(w) };
          })();
        case 'run_workflow':
          return (async () => {
            const w = findWf(args.slug);
            if (!w) return { ok: false, error: 'workflow não encontrado', disponiveis: listWorkflows().map((x) => x.slug) };
            const r = await runWorkflow(w.slug, { origin: 'yui', input: (args.entrada as string | null) ?? undefined });
            emit({ type: 'ui.action', action: { type: 'show_view', view: 'workflow', params: { workflowId: w.slug, workflowRunId: r.id } } });
            return { ok: true, execucao: r.id, nome: w.name };
          })();
        case 'schedule_workflow':
          return (async () => {
            const w = findWf(args.slug);
            if (!w) return { ok: false, error: 'workflow não encontrado' };
            const c = (args.cron as string | null) ?? null;
            const saved = saveWorkflow({ def: { ...w, trigger: c ? { type: 'cron', cron: c } : { type: 'manual' } } }, w.slug);
            return { ok: true, nome: saved.name, gatilho: saved.trigger };
          })();
        case 'get_workflow': {
          const w = findWf(args.slug);
          if (!w) return Promise.resolve({ ok: false, error: 'workflow não encontrado', disponiveis: listWorkflows().map((x) => x.slug) });
          return Promise.resolve({
            ok: true, slug: w.slug, nome: w.name, gatilho: w.trigger, fluxo: toMermaid(w, { compact: true }),
            passos: w.nodes.map((n) => ({ id: n.id, tipo: n.type, titulo: n.title, agente: n.agent ?? null, instrucao: n.instruction ?? null, condicao: n.condition ?? null })),
            erros: validateWorkflow(w),
          });
        }
        case 'list_workflows':
          return Promise.resolve(
            listWorkflows().map((w) => ({ slug: w.slug, nome: w.name, gatilho: w.trigger, passos: w.nodes.length, ultima: listWorkflowRuns(w.slug, 1)[0]?.status ?? null })),
          );
        default:
          return undefined;
      }
    },
  });
}
