import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exclusão de workflows/missões: limpeza no banco e aprovação destrutiva da Yui.
// Banco e workspace temporários: o env precisa estar pronto antes de importar os módulos.
const root = mkdtempSync(join(tmpdir(), 'yui-del-'));
process.env.YUI_DATA_DIR = join(root, 'data');
process.env.YUI_WORKSPACE_DIR = join(root, 'ws');
process.env.YUI_SEED_DIR = join(root, 'seed');
mkdirSync(process.env.YUI_DATA_DIR, { recursive: true });
const wfDir = join(process.env.YUI_WORKSPACE_DIR, '.yui', 'workflows');
mkdirSync(wfDir, { recursive: true });

const { db, now } = await import('../src/db.ts');
const wf = await import('../src/workflows.ts');
const ms = await import('../src/missions.ts');
const { pendingApprovals, resolveApproval } = await import('../src/runs.ts');
const { brainExtensions } = await import('../src/extensions.ts');

// As tools de workflow são registradas em register(app): um app falso que ignora as rotas basta.
const fakeApp = new Proxy({}, { get: () => () => fakeApp });
wf.register(fakeApp as never);

const seed = new URL('../../workspace-seed/.yui/workflows/post-instagram.md', import.meta.url).pathname;
const callTool = (name: string, args: Record<string, unknown>) => {
  for (const e of brainExtensions()) {
    const r = e.run(name, args, { dryRun: false });
    if (r) return r as Promise<Record<string, unknown>>;
  }
  throw new Error(`tool ${name} não registrada`);
};
const addRun = (id: string, cols: Record<string, string>) =>
  db.prepare(`INSERT INTO runs(id, agent_id, instruction, task, state, created_at, ${Object.keys(cols).join(', ')}) VALUES(?, 'dev', 'x', 'x', 'done', ?, ${Object.keys(cols).map(() => '?').join(', ')})`).run(id, now(), ...Object.values(cols));
const addMission = (id: string, status: string) =>
  db.prepare('INSERT INTO missions(id, title, goal, status, plan_json, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(id, `Missão ${id}`, 'objetivo', status, '[]', now());
const tick = () => new Promise((r) => setTimeout(r, 20));

test('deleteWorkflow apaga arquivo, histórico e solta os runs filhos', () => {
  copyFileSync(seed, join(wfDir, 'post-instagram.md'));
  db.prepare(`INSERT INTO workflow_runs(id, workflow, status, started_at) VALUES('wr1', 'post-instagram', 'done', ?)`).run(now());
  addRun('r1', { workflow_run_id: 'wr1' });
  assert.equal(wf.deleteWorkflow('post-instagram'), true);
  assert.equal(existsSync(join(wfDir, 'post-instagram.md')), false);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM workflow_runs WHERE workflow = 'post-instagram'`).get() as { n: number }).n, 0);
  assert.equal((db.prepare(`SELECT workflow_run_id AS w FROM runs WHERE id = 'r1'`).get() as { w: string | null }).w, null);
  assert.equal(wf.deleteWorkflow('post-instagram'), false);
});

test('deleteMission apaga a missão e solta os runs das etapas', () => {
  addMission('m1', 'done');
  addRun('r2', { mission_id: 'm1', step_id: 's1' });
  assert.equal(ms.deleteMission('m1'), true);
  assert.equal(ms.getMission('m1'), null);
  assert.equal((db.prepare(`SELECT mission_id AS m FROM runs WHERE id = 'r2'`).get() as { m: string | null }).m, null);
  assert.equal(ms.deleteMission('m1'), false);
});

test('delete_workflow da Yui: nada some sem aprovação; rejeitar mantém, aprovar exclui', async () => {
  copyFileSync(seed, join(wfDir, 'post-instagram.md'));
  const r = await callTool('delete_workflow', { slug: 'post-instagram' });
  assert.equal(r.status, 'aguardando_aprovacao');
  let ap = pendingApprovals().find((a) => a.runId === 'delete:workflow:post-instagram');
  assert.ok(ap);
  assert.equal(ap.kind, 'destructive');
  assert.ok(existsSync(join(wfDir, 'post-instagram.md')));
  resolveApproval(ap.id, false);
  await tick();
  assert.ok(existsSync(join(wfDir, 'post-instagram.md')));

  await callTool('delete_workflow', { slug: 'post-instagram' });
  ap = pendingApprovals().find((a) => a.runId === 'delete:workflow:post-instagram');
  assert.ok(ap);
  resolveApproval(ap.id, true);
  await tick();
  assert.equal(existsSync(join(wfDir, 'post-instagram.md')), false);
});

test('delete_mission da Yui: exclui só depois de aprovado', async () => {
  addMission('m2', 'done');
  const r = await callTool('delete_mission', { mission_id: 'm2' });
  assert.equal(r.status, 'aguardando_aprovacao');
  const ap = pendingApprovals().find((a) => a.runId === 'delete:mission:m2');
  assert.ok(ap);
  assert.equal(ap.kind, 'destructive');
  assert.ok(ms.getMission('m2'));
  resolveApproval(ap.id, true);
  await tick();
  assert.equal(ms.getMission('m2'), null);
  assert.equal((await callTool('delete_mission', { mission_id: 'nao-existe' })).ok, false);
});
