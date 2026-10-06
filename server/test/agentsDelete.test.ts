import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Demitir agente: onde ele é usado, reatribuição ao substituto e o seed que não o traz de volta.
// Banco e workspace temporários: o env precisa estar pronto antes de importar os módulos.
const root = mkdtempSync(join(tmpdir(), 'yui-agdel-'));
process.env.YUI_DATA_DIR = join(root, 'data');
process.env.YUI_WORKSPACE_DIR = join(root, 'ws');
process.env.YUI_SEED_DIR = join(root, 'seed');
mkdirSync(process.env.YUI_DATA_DIR, { recursive: true });
const seedAgents = join(process.env.YUI_SEED_DIR, '.claude', 'agents');
mkdirSync(seedAgents, { recursive: true });
const realSeed = new URL('../../workspace-seed/.claude/agents/', import.meta.url).pathname;
for (const f of ['frontend.md', 'designer.md', 'backend.md']) copyFileSync(join(realSeed, f), join(seedAgents, f));

const { db, now } = await import('../src/db.ts');
const wf = await import('../src/workflows.ts');
const ms = await import('../src/missions.ts');
const rt = await import('../src/routines.ts');
const admin = await import('../src/agentsAdmin.ts');
const { pendingApprovals, resolveApproval } = await import('../src/runs.ts');
const { brainExtensions } = await import('../src/extensions.ts');

// register(app) semeia os agentes e registra as tools: um app falso que ignora as rotas basta.
const fakeApp = new Proxy({}, { get: () => () => fakeApp });
admin.register(fakeApp as never);

const agentFile = (id: string) => join(process.env.YUI_WORKSPACE_DIR!, '.claude', 'agents', `${id}.md`);
const callTool = (name: string, args: Record<string, unknown>) => {
  for (const e of brainExtensions()) {
    const r = e.run(name, args, { dryRun: false });
    if (r) return r as Promise<Record<string, unknown>>;
  }
  throw new Error(`tool ${name} não registrada`);
};
// Rotinas agendadas seguram o processo (node-cron): para tudo no fim.
after(() => {
  for (const r of rt.listRoutines()) rt.deleteRoutine(r.id);
});
const tick = () => new Promise((r) => setTimeout(r, 20));
const step = (id: string, agentId: string, status: string) => ({ id, title: `Etapa ${id}`, agentId, agent: agentId, instruction: 'x', dependsOn: [], risky: false, display: null, status, runId: null, result: null });

function scenario() {
  const r = rt.createRoutine({ name: 'Revisão de acessibilidade', cron: '0 9 * * 1', agentId: 'frontend', instruction: 'revise' });
  wf.saveWorkflow({
    def: {
      slug: 'landing',
      name: 'Landing para cliente',
      team: ['frontend', 'designer'],
      nodes: [
        { id: '1', type: 'start', title: 'Início', next: ['2'] },
        { id: '2', type: 'task', title: 'Layout', agent: 'frontend', instruction: 'faz', next: ['3'] },
        { id: '3', type: 'task', title: 'Arte', agent: 'designer', instruction: 'faz', next: ['4'] },
        { id: '4', type: 'task', title: 'Ajustes', agent: 'frontend', instruction: 'faz', next: ['5'] },
        { id: '5', type: 'end', title: 'Fim' },
      ],
    },
  });
  db.prepare('INSERT INTO missions(id, title, goal, status, plan_json, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(
    'm1', 'Landing Fisioforma', 'objetivo', 'running', JSON.stringify([step('1', 'frontend', 'done'), step('3', 'frontend', 'pending')]), now(),
  );
  // Missão encerrada não conta.
  db.prepare('INSERT INTO missions(id, title, goal, status, plan_json, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(
    'm2', 'Antiga', 'objetivo', 'done', JSON.stringify([step('1', 'frontend', 'done')]), now(),
  );
  return r.id;
}

test('agentUsage encontra rotina, passos do workflow e etapa de missão em aberto', () => {
  scenario();
  const usage = admin.agentUsage('frontend');
  assert.deepEqual(usage.map((u) => u.kind).sort(), ['mission', 'routine', 'workflow']);
  assert.equal(usage.find((u) => u.kind === 'workflow')?.detail, 'passos 2 e 4');
  assert.equal(usage.find((u) => u.kind === 'mission')?.detail, 'etapa 3 (na fila)');
  assert.equal(usage.find((u) => u.kind === 'routine')?.label, 'Revisão de acessibilidade · 0 9 * * 1');
  assert.deepEqual(admin.agentUsage('backend'), []);
});

test('demitir em uso sem substituto falha e não apaga nada', () => {
  const r = admin.deleteAgent('frontend', null);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.usage?.length === 3);
  assert.equal(admin.deleteAgent('frontend', 'frontend').ok, false);
  assert.equal(admin.deleteAgent('frontend', 'nao-existe').ok, false);
  assert.ok(existsSync(agentFile('frontend')));
});

test('demitir com substituto reatribui tudo, apaga o arquivo e o seed não volta', () => {
  const r = admin.deleteAgent('frontend', 'designer');
  assert.deepEqual(r, { ok: true, reassigned: 3 });
  assert.equal(existsSync(agentFile('frontend')), false);
  assert.ok(rt.listRoutines().every((x) => x.agent_id !== 'frontend'));
  assert.equal(rt.listRoutines()[0].agent_id, 'designer');
  const w = wf.loadWorkflow('landing')!;
  assert.deepEqual(w.nodes.filter((n) => n.type === 'task').map((n) => n.agent), ['designer', 'designer', 'designer']);
  assert.deepEqual(w.team, ['designer']);
  const m = ms.getMission('m1')!;
  assert.equal(m.steps[0].agentId, 'frontend'); // etapa concluída fica como estava
  assert.equal(m.steps[1].agentId, 'designer');
  assert.equal(ms.getMission('m2')!.steps[0].agentId, 'frontend');
  assert.deepEqual(admin.agentUsage('frontend'), []);
  const hist = readdirSync(join(process.env.YUI_WORKSPACE_DIR!, '.yui', 'agents-history'));
  assert.ok(hist.some((f) => f.startsWith('frontend-demitido-')));

  admin.seedMissingAgents();
  assert.equal(existsSync(agentFile('frontend')), false);
});

test('agente sem uso é demitido sem substituto', () => {
  assert.deepEqual(admin.deleteAgent('backend', null), { ok: true, reassigned: 0 });
  admin.seedMissingAgents();
  assert.equal(existsSync(agentFile('backend')), false);
});

test('demitir_agente da Yui: só exclui depois de aprovado', async () => {
  copyFileSync(join(realSeed, 'qa.md'), agentFile('qa'));
  const busy = await callTool('demitir_agente', { agente: 'designer', substituto: null });
  assert.equal(busy.ok, false);
  const r = await callTool('demitir_agente', { agente: 'qa', substituto: null });
  assert.equal(r.status, 'aguardando_aprovacao');
  let ap = pendingApprovals().find((a) => a.runId === 'delete:agent:qa');
  assert.ok(ap);
  assert.equal(ap.kind, 'destructive');
  resolveApproval(ap.id, false);
  await tick();
  assert.ok(existsSync(agentFile('qa')));

  await callTool('demitir_agente', { agente: 'qa', substituto: null });
  ap = pendingApprovals().find((a) => a.runId === 'delete:agent:qa');
  assert.ok(ap);
  resolveApproval(ap.id, true);
  await tick();
  assert.equal(existsSync(agentFile('qa')), false);
});
