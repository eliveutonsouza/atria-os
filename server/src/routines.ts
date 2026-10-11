import cron, { type ScheduledTask } from 'node-cron';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { NotifyChannel, RoutineInfo, RunInfo } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, now, uid } from './db.ts';
import { findAgent } from './agents.ts';
import { enqueueRun, runBus } from './runs.ts';
import { onEmit } from './bus.ts';
import { publicUrl, sendNotice } from './notify.ts';

// Rotinas: disparo por cron (sleep → wake → work → sleep) de
//  - um workflow (workflow_id), ou
//  - um agente + projeto + instrução simples.
// Ideias do Paperclip/Hermes: não empilhar (overlap skip: pula se a anterior ainda roda), recuperar o último
// disparo perdido com o servidor fora do ar (catchup) e entregar o resultado por Telegram/e-mail/push
// (deliver: sempre, só se falhar ou só se mudar desde a última vez).

for (const [col, def] of [['overlap', "TEXT NOT NULL DEFAULT 'skip'"], ['catchup', 'INTEGER NOT NULL DEFAULT 1'], ['deliver', "TEXT NOT NULL DEFAULT '[]'"], ['deliver_mode', "TEXT NOT NULL DEFAULT 'always'"], ['last_fire_at', 'TEXT'], ['last_result_hash', 'TEXT']] as const) {
  if (!(db.prepare(`SELECT 1 FROM pragma_table_info('routines') WHERE name = ?`).get(col))) db.exec(`ALTER TABLE routines ADD COLUMN ${col} ${def}`);
}

interface RoutineRow {
  id: string;
  name: string;
  cron: string;
  agent_id: string; // '' quando é workflow
  project: string | null;
  instruction: string; // '' quando é workflow
  enabled: number;
  workflow_id: string | null;
  created_at: string;
  overlap: 'skip' | 'queue';
  catchup: number;
  deliver: string; // JSON NotifyChannel[]
  deliver_mode: 'always' | 'fail' | 'change';
  last_fire_at: string | null;
  last_result_hash: string | null;
}

// Executor de workflow injetado por workflows.ts (evita import circular).
type WorkflowRunner = (slug: string, opts: { routineId: string; origin: 'routine' | 'manual' }) => Promise<unknown> | unknown;
let workflowRunner: WorkflowRunner | null = null;
export function setWorkflowRunner(fn: WorkflowRunner) {
  workflowRunner = fn;
}

const tasks = new Map<string, ScheduledTask>();

/** A execução anterior desta rotina ainda está na fila, rodando ou esperando você. */
export function stillActive(r: Pick<RoutineRow, 'id' | 'workflow_id'>): boolean {
  if (r.workflow_id) return !!db.prepare(`SELECT 1 FROM workflow_runs WHERE routine_id = ? AND status IN ('running','waiting_approval','waiting_input') LIMIT 1`).get(r.id);
  return !!db.prepare(`SELECT 1 FROM runs WHERE routine_id = ? AND state IN ('queued','running','waiting_approval') LIMIT 1`).get(r.id);
}

function fire(r: RoutineRow, origin: 'routine' | 'manual' = 'routine') {
  if (origin === 'routine' && (r.overlap ?? 'skip') === 'skip' && stillActive(r)) {
    console.log(`rotina ${r.name}: a anterior ainda está rodando; pulei este disparo`);
    return;
  }
  if (origin === 'routine') db.prepare(`UPDATE routines SET last_fire_at = ? WHERE id = ?`).run(now(), r.id);
  try {
    if (r.workflow_id) {
      if (!workflowRunner) throw new Error('executor de workflows indisponível');
      void Promise.resolve(workflowRunner(r.workflow_id, { routineId: r.id, origin })).catch((e) => console.error(`rotina ${r.name}:`, (e as Error).message));
      return;
    }
    enqueueRun({ agentId: r.agent_id, project: r.project, instruction: r.instruction, task: r.name, origin: 'routine', routineId: r.id });
  } catch (e) {
    console.error(`rotina ${r.name}:`, (e as Error).message);
  }
}

function schedule(r: RoutineRow) {
  tasks.get(r.id)?.stop();
  tasks.delete(r.id);
  if (!r.enabled) return;
  // relê a linha a cada disparo: overlap/entrega podem ter mudado sem reagendar
  tasks.set(r.id, cron.schedule(r.cron, () => fire(getRow(r.id) ?? r), { timezone: config.timezone }));
}

/** Último horário agendado entre `fromMs` e `toMs` (no máximo 24 h para trás), ou null. */
export function missedSince(expr: string, fromMs: number, toMs = Date.now()): Date | null {
  const t = cron.createTask(expr, () => {}, { timezone: config.timezone });
  try {
    const start = Math.max(fromMs, toMs - 86400_000);
    const minute = 60_000;
    for (let m = Math.floor(toMs / minute) * minute; m > start; m -= minute) {
      const d = new Date(m);
      if (t.match(d)) return d;
    }
    return null;
  } finally {
    void t.destroy();
  }
}

function getRow(id: string): RoutineRow | undefined {
  return db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as RoutineRow | undefined;
}

export interface RoutineInput {
  name: string;
  cron: string;
  agentId?: string | null;
  project?: string | null;
  instruction?: string | null;
  workflowId?: string | null;
  enabled?: boolean;
  overlap?: 'skip' | 'queue';
  catchup?: boolean;
  deliver?: NotifyChannel[];
  deliverMode?: 'always' | 'fail' | 'change';
}

const CHANNELS = new Set(['telegram', 'email', 'push']);
const cleanDeliver = (d: unknown): NotifyChannel[] => (Array.isArray(d) ? [...new Set(d.filter((c): c is NotifyChannel => typeof c === 'string' && CHANNELS.has(c)))] : []);

function validate(input: RoutineInput): { agentId: string; instruction: string } {
  if (!cron.validate(input.cron)) throw new Error(`cron inválido: ${input.cron}`);
  if (input.workflowId) return { agentId: '', instruction: '' };
  if (!input.agentId) throw new Error('rotina precisa de workflow ou agente');
  const agent = findAgent(input.agentId);
  if (!agent) throw new Error(`agente desconhecido: ${input.agentId}`);
  if (!input.instruction?.trim()) throw new Error('rotina sem instrução');
  return { agentId: agent.id, instruction: input.instruction.trim() };
}

export function createRoutine(input: RoutineInput) {
  const v = validate(input);
  const row: RoutineRow = {
    id: uid(), name: input.name, cron: input.cron, agent_id: v.agentId, project: input.project ?? null,
    instruction: v.instruction, enabled: input.enabled === false ? 0 : 1, workflow_id: input.workflowId ?? null, created_at: now(),
    overlap: input.overlap === 'queue' ? 'queue' : 'skip', catchup: input.catchup === false ? 0 : 1, deliver: JSON.stringify(cleanDeliver(input.deliver)),
    deliver_mode: input.deliverMode === 'fail' || input.deliverMode === 'change' ? input.deliverMode : 'always', last_fire_at: null, last_result_hash: null,
  };
  db.prepare(
    `INSERT INTO routines(id, name, cron, agent_id, project, instruction, enabled, workflow_id, created_at, overlap, catchup, deliver, deliver_mode)
     VALUES(@id, @name, @cron, @agent_id, @project, @instruction, @enabled, @workflow_id, @created_at, @overlap, @catchup, @deliver, @deliver_mode)`,
  ).run(row);
  schedule(row);
  return row;
}

export function updateRoutine(id: string, input: Partial<RoutineInput>) {
  const cur = getRow(id);
  if (!cur) throw new Error('rotina não encontrada');
  const merged: RoutineInput = {
    name: input.name ?? cur.name,
    cron: input.cron ?? cur.cron,
    agentId: input.agentId !== undefined ? input.agentId : cur.agent_id || null,
    project: input.project !== undefined ? input.project : cur.project,
    instruction: input.instruction !== undefined ? input.instruction : cur.instruction || null,
    workflowId: input.workflowId !== undefined ? input.workflowId : cur.workflow_id,
    enabled: input.enabled !== undefined ? input.enabled : !!cur.enabled,
  };
  const v = validate(merged);
  const row: RoutineRow = {
    ...cur, name: merged.name, cron: merged.cron, agent_id: v.agentId, project: merged.project ?? null,
    instruction: v.instruction, enabled: merged.enabled ? 1 : 0, workflow_id: merged.workflowId ?? null,
    overlap: input.overlap === 'queue' || input.overlap === 'skip' ? input.overlap : cur.overlap ?? 'skip',
    catchup: input.catchup === undefined ? cur.catchup ?? 1 : input.catchup ? 1 : 0,
    deliver: input.deliver === undefined ? cur.deliver ?? '[]' : JSON.stringify(cleanDeliver(input.deliver)),
    deliver_mode: input.deliverMode === 'always' || input.deliverMode === 'fail' || input.deliverMode === 'change' ? input.deliverMode : cur.deliver_mode ?? 'always',
  };
  db.prepare(
    `UPDATE routines SET name=@name, cron=@cron, agent_id=@agent_id, project=@project, instruction=@instruction, enabled=@enabled, workflow_id=@workflow_id,
       overlap=@overlap, catchup=@catchup, deliver=@deliver, deliver_mode=@deliver_mode WHERE id=@id`,
  ).run(row);
  schedule(row);
  return row;
}

export function deleteRoutine(id: string): boolean {
  tasks.get(id)?.stop();
  tasks.delete(id);
  return db.prepare('DELETE FROM routines WHERE id = ?').run(id).changes > 0;
}

export function runRoutineNow(id: string): boolean {
  const r = getRow(id);
  if (!r) return false;
  fire(r, 'manual');
  return true;
}

export function listRoutines(): RoutineRow[] {
  return db.prepare('SELECT * FROM routines ORDER BY created_at').all() as RoutineRow[];
}

// Rotinas que executam um workflow (para "agendar workflow" e exclusão em cascata).
export function routinesForWorkflow(slug: string): RoutineRow[] {
  return db.prepare('SELECT * FROM routines WHERE workflow_id = ?').all(slug) as RoutineRow[];
}

function lastOf(r: RoutineRow): { at: string | null; status: string | null } {
  if (r.workflow_id) {
    const w = db
      .prepare(`SELECT status, started_at FROM workflow_runs WHERE routine_id = ? ORDER BY started_at DESC LIMIT 1`)
      .get(r.id) as { status: string; started_at: string } | undefined;
    return { at: w?.started_at ?? null, status: w?.status ?? null };
  }
  const run = db
    .prepare(`SELECT state, created_at FROM runs WHERE routine_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(r.id) as { state: string; created_at: string } | undefined;
  return { at: run?.created_at ?? null, status: run?.state ?? null };
}

export function routineInfos(): RoutineInfo[] {
  return listRoutines().map((r) => {
    const last = lastOf(r);
    const next = tasks.get(r.id)?.getNextRun() ?? null;
    return {
      id: r.id,
      name: r.name,
      cron: r.cron,
      nextRun: next ? next.toISOString() : null,
      lastRun: last.at,
      lastStatus: last.status,
      workflow: r.workflow_id,
      agentId: r.agent_id || null,
      project: r.project,
      instruction: r.instruction || null,
      enabled: !!r.enabled,
      overlap: r.overlap ?? 'skip',
      catchup: r.catchup !== 0,
      deliver: cleanDeliver(JSON.parse(r.deliver || '[]')),
      deliverMode: r.deliver_mode ?? 'always',
    };
  });
}

export function startRoutines() {
  for (const r of listRoutines()) {
    try {
      schedule(r);
      // disparo perdido com o servidor fora do ar: roda só o último (até 24 h), uma vez
      if (r.enabled && r.catchup !== 0 && r.last_fire_at) {
        const missed = missedSince(r.cron, Date.parse(r.last_fire_at) + 60_000);
        if (missed) {
          console.log(`rotina ${r.name}: recuperando o disparo perdido de ${missed.toISOString()}`);
          fire(r);
        }
      }
    } catch (e) {
      console.error(`rotina ${r.name} ignorada:`, (e as Error).message);
    }
  }
}

// ---------- entrega do resultado ----------

const hashOf = (s: string) => createHash('sha1').update(s.slice(0, 4000)).digest('hex');

/** Decide e envia a entrega de uma rotina (exportado para os testes). */
export async function deliverResult(routineId: string, ok: boolean, result: string): Promise<boolean> {
  const r = getRow(routineId);
  if (!r) return false;
  const channels = cleanDeliver(JSON.parse(r.deliver || '[]'));
  const h = hashOf(result);
  const changed = h !== r.last_result_hash;
  db.prepare(`UPDATE routines SET last_result_hash = ? WHERE id = ?`).run(h, r.id);
  if (!channels.length) return false;
  if (r.deliver_mode === 'fail' && ok) return false;
  if (r.deliver_mode === 'change' && ok && !changed) return false;
  await sendNotice({ title: `${ok ? 'Rotina' : 'Rotina falhou'} · ${r.name}`, text: result.slice(0, 3500) || (ok ? 'Concluída.' : 'Falhou.'), url: publicUrl('/app'), channels, kind: 'notice' });
  return true;
}

runBus.on('finished', (run: RunInfo) => {
  if (run.workflowRunId || run.state === 'cancelled') return;
  const row = db.prepare(`SELECT routine_id FROM runs WHERE id = ?`).get(run.id) as { routine_id: string | null } | undefined;
  if (row?.routine_id) void deliverResult(row.routine_id, run.state === 'done', run.result ?? '');
});
onEmit((ev) => {
  if (ev.type !== 'workflow.run.updated' || !['done', 'failed'].includes(ev.run.status)) return;
  const row = db.prepare(`SELECT routine_id FROM workflow_runs WHERE id = ?`).get(ev.run.id) as { routine_id: string | null } | undefined;
  if (!row?.routine_id) return;
  // um aviso por execução de workflow (o evento chega várias vezes)
  if (delivered.has(ev.run.id)) return;
  delivered.add(ev.run.id);
  if (delivered.size > 500) delivered.delete(delivered.values().next().value!);
  const last = Object.values(ev.run.nodes).map((n) => n.result).filter(Boolean).at(-1) ?? '';
  void deliverResult(row.routine_id, ev.run.status === 'done', last ?? '');
});
const delivered = new Set<string>();

export function registerRoutineRoutes(app: FastifyInstance) {
  app.get('/api/routines', () => routineInfos());
  app.post('/api/routines', async (req, reply) => {
    try {
      const r = createRoutine(req.body as RoutineInput);
      return routineInfos().find((x) => x.id === r.id);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
  app.put('/api/routines/:id', async (req, reply) => {
    try {
      const r = updateRoutine((req.params as { id: string }).id, req.body as Partial<RoutineInput>);
      return routineInfos().find((x) => x.id === r.id);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
  app.delete('/api/routines/:id', async (req, reply) => reply.code(deleteRoutine((req.params as { id: string }).id) ? 204 : 404).send());
  app.post('/api/routines/:id/run', async (req, reply) => reply.code(runRoutineNow((req.params as { id: string }).id) ? 202 : 404).send());
}
