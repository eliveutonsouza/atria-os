import cron, { type ScheduledTask } from 'node-cron';
import { config } from './config.ts';
import { db, now, uid } from './db.ts';
import { findAgent } from './agents.ts';
import { enqueueRun } from './runs.ts';

// Rotinas: agente + projeto + instrução disparados por cron (sleep → wake → work → sleep).

interface RoutineRow {
  id: string; name: string; cron: string; agent_id: string; project: string | null; instruction: string; enabled: number;
}

const tasks = new Map<string, ScheduledTask>();

function schedule(r: RoutineRow) {
  tasks.get(r.id)?.stop();
  if (!r.enabled) return;
  const task = cron.schedule(
    r.cron,
    () => {
      try {
        enqueueRun({ agentId: r.agent_id, project: r.project, instruction: r.instruction, task: r.name, origin: 'routine', routineId: r.id });
      } catch (e) {
        console.error(`rotina ${r.name}:`, (e as Error).message);
      }
    },
    { timezone: config.timezone },
  );
  tasks.set(r.id, task);
}

export function createRoutine(input: { name: string; cron: string; agentId: string; project: string | null; instruction: string }) {
  if (!cron.validate(input.cron)) throw new Error(`cron inválido: ${input.cron}`);
  const agent = findAgent(input.agentId);
  if (!agent) throw new Error(`agente desconhecido: ${input.agentId}`);
  const row: RoutineRow = { id: uid(), name: input.name, cron: input.cron, agent_id: agent.id, project: input.project, instruction: input.instruction, enabled: 1 };
  db.prepare(`INSERT INTO routines(id, name, cron, agent_id, project, instruction, enabled, created_at) VALUES(@id, @name, @cron, @agent_id, @project, @instruction, @enabled, @created_at)`).run({ ...row, created_at: now() });
  schedule(row);
  return row;
}

export function listRoutines(): RoutineRow[] {
  return db.prepare('SELECT * FROM routines ORDER BY created_at').all() as RoutineRow[];
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
