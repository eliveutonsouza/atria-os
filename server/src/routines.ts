import cron, { type ScheduledTask } from 'node-cron';
import type { FastifyInstance } from 'fastify';
import type { RoutineInfo } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, now, uid } from './db.ts';
import { findAgent } from './agents.ts';
import { enqueueRun } from './runs.ts';

// Rotinas: disparo por cron (sleep → wake → work → sleep) de
//  - um workflow (workflow_id), ou
//  - um agente + projeto + instrução simples.

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
}

// Executor de workflow injetado por workflows.ts (evita import circular).
type WorkflowRunner = (slug: string, opts: { routineId: string; origin: 'routine' | 'manual' }) => Promise<unknown> | unknown;
let workflowRunner: WorkflowRunner | null = null;
export function setWorkflowRunner(fn: WorkflowRunner) {
  workflowRunner = fn;
}

const tasks = new Map<string, ScheduledTask>();

function fire(r: RoutineRow, origin: 'routine' | 'manual' = 'routine') {
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
  tasks.set(r.id, cron.schedule(r.cron, () => fire(r), { timezone: config.timezone }));
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
}

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
  };
  db.prepare(
    `INSERT INTO routines(id, name, cron, agent_id, project, instruction, enabled, workflow_id, created_at)
     VALUES(@id, @name, @cron, @agent_id, @project, @instruction, @enabled, @workflow_id, @created_at)`,
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
  };
  db.prepare(
    `UPDATE routines SET name=@name, cron=@cron, agent_id=@agent_id, project=@project, instruction=@instruction, enabled=@enabled, workflow_id=@workflow_id WHERE id=@id`,
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
    };
  });
}

export function startRoutines() {
  for (const r of listRoutines()) {
    try {
      schedule(r);
    } catch (e) {
      console.error(`rotina ${r.name} ignorada:`, (e as Error).message);
    }
  }
}

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
