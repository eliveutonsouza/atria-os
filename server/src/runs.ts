import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { query, type CanUseTool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ApprovalInfo, ApprovalRule, InboxItem, RunInfo, RunEventLine, RunState, RunStep } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, kvGet, kvSet, now, uid } from './db.ts';
import { emit } from './bus.ts';
import { findAgent, agentsWorking, type AgentDef } from './agents.ts';
import { ensureProject, findProject } from './projects.ts';
import { agentOptions, runPromptExtras } from './extensions.ts';
import { designInboxItems } from './claudeDesign.ts';
import { getSetting } from './settings.ts';
import { blockedReason } from './safety.ts';
import { saveRateLimit } from './claudeUsage.ts';
import { addRule, matchRule, ruleKey } from './approvalRules.ts';

// Eventos para a camada de conversa (live.ts / brain.ts) narrar o trabalho.
export const runBus = new EventEmitter<{
  progress: [RunInfo];
  finished: [RunInfo];
  stalled: [RunInfo];
  rated: [RunInfo];
  approval: [ApprovalInfo];
}>();

type RunRow = {
  id: string; mission_id: string | null; step_id: string | null; workflow_run_id: string | null; routine_id: string | null; origin: string; display: 'blocks' | 'html' | null; agent_id: string; project: string | null; instruction: string; task: string; state: RunState;
  progress: number; current_op: string | null; tools: string; steps: string; result: string | null;
  session_id: string | null; tokens_in: number; tokens_out: number; cost_usd: number; rating?: number | null;
  compare_of?: string | null; model_override?: string | null; model_used?: string | null; worktree?: string | null; context_tokens?: number | null; context_window?: number | null; num_turns?: number | null;
  created_at: string; started_at: string | null; finished_at: string | null;
};

export function toRunInfo(r: RunRow): RunInfo {
  const agent = findAgent(r.agent_id);
  return {
    id: r.id,
    agent: agent?.name ?? r.agent_id,
    agentId: r.agent_id,
    project: r.project,
    task: r.task,
    state: r.state,
    progress: Math.round(r.progress),
    currentOp: r.current_op,
    tools: JSON.parse(r.tools),
    steps: JSON.parse(r.steps),
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    result: r.result,
    sessionId: r.session_id,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    costUsd: r.cost_usd,
    missionId: r.mission_id,
    workflowRunId: r.workflow_run_id,
    display: r.display,
    rating: r.rating === 1 || r.rating === -1 ? r.rating : null,
    compareOf: r.compare_of ?? null,
    model: r.model_used ?? r.model_override ?? null,
  };
}

/** Nota do usuário para uma execução (0 = limpar). 👎 também alimenta a revisão de lições (runBus 'rated'). */
export function rateRun(id: string, rating: 1 | -1 | 0): RunInfo | null {
  const r = db.prepare(`UPDATE runs SET rating = ? WHERE id = ?`).run(rating || null, id);
  if (!r.changes) return null;
  const info = getRun(id)!;
  emit({ type: 'run.updated', run: info });
  runBus.emit('rated', info);
  return info;
}

export function getRun(id: string): RunInfo | null {
  const r = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
  return r ? toRunInfo(r) : null;
}

export function listRuns(limit = 30): RunInfo[] {
  const rows = db
    .prepare(
      `SELECT * FROM runs ORDER BY CASE state WHEN 'running' THEN 0 WHEN 'waiting_approval' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END, created_at DESC LIMIT ?`,
    )
    .all(limit) as RunRow[];
  return rows.map(toRunInfo);
}

export function runEvents(id: string): RunEventLine[] {
  return db.prepare('SELECT t, kind, text FROM run_events WHERE run_id = ? ORDER BY id').all(id) as RunEventLine[];
}

function patch(id: string, fields: Partial<Record<keyof RunRow, unknown>>): RunInfo {
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const keys = Object.keys(clean);
  if (keys.length) {
    db.prepare(`UPDATE runs SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...clean, id });
  }
  const info = getRun(id)!;
  emit({ type: 'run.updated', run: info });
  return info;
}

function logEvent(runId: string, kind: RunEventLine['kind'], text: string) {
  lastEventAt.set(runId, Date.now());
  db.prepare('INSERT INTO run_events(run_id, t, kind, text) VALUES(?, ?, ?, ?)').run(runId, now(), kind, text.slice(0, 4000));
}

// ---------- fila ----------

const running = new Map<string, AbortController>();
// Watchdog (ideia do Paperclip): execução calada há N min avisa; 2N aborta. Quem espera o usuário fica de fora.
const lastEventAt = new Map<string, number>();
const stallWarned = new Set<string>();
const abortReason = new Map<string, string>();
// Execuções paradas esperando o usuário (aprovação/verificação humana) não ocupam vaga: o limite
// vale para quem está de fato trabalhando. Teto rígido de 2× protege a memória do container.
const waiting = new Set<string>();
const projectOf = new Map<string, string | null>();
function setWaiting(id: string, on: boolean) {
  if (!running.has(id)) return;
  if (on) waiting.add(id);
  else waiting.delete(id);
  setImmediate(pump);
}
export function hasFreeSlot(max = config.maxConcurrentRuns, total = running.size, idle = waiting.size) {
  return total - idle < max && total < max * 2;
}
// Distribuição justa: primeiro o mais antigo de um projeto que ainda não tem execução rodando.
export function pickNext(queued: { id: string; project: string | null }[], busyProjects: Set<string | null>) {
  return queued.find((q) => !busyProjects.has(q.project)) ?? queued[0];
}

// Fila segurada (atualização remota, central.ts): nada novo começa; as em andamento terminam e as
// enfileiradas esperam. O reinício do processo solta a fila (o estado não é persistido).
let held = false;
export function holdQueue(on: boolean) {
  held = on;
  if (!on) setImmediate(pump);
}
export const queueHeld = () => held;

// Portões de início (budget.ts): uma execução enfileirada que um portão segura continua na fila com o motivo
// em current_op ("Aguardando limite…") e as outras seguem. kickQueue() reavalia quando o motivo passa.
export interface GateRun { id: string; project: string | null; origin: string; routine_id: string | null; workflow_run_id: string | null }
const gates: ((r: GateRun) => string | null)[] = [];
export function addStartGate(g: (r: GateRun) => string | null) {
  gates.push(g);
}
export const kickQueue = () => setImmediate(pump);
/** Disparada sem o usuário pedir na hora: rotina, ou passo de workflow que uma rotina iniciou. */
export function isAutomaticRun(r: Pick<GateRun, 'routine_id' | 'workflow_run_id'>): boolean {
  if (r.routine_id) return true;
  if (!r.workflow_run_id) return false;
  const w = db.prepare(`SELECT origin FROM workflow_runs WHERE id = ?`).get(r.workflow_run_id) as { origin: string | null } | undefined;
  return w?.origin === 'routine';
}
export const gateReason = (r: GateRun): string | null => {
  for (const g of gates) {
    const why = g(r);
    if (why) return why;
  }
  return null;
};
/** Execuções em andamento (rodando ou esperando aprovação). */
export const busyRuns = () => (db.prepare(`SELECT COUNT(*) AS n FROM runs WHERE state IN ('running','waiting_approval')`).get() as { n: number }).n;

export interface EnqueueInput {
  agentId: string;
  project: string | null;
  instruction: string;
  task?: string;
  selectedElement?: string | null;
  origin?: 'yui' | 'manual' | 'routine' | 'mission' | 'workflow';
  routineId?: string;
  missionId?: string;
  stepId?: string;
  workflowRunId?: string;
  display?: 'blocks' | 'html' | null;
  compareOf?: string; // refazer a execução com outro modelo (compare.ts)
  model?: string | null;
}

export function enqueueRun(input: EnqueueInput): RunInfo {
  const agent = findAgent(input.agentId);
  if (!agent) throw new Error(`agente desconhecido: ${input.agentId}`);
  const project = input.project ? findProject(input.project) : undefined;
  if (input.project && !project) throw new Error(`projeto desconhecido: ${input.project}`);
  const id = uid();
  const task = (input.task ?? input.instruction).replace(/\s+/g, ' ').slice(0, 110);
  const instruction = input.selectedElement
    ? `${input.instruction}\n\nContexto visual: o usuário selecionou o elemento \`${input.selectedElement}\` no preview.`
    : input.instruction;
  db.prepare(
    `INSERT INTO runs(id, agent_id, project, instruction, task, state, origin, routine_id, mission_id, step_id, workflow_run_id, display, created_at)
     VALUES(?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, agent.id, project?.slug ?? null, instruction, task, input.origin ?? 'yui', input.routineId ?? null,
    input.missionId ?? null, input.stepId ?? null, input.workflowRunId ?? null, input.display ?? null, now());
  if (input.compareOf || input.model) db.prepare(`UPDATE runs SET compare_of = ?, model_override = ? WHERE id = ?`).run(input.compareOf ?? null, input.model ?? null, id);
  const info = getRun(id)!;
  emit({ type: 'run.updated', run: info });
  setImmediate(pump);
  return info;
}

function pump() {
  while (!held && hasFreeSlot()) {
    const rows = db.prepare(`SELECT id, project, origin, routine_id, workflow_run_id, current_op FROM runs WHERE state = 'queued' ORDER BY created_at LIMIT 50`).all() as (GateRun & { current_op: string | null })[];
    const queued = rows.filter((r) => {
      const why = gateReason(r);
      if (why && r.current_op !== why) patch(r.id, { current_op: why });
      return !why;
    });
    const pick = pickNext(queued, new Set([...projectOf.entries()].filter(([id]) => !waiting.has(id)).map(([, p]) => p)));
    if (!pick) return;
    const next = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(pick.id) as RunRow;
    const ac = new AbortController();
    running.set(next.id, ac);
    projectOf.set(next.id, next.project);
    lastEventAt.set(next.id, Date.now());
    patch(next.id, { state: 'running', started_at: now(), current_op: 'Acordando…' });
    emit({ type: 'agents.updated', agentsWorking: agentsWorking() });
    execute(next, ac)
      .catch((err) => {
        const stalled = abortReason.get(next.id);
        if (ac.signal.aborted && stalled) {
          logEvent(next.id, 'error', stalled);
          runBus.emit('finished', patch(next.id, { state: 'failed', finished_at: now(), current_op: 'Parada sem atividade', result: `Falhou: ${stalled}` }));
          return;
        }
        if (ac.signal.aborted) {
          logEvent(next.id, 'system', 'cancelado pelo usuário');
          runBus.emit('finished', patch(next.id, { state: 'cancelled', finished_at: now(), current_op: 'Cancelado', result: 'Cancelado.' }));
          return;
        }
        logEvent(next.id, 'error', String(err?.message ?? err));
        const info = patch(next.id, { state: 'failed', finished_at: now(), result: `Falhou: ${String(err?.message ?? err).slice(0, 300)}` });
        runBus.emit('finished', info);
      })
      .finally(() => {
        running.delete(next.id);
        waiting.delete(next.id);
        projectOf.delete(next.id);
        lastEventAt.delete(next.id);
        stallWarned.delete(next.id);
        abortReason.delete(next.id);
        emit({ type: 'agents.updated', agentsWorking: agentsWorking() });
        setImmediate(pump);
      });
  }
}

/** Minutos sem nenhum evento para avisar (0 = desligado); aborta no dobro. */
export function checkStalled(nowMs = Date.now(), silenceMin = Number(getSetting('runs.silenceMin') ?? 20)) {
  if (!silenceMin || silenceMin <= 0) return;
  for (const [id, ac] of running) {
    if (waiting.has(id)) {
      lastEventAt.set(id, nowMs); // esperar o usuário não conta como silêncio
      continue;
    }
    const idle = (nowMs - (lastEventAt.get(id) ?? nowMs)) / 60_000;
    if (idle >= silenceMin * 2) {
      abortReason.set(id, `sem nenhuma atividade há ${Math.round(idle)} min; parei para liberar a vaga.`);
      ac.abort();
    } else if (idle >= silenceMin && !stallWarned.has(id)) {
      stallWarned.add(id);
      const info = patch(id, { current_op: `Sem atividade há ${Math.round(idle)} min` });
      logEvent(id, 'system', `Watchdog: sem atividade há ${Math.round(idle)} min (aborta em ${silenceMin * 2} min).`);
      runBus.emit('stalled', info);
    }
  }
}
setInterval(() => checkStalled(), 60_000).unref();

export function cancelRun(id: string): boolean {
  const ac = running.get(id);
  if (ac) {
    ac.abort();
    return true;
  }
  const r = db.prepare(`UPDATE runs SET state = 'cancelled', finished_at = ? WHERE id = ? AND state = 'queued'`).run(now(), id);
  return r.changes > 0;
}

// Runs "running" de um processo anterior morreram com ele.
export function recoverRuns() {
  db.prepare(`UPDATE runs SET state = 'failed', finished_at = ?, result = 'Interrompido por reinício do Atria OS.' WHERE state IN ('running','waiting_approval')`).run(now());
  db.prepare(`UPDATE approvals SET status = 'expired', resolved_at = ? WHERE status = 'pending'`).run(now());
  setImmediate(pump);
}

// ---------- execução via Claude Agent SDK ----------

const SAFE_TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit', 'TodoWrite', 'WebSearch', 'WebFetch', 'Task'];

const SENSITIVE_MCP = /(send|reply|forward|delete|trash|remove|publish|deploy|merge|purchase|buy|pay|transfer|refund|share|invite|create_event|update_event|post_|tiktok_publish|execute_preset)/i;

const toolLabel = (name: string) => {
  if (name.startsWith('mcp__claude-in-chrome__')) return 'Chrome';
  if (name.startsWith('mcp__playwright__')) return 'Navegador';
  const m = /^mcp__([^_]+(?:_[^_]+)*)__/.exec(name);
  if (m) {
    const server = m[1].replace(/^claude_ai_/, '').replace(/[-_]/g, ' ');
    return /^claude_ai_/.test(m[1]) ? server : `${server.replace(/\b\w/g, (c) => c.toUpperCase())} MCP`;
  }
  return name;
};

function describeTool(name: string, input: Record<string, unknown>): string {
  const p = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  const short = (s: string) => s.replace(/^\/workspace\/[^/]+\//, '');
  switch (name) {
    case 'Read':
      return `Lendo ${short(p('file_path'))}`;
    case 'Edit':
    case 'Write':
      return `Editando ${short(p('file_path'))}`;
    case 'Bash':
      return `$ ${p('command').split('\n')[0].slice(0, 120)}`;
    case 'Grep':
      return `Buscando "${p('pattern').slice(0, 60)}"`;
    case 'Glob':
      return `Listando ${p('pattern')}`;
    case 'WebSearch':
      return `Pesquisando "${p('query').slice(0, 80)}"`;
    case 'WebFetch':
      return `Abrindo ${p('url').slice(0, 80)}`;
    case 'TodoWrite':
      return 'Atualizando plano';
    default: {
      const op = name.split('__').pop() ?? name;
      if (/navigate$/.test(op)) return `Navegando ${p('url').slice(0, 80)}`;
      if (/screenshot/.test(op)) return 'Tirando screenshot';
      if (/click$/.test(op)) return `Clicando ${p('element').slice(0, 60)}`;
      if (/(type|fill|form_input)/.test(op)) return 'Preenchendo formulário';
      return `${toolLabel(name)} · ${op}`;
    }
  }
}

// Aprovação genérica (modal do painel). `ownerId` = run, missão ou execução de workflow.
export async function askApproval(ownerId: string, title: string, rows: ApprovalInfo['rows'], signal?: AbortSignal, opts: { kind?: ApprovalInfo['kind']; rule?: ApprovalRule | null } = {}): Promise<boolean> {
  const id = uid();
  const rule = opts.kind === 'destructive' ? null : (opts.rule ?? null);
  db.prepare(`INSERT INTO approvals(id, run_id, title, rows, created_at, kind, rule) VALUES(?, ?, ?, ?, ?, ?, ?)`).run(id, ownerId, title, JSON.stringify(rows), now(), opts.kind ?? null, rule ? JSON.stringify(rule) : null);
  const approval: ApprovalInfo = { id, runId: ownerId, title, rows, createdAt: now(), ...(opts.kind ? { kind: opts.kind } : {}), ...(rule ? { rule } : {}) };
  emit({ type: 'approval.requested', approval });
  emit({ type: 'inbox.updated', inbox: inboxItems() });
  runBus.emit('approval', approval);
  const approved = await new Promise<boolean>((resolve) => {
    waiters.set(id, resolve);
    signal?.addEventListener('abort', () => resolve(false), { once: true });
  });
  waiters.delete(id);
  return approved;
}

async function requestApproval(run: RunRow, title: string, rows: ApprovalInfo['rows'], signal: AbortSignal, rule: ApprovalRule | null = null): Promise<boolean> {
  patch(run.id, { state: 'waiting_approval', current_op: 'Aguardando sua aprovação' });
  setWaiting(run.id, true);
  const approved = await askApproval(run.id, title, rows, signal, { rule }).finally(() => setWaiting(run.id, false));
  patch(run.id, { state: 'running', current_op: approved ? 'Aprovado — continuando' : 'Rejeitado — ajustando' });
  return approved;
}

// Pausa sem modal (verificação humana no navegador, browserChallenge.ts): a execução aparece aguardando você.
export function holdRun(id: string, waiting: boolean, op: string) {
  const r = getRun(id);
  if (!r || (r.state !== 'running' && r.state !== 'waiting_approval')) return;
  patch(id, { state: waiting ? 'waiting_approval' : 'running', current_op: op });
  setWaiting(id, waiting);
}

// Cancela todas as aprovações pendentes de um dono (missão/workflow cancelados).
export function expireApprovals(ownerId: string) {
  const rows = db.prepare(`SELECT id FROM approvals WHERE run_id = ? AND status = 'pending'`).all(ownerId) as { id: string }[];
  for (const r of rows) {
    db.prepare(`UPDATE approvals SET status = 'expired', resolved_at = ? WHERE id = ?`).run(now(), r.id);
    waiters.get(r.id)?.(false);
    emit({ type: 'approval.resolved', approvalId: r.id, approved: false });
  }
  if (rows.length) emit({ type: 'inbox.updated', inbox: inboxItems() });
}

const waiters = new Map<string, (ok: boolean) => void>();

export function resolveApproval(id: string, approved: boolean, remember = false): boolean {
  const r = db.prepare(`UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'`).run(approved ? 'approved' : 'rejected', now(), id);
  if (!r.changes) return false;
  if (remember) {
    const row = db.prepare(`SELECT rule, kind FROM approvals WHERE id = ?`).get(id) as { rule: string | null; kind: string | null } | undefined;
    if (row?.rule && row.kind !== 'destructive') addRule(JSON.parse(row.rule) as ApprovalRule, approved ? 'allow' : 'deny');
  }
  waiters.get(id)?.(approved);
  emit({ type: 'approval.resolved', approvalId: id, approved });
  emit({ type: 'inbox.updated', inbox: inboxItems() });
  return true;
}

export function pendingApprovals(): ApprovalInfo[] {
  const rows = db.prepare(`SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at`).all() as {
    id: string; run_id: string; title: string; rows: string; created_at: string; kind: string | null; rule: string | null;
  }[];
  return rows.map((r) => ({ id: r.id, runId: r.run_id, title: r.title, rows: JSON.parse(r.rows), createdAt: r.created_at, ...(r.kind === 'destructive' ? { kind: 'destructive' as const } : r.rule ? { rule: JSON.parse(r.rule) as ApprovalRule } : {}) }));
}

// Outros módulos (suporte remoto e avisos, support.ts) somam itens ao inbox e decidem como dispensá-los.
const inboxSources: { prefixes: string[]; items: () => InboxItem[]; dismiss: (id: string) => boolean }[] = [];
export function addInboxSource(src: (typeof inboxSources)[number]) {
  inboxSources.push(src);
}

export function inboxItems(): InboxItem[] {
  const dismissed = new Set(dismissedInbox());
  const items: InboxItem[] = pendingApprovals().map((a) => ({
    id: `approval:${a.id}`,
    tag: a.kind === 'destructive' ? 'Exclusão' : 'Aprovação',
    label: a.title,
    tone: a.kind === 'destructive' ? 'crit' : 'warn',
    action: { type: 'approval', approvalId: a.id },
  }));
  const failed = db
    .prepare(`SELECT id, task, project FROM runs WHERE state = 'failed' AND finished_at > ? ORDER BY finished_at DESC LIMIT 3`)
    .all(new Date(Date.now() - 24 * 3600_000).toISOString()) as { id: string; task: string; project: string | null }[];
  for (const f of failed) {
    if (dismissed.has(`failed:${f.id}`)) continue;
    items.push({ id: `failed:${f.id}`, tag: 'Falha', label: f.task, tone: 'crit', action: { type: 'view', view: 'runs', params: { runId: f.id } } });
  }
  items.push(...designInboxItems());
  for (const src of inboxSources) items.push(...src.items());
  return items;
}

// Falhas dispensadas pelo usuário somem do inbox (aprovações pendentes nunca são dispensáveis).
const dismissedInbox = (): string[] => {
  try {
    const v = JSON.parse(kvGet('inbox_dismissed') ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export function dismissInboxItem(id: string): boolean {
  const src = inboxSources.find((x) => x.prefixes.some((p) => id.startsWith(p)));
  if (src) return src.dismiss(id);
  if (!id.startsWith('failed:')) return false;
  const list = dismissedInbox().filter((x) => x !== id);
  kvSet('inbox_dismissed', JSON.stringify([...list, id].slice(-200)));
  emit({ type: 'inbox.updated', inbox: inboxItems() });
  return true;
}

// ---------- histórico: paginação e exclusão ----------

const ACTIVE_STATES = `('running','queued','waiting_approval')`;

// Página do histórico por data de criação (mais novas primeiro); `before` = created_at do último item já mostrado.
export function listRunsPage(before: string | null, limit = 40): { runs: RunInfo[]; next: string | null } {
  const rows = (before
    ? db.prepare(`SELECT * FROM runs WHERE created_at < ? ORDER BY created_at DESC LIMIT ?`).all(before, limit)
    : db.prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT ?`).all(limit)) as RunRow[];
  return { runs: rows.map(toRunInfo), next: rows.at(-1)?.created_at ?? null };
}

// Exclui uma execução (eventos vão junto). Ativa: cancela e espera o loop soltar a run antes de apagar.
export async function deleteRun(id: string): Promise<boolean> {
  if (!getRun(id)) return false;
  if (running.has(id)) {
    cancelRun(id);
    for (let i = 0; i < 100 && running.has(id); i++) await new Promise((r) => setTimeout(r, 50));
    if (running.has(id)) throw new Error('a execução não parou a tempo; tente de novo');
  } else cancelRun(id);
  expireApprovals(id);
  db.prepare('DELETE FROM run_events WHERE run_id = ?').run(id);
  db.prepare('DELETE FROM runs WHERE id = ?').run(id);
  emit({ type: 'inbox.updated', inbox: inboxItems() });
  return true;
}

// Apaga execuções terminadas há mais de N dias; ativas e na fila ficam.
export function purgeRuns(olderThanDays: number): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const where = `state NOT IN ${ACTIVE_STATES} AND COALESCE(finished_at, created_at) < ?`;
  const n = db.transaction(() => {
    db.prepare(`DELETE FROM run_events WHERE run_id IN (SELECT id FROM runs WHERE ${where})`).run(cutoff);
    return db.prepare(`DELETE FROM runs WHERE ${where}`).run(cutoff).changes;
  })();
  if (n) emit({ type: 'inbox.updated', inbox: inboxItems() });
  return n;
}

// Cada execução de workflow ganha a própria pasta (compartilhada pelos passos dela), para rodar o mesmo
// workflow várias vezes ao mesmo tempo sem uma sobrescrever os arquivos da outra.
export function workflowRunDir(base: string, wfRunId: string): string {
  const row = db.prepare(`SELECT workflow, started_at FROM workflow_runs WHERE id = ?`).get(wfRunId) as { workflow: string; started_at: string } | undefined;
  const at = row ? new Date(row.started_at) : new Date();
  const stamp = at.toLocaleString('sv-SE', { timeZone: process.env.TZ || undefined }).slice(0, 16).replace(' ', '_').replace(':', 'h');
  const slug = (row?.workflow ?? 'workflow').replace(/[^\w.-]+/g, '-');
  return join(base, '.atria', 'execucoes', slug, `${stamp}-${wfRunId.slice(0, 6)}`);
}

// Mantém .atria/ fora do git do projeto sem mexer no .gitignore versionado.
function excludeFromGit(projectDir: string) {
  const exclude = join(projectDir, '.git', 'info', 'exclude');
  if (!existsSync(join(projectDir, '.git'))) return;
  try {
    const cur = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    if (!/^\/?\.atria\/?$/m.test(cur)) {
      mkdirSync(join(projectDir, '.git', 'info'), { recursive: true });
      appendFileSync(exclude, `${cur && !cur.endsWith('\n') ? '\n' : ''}/.atria/\n`);
    }
  } catch { /* repo somente leitura: segue sem */ }
}

function systemAppend(agent: AgentDef, projectName: string | null, runDir?: { dir: string; root: string } | null, goal?: string | null): string {
  return [
    `Você é o ${agent.name}, um agente da força de trabalho da Yui, no Atria OS.`,
    agent.prompt,
    '',
    'Regras de execução:',
    '- Use TodoWrite logo no início com 3 a 6 passos curtos em português; mantenha-o atualizado — ele vira a timeline que o usuário vê.',
    '- Trabalhe de forma autônoma; não faça perguntas ao usuário. Se algo bloquear, explique no resultado final.',
    '- Você trabalha no automático: não peça confirmação ao usuário, siga até entregar. Comandos catastróficos (apagar raiz/workspace, formatar disco, DROP DATABASE, mexer em stacks de produção protegidos, force push na main) são bloqueados; se um comando for negado, siga sem ele.',
    '- Resposta final: 1 a 3 frases em português, no estilo de status para ser falado em voz alta (o que foi feito, resultado, próximo passo).',
    projectName ? `- Projeto atual: ${projectName}.` : '- Sem projeto específico: trabalhe em /workspace/.atria/scratch.',
    ...(projectName && goal ? [`- Objetivo do projeto (o "por quê" das tarefas daqui; use para decidir prioridades e detalhes): ${goal}`] : []),
    ...(runDir ? [
      `- Esta é uma execução de workflow com pasta própria: ${runDir.dir} (diretório atual). Grave aqui tudo o que gerar (relatórios, rascunhos, planilhas, screenshots, arquivos intermediários); os outros passos desta execução leem daqui. Outras execuções do mesmo workflow podem estar rodando ao mesmo tempo, cada uma na sua pasta: nunca grave arquivos gerados fora desta pasta.`,
      `- Arquivos do projeto ficam em ${runDir.root}: leia de lá à vontade; só altere arquivos do projeto quando o passo pedir isso explicitamente.`,
    ] : []),
    '- Navegador: use as ferramentas mcp__playwright__* (navegador do Atria na VPS, que o usuário assiste ao vivo) para navegar, testar sites, preencher formulários e tirar screenshots. Use mcp__claude-in-chrome__* só quando precisar do Chrome real do usuário (contas logadas dele) — chame list_connected_browsers antes; se não houver navegador conectado, use o Playwright e diga isso no resultado. Screenshots com filename relativo são salvos no diretório do projeto atual.',
    '- Relatórios: se pedirem um relatório, grave JSON em /workspace/.atria/reports/<AAAA-MM-DD-HHmm>.json com {title, lead, kpis:[{value,label}], sections:[{heading, tone:"cyan"|"warn"|"ok", items:[...]}]}.',
  ].join('\n');
}

// Login claude.ai no container (docker exec … claude → /login) traz conectores MCP e tem prioridade;
// sem ele, usa o token de inferência do setup-token.
export const claudeLoggedIn = () => existsSync(join(process.env.HOME ?? '/data/home', '.claude', '.credentials.json'));

export function claudeEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!claudeLoggedIn() && config.claudeToken) env.CLAUDE_CODE_OAUTH_TOKEN = config.claudeToken;
  return env;
}

async function execute(run: RunRow, ac: AbortController) {
  const agent = findAgent(run.agent_id);
  if (!agent) throw new Error(`agente ${run.agent_id} não existe mais`);
  let project = run.project ? findProject(run.project) : undefined;
  if (project && !project.cloned) {
    patch(run.id, { current_op: `Clonando ${project.repo}…` });
    project = await ensureProject(project);
  }
  const scratch = join(config.metaDir, 'scratch');
  const metaDir = config.metaDir;
  mkdirSync(join(metaDir, 'reports'), { recursive: true });
  mkdirSync(scratch, { recursive: true });
  const root = project?.dir ?? scratch;
  let runDir: { dir: string; root: string } | null = null;
  if (run.workflow_run_id) {
    runDir = { dir: workflowRunDir(root, run.workflow_run_id), root };
    mkdirSync(runDir.dir, { recursive: true });
    if (project) excludeFromGit(project.dir);
  }
  // Comparação (refazer com outro modelo): em projeto com git roda numa cópia isolada (git worktree) e pode
  // mexer à vontade; sem git, só lê. O original nunca é tocado.
  let compare: { dir: string | null; readOnly: boolean } | null = null;
  if (run.compare_of) {
    compare = { dir: null, readOnly: true };
    if (project && existsSync(join(project.dir, '.git'))) {
      const wt = join(config.metaDir, 'compare', run.id);
      try {
        mkdirSync(join(config.metaDir, 'compare'), { recursive: true });
        execFileSync('git', ['-C', project.dir, 'worktree', 'add', '--detach', wt, 'HEAD'], { stdio: 'pipe', timeout: 60_000 });
        compare = { dir: wt, readOnly: false };
        patch(run.id, { worktree: wt } as Partial<Record<keyof RunRow, unknown>>);
      } catch (e) {
        logEvent(run.id, 'system', `Sem cópia isolada (${(e as Error).message.split('\n')[0]}); esta comparação só lê.`);
      }
    }
  }
  const cwd = compare?.dir ?? runDir?.dir ?? root;
  const extraPatterns = (project?.approvalPatterns ?? []).map((p) => new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const canUseTool: CanUseTool = async (toolName, input, { signal }) => {
    if (toolName === 'Bash') {
      const cmd = String(input.command ?? '');
      // Automático por padrão: só o catastrófico é negado (sem modal) e só os padrões que o usuário
      // configurou no atria.json do projeto pedem aprovação.
      // comparação: nada sai da cópia isolada (sem push, deploy ou publicação)
      if (run.compare_of && /\bgit\s+(push|remote)\b|\bdeploy\b|\bvercel\b|\bdocker\s+(push|compose\s+up)\b|\bnpm\s+publish\b/.test(cmd)) {
        logEvent(run.id, 'system', `Comparação: bloqueado "${cmd.split('\n')[0].slice(0, 120)}"`);
        return { behavior: 'deny', message: 'Esta é uma execução de comparação: não envie nada para fora da cópia (push, deploy, publicação). Descreva o que faria.' };
      }
      const blocked = blockedReason(cmd);
      if (blocked) {
        logEvent(run.id, 'system', `Bloqueado por segurança (${blocked}): ${cmd.split('\n')[0].slice(0, 200)}`);
        return { behavior: 'deny', message: `Comando bloqueado por segurança (${blocked}). Não tente contornar; siga sem ele e explique no resultado.` };
      }
      if (extraPatterns.some((re) => re.test(cmd))) {
        const saved = matchRule('bash', cmd, agent.id, run.project);
        if (saved === 'allow') {
          logEvent(run.id, 'system', `Regra salva: sempre permitir "${ruleKey('bash', cmd)}"`);
          return { behavior: 'allow', updatedInput: input };
        }
        if (saved === 'deny') {
          logEvent(run.id, 'system', `Regra salva: sempre bloquear "${ruleKey('bash', cmd)}"`);
          return { behavior: 'deny', message: 'O usuário bloqueou este comando para você neste projeto. Continue sem ele e explique no resultado.' };
        }
        const bashKey = ruleKey('bash', cmd);
        const ok = await requestApproval(
          run,
          `${agent.name} quer executar um comando sensível${project ? ` no ${project.name}` : ''}.`,
          [
            { label: 'Comando', value: cmd.split('\n')[0].slice(0, 80) },
            { label: 'Agente', value: agent.name },
            { label: 'Projeto', value: project?.name ?? '—' },
          ],
          signal,
          bashKey ? { kind: 'bash', key: bashKey, agentId: agent.id, project: run.project } : null,
        );
        return ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'O usuário rejeitou este comando. Continue sem executá-lo e explique no resultado.' };
      }
      return { behavior: 'allow', updatedInput: input };
    }
    if (run.compare_of && toolName.startsWith('mcp__') && SENSITIVE_MCP.test(toolName.split('__').pop() ?? '')) {
      return { behavior: 'deny', message: 'Esta é uma execução de comparação: não use ações com efeito externo (enviar, publicar, pagar).' };
    }
    // Conectores/MCP com efeito externo irreversível (enviar e-mail, publicar, pagar…) pedem aprovação.
    if (toolName.startsWith('mcp__') && getSetting('approvals.mcpSensitive') !== false && SENSITIVE_MCP.test(toolName.split('__').pop() ?? '')) {
      const saved = matchRule('mcp', toolName, agent.id, run.project);
      if (saved === 'allow') {
        logEvent(run.id, 'system', `Regra salva: sempre permitir ${toolName}`);
        return { behavior: 'allow', updatedInput: input };
      }
      if (saved === 'deny') {
        logEvent(run.id, 'system', `Regra salva: sempre bloquear ${toolName}`);
        return { behavior: 'deny', message: 'O usuário bloqueou esta ação para você neste projeto. Continue sem ela e explique no resultado.' };
      }
      const mcpKey = ruleKey('mcp', toolName);
      const ok = await requestApproval(
        run,
        `${agent.name} quer usar ${toolLabel(toolName)} (${toolName.split('__').pop()}).`,
        [
          { label: 'Ferramenta', value: toolName.split('__').pop() ?? toolName },
          { label: 'Detalhe', value: JSON.stringify(input).slice(0, 80) },
          { label: 'Agente', value: agent.name },
        ],
        signal,
        mcpKey ? { kind: 'mcp', key: mcpKey, agentId: agent.id, project: run.project } : null,
      );
      return ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'O usuário rejeitou esta ação. Continue sem ela e explique no resultado.' };
    }
    return { behavior: 'allow', updatedInput: input };
  };

  const tools = new Set<string>(JSON.parse(run.tools));
  let steps: RunStep[] = [];
  let lastContext = 0;
  let turns = 0;

  const { mcpServers: extraMcp, ...perAgent } = agentOptions(agent.id, { runId: run.id });
  const q = query({
    prompt: run.instruction,
    options: {
      cwd,
      abortController: ac,
      additionalDirectories: runDir ? [metaDir, root] : [metaDir],
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: [systemAppend(agent, project?.name ?? null, runDir, project?.goal ?? null), compare ? (compare.readOnly ? '- Esta é uma execução de COMPARAÇÃO só de leitura: não altere arquivos; investigue e responda.' : `- Esta é uma execução de COMPARAÇÃO numa cópia isolada do projeto (${compare.dir}): trabalhe nela normalmente; o usuário compara com a execução original e decide se fica com a sua. Não faça push, deploy nem envio externo.`) : '', runPromptExtras({ runId: run.id, agentId: agent.id, project: project?.slug ?? null, display: run.display })].filter(Boolean).join('\n'),
      },
      permissionMode: 'default',
      allowedTools: SAFE_TOOLS,
      canUseTool,
      // user: plugins/settings instalados no HOME do container; claude.ai: conectores MCP do login.
      settingSources: ['user', 'project', 'local'],
      // Navegador headless (sidecar Playwright) + Claude in Chrome (Chrome real do usuário, quando conectado).
      mcpServers: { playwright: { type: 'http', url: config.browserMcpUrl }, ...(extraMcp ?? {}) },
      extraArgs: { chrome: null },
      model: agent.model || config.claudeModel || undefined,
      maxTurns: 80,
      // freio opcional contra loop em execução automática (estimativa do SDK em US$, não cobrança do plano)
      ...(Number(getSetting('budget.runMaxUsd') ?? 0) > 0 && isAutomaticRun(run) ? { maxBudgetUsd: Number(getSetting('budget.runMaxUsd')) } : {}),
      env: claudeEnv(),
      ...perAgent,
      ...(run.model_override ? { model: run.model_override } : {}),
      ...(compare?.readOnly ? { disallowedTools: [...(perAgent.disallowedTools ?? []), 'Edit', 'Write', 'NotebookEdit', 'Bash'] } : {}),
    },
  });

  for await (const msg of q as AsyncIterable<SDKMessage>) {
    lastEventAt.set(run.id, Date.now());
    if (msg.type === 'system' && msg.subtype === 'init') {
      patch(run.id, { session_id: msg.session_id, model_used: msg.model } as Partial<Record<keyof RunRow, unknown>>);
      logEvent(run.id, 'system', `session ${msg.session_id} · cwd ${cwd} · ${msg.model}`);
      const mcp = msg.mcp_servers.map((m) => `${m.name}${m.status === 'connected' ? '' : ` (${m.status})`}`);
      if (mcp.length) logEvent(run.id, 'system', `MCP: ${mcp.join(', ')}`);
      if (msg.plugins.length) logEvent(run.id, 'system', `plugins: ${msg.plugins.map((p) => p.name).join(', ')}`);
      kvSet('claude_capabilities', JSON.stringify({ at: now(), mcp: msg.mcp_servers, plugins: msg.plugins.map((p) => p.name), apiKeySource: msg.apiKeySource }));
    } else if (msg.type === 'rate_limit_event') {
      // limites do plano (sessão de 5 h, semana…): o painel Consumo de IA mostra o último lido
      saveRateLimit((msg as { rate_limit_info?: unknown }).rate_limit_info);
    } else if (msg.type === 'assistant') {
      turns++;
      // contexto ocupado no turno do loop principal (subagentes têm janela própria)
      const u = (msg.message as { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage;
      if (u && !(msg as { parent_tool_use_id?: string | null }).parent_tool_use_id) lastContext = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text.trim()) {
          logEvent(run.id, 'text', block.text.trim());
        } else if (block.type === 'tool_use') {
          const input = (block.input ?? {}) as Record<string, unknown>;
          tools.add(toolLabel(block.name));
          const op = describeTool(block.name, input);
          logEvent(run.id, 'tool', op);
          const fields: Record<string, unknown> = { current_op: op, tools: JSON.stringify([...tools]) };
          if (block.name === 'TodoWrite' && Array.isArray(input.todos)) {
            const todos = input.todos as { content: string; status: string; activeForm?: string }[];
            steps = todos.map((t) => ({
              label: t.status === 'in_progress' ? (t.activeForm ?? t.content) : t.content,
              status: t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'active' : 'pending',
            }));
            const done = todos.filter((t) => t.status === 'completed').length;
            fields.steps = JSON.stringify(steps);
            fields.progress = Math.min(95, Math.round((done / Math.max(1, todos.length)) * 100));
          } else if (!steps.length) {
            fields.progress = Math.min(80, 5 + turns * 4);
          }
          const info = patch(run.id, fields);
          runBus.emit('progress', info);
        }
      }
    } else if (msg.type === 'result') {
      const usage = msg.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
      // modelUsage soma também os subagentes (Task); usage é só o loop principal
      const mu = Object.values((msg as { modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; contextWindow?: number }> }).modelUsage ?? {});
      const muIn = mu.reduce((a, m) => a + (m.inputTokens ?? 0) + (m.cacheReadInputTokens ?? 0) + (m.cacheCreationInputTokens ?? 0), 0);
      const muOut = mu.reduce((a, m) => a + (m.outputTokens ?? 0), 0);
      const ctxWindow = mu.reduce((a, m) => Math.max(a, m.contextWindow ?? 0), 0);
      const ok = msg.subtype === 'success';
      const result = ok ? ((msg as { result?: string }).result ?? '').trim() : `Falhou (${msg.subtype}). ${(msg as { errors?: string[] }).errors?.join('; ') ?? ''}`;
      logEvent(run.id, ok ? 'result' : 'error', result || '(sem texto)');
      logEvent(run.id, 'system', `tokens: ${(usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)} in · ${usage.output_tokens ?? 0} out · $${msg.total_cost_usd.toFixed(4)}`);
      const info = patch(run.id, {
        state: ok ? 'done' : 'failed',
        progress: ok ? 100 : undefined,
        finished_at: now(),
        result: result.slice(0, 24000), // resultado completo: missões e workflows passam adiante
        current_op: ok ? 'Concluído' : 'Falhou',
        steps: JSON.stringify(ok ? steps.map((s) => ({ ...s, status: 'done' })) : steps),
        tokens_in: muIn || (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
        tokens_out: muOut || (usage.output_tokens ?? 0),
        cost_usd: msg.total_cost_usd,
        context_tokens: lastContext || null,
        context_window: ctxWindow || null,
        num_turns: (msg as { num_turns?: number }).num_turns ?? turns,
      } as Partial<Record<keyof RunRow, unknown>>);
      runBus.emit('finished', info);
      return;
    }
  }
  if (ac.signal.aborted) {
    const info = patch(run.id, { state: 'cancelled', finished_at: now(), current_op: 'Cancelado' });
    runBus.emit('finished', info);
  }
}
