import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Rascunhos de missão: criação manual, edição de etapas (validação) e início.
// Banco e workspace temporários: o env precisa estar pronto antes de importar os módulos.
const root = mkdtempSync(join(tmpdir(), 'yui-mdraft-'));
process.env.YUI_DATA_DIR = join(root, 'data');
process.env.YUI_WORKSPACE_DIR = join(root, 'ws');
process.env.YUI_SEED_DIR = join(root, 'seed');
mkdirSync(process.env.YUI_DATA_DIR, { recursive: true });
// agentes do seed copiados para o workspace temporário
cpSync(new URL('../../workspace-seed/.claude/agents', import.meta.url).pathname, join(process.env.YUI_WORKSPACE_DIR, '.claude', 'agents'), { recursive: true });

const { db } = await import('../src/db.ts');
const ms = await import('../src/missions.ts');

// App falso que guarda os handlers das rotas para chamar direto.
type Handler = (req: { params?: unknown; body?: unknown }, reply: unknown) => unknown;
const routes = new Map<string, Handler>();
const fakeApp = new Proxy({}, { get: (_t, method: string) => (path: string, h: Handler) => routes.set(`${method.toUpperCase()} ${path}`, h) });
ms.register(fakeApp as never);

const call = async (route: string, params: Record<string, string> = {}, body: unknown = {}) => {
  const h = routes.get(route);
  assert.ok(h, `rota ${route} não registrada`);
  let code = 200;
  let sent: unknown;
  const reply = { code: (c: number) => ((code = c), reply), send: (b: unknown) => ((sent = b), reply) };
  const r = await h({ params, body }, reply);
  return { code, body: (r === reply ? sent : r) as Record<string, unknown> };
};

const runsOf = (id: string) => (db.prepare('SELECT COUNT(*) AS n FROM runs WHERE mission_id = ?').get(id) as { n: number }).n;
const step = (id: string, deps: string[] = [], extra: Record<string, unknown> = {}) => ({ id, title: `Etapa ${id}`, agentId: 'frontend', instruction: 'faça', dependsOn: deps, risky: false, display: null, ...extra });

test('POST manual cria rascunho sem etapas e sem runs', async () => {
  const r = await call('POST /api/missions', {}, { goal: 'Landing page da Fisioforma\ncom agendamento', project: null, details: 'tom acolhedor', approvalBefore: ['deploy', 'xx'], mode: 'manual' });
  assert.equal(r.code, 200);
  const m = r.body as unknown as { id: string; status: string; title: string; steps: unknown[]; details: string; approvalBefore: string[] };
  assert.equal(m.status, 'draft');
  assert.equal(m.title, 'Landing page da Fisioforma');
  assert.deepEqual(m.steps, []);
  assert.equal(m.details, 'tom acolhedor');
  assert.deepEqual(m.approvalBefore, ['deploy']);
  assert.equal(runsOf(m.id), 0);
  assert.equal((await call('POST /api/missions', {}, { goal: '  ', mode: 'manual' })).code, 400);
});

test('PUT valida etapas: válido salva; ciclo, agente inexistente e dependência solta → 400', async () => {
  const m = ms.createManualDraft('Objetivo', null);
  const ok = await call('PUT /api/missions/:id', { id: m.id }, { title: 'Novo título', steps: [step('s1'), step('s2', ['s1'], { agentId: 'qa' })] });
  assert.equal(ok.code, 200);
  const saved = ms.getMission(m.id)!;
  assert.equal(saved.title, 'Novo título');
  assert.equal(saved.steps.length, 2);
  assert.equal(saved.steps[1].agentId, 'qa');
  assert.ok(saved.steps[1].agent);
  assert.equal(saved.steps[1].status, 'pending');
  assert.equal(saved.steps[1].runId, null);

  const cycle = await call('PUT /api/missions/:id', { id: m.id }, { steps: [step('s1', ['s2']), step('s2', ['s1'])] });
  assert.equal(cycle.code, 400);
  assert.match(String(cycle.body.error), /circular/);
  const agent = await call('PUT /api/missions/:id', { id: m.id }, { steps: [step('s1', [], { agentId: 'nao-existe' })] });
  assert.equal(agent.code, 400);
  assert.match(String(agent.body.error), /agente desconhecido/);
  assert.equal((await call('PUT /api/missions/:id', { id: m.id }, { steps: [step('s1', ['s9'])] })).code, 400);
  assert.equal((await call('PUT /api/missions/:id', { id: m.id }, { steps: [step('s1'), step('s1')] })).code, 400);
  assert.equal(ms.getMission(m.id)!.steps.length, 2, 'erro não altera o rascunho');
  assert.equal((await call('PUT /api/missions/:id', { id: 'nao-existe' }, { steps: [] })).code, 404);
});

test('rascunho fica de fora de mission_control e do retomar; start sem etapas → 400', async () => {
  const m = ms.createManualDraft('Outro objetivo', null);
  assert.equal(ms.controlMission(m.id, 'retry')?.status, 'draft');
  assert.equal((await call('POST /api/missions/:id/start', { id: m.id })).code, 400);
});

test('start muda para running e avança (etapa que pede OK aguarda aprovação, sem run)', async () => {
  const m = ms.createManualDraft('Publicar site', null);
  ms.updateMission(m.id, { steps: [step('s1', [], { risky: true }), step('s2', ['s1'])] });
  const r = await call('POST /api/missions/:id/start', { id: m.id });
  assert.equal(r.code, 200);
  const cur = ms.getMission(m.id)!;
  assert.equal(cur.status, 'running');
  assert.equal(cur.steps[0].status, 'waiting_approval');
  assert.equal(cur.steps[1].status, 'pending');
  assert.equal(runsOf(m.id), 0);
  // já iniciada: não dá para iniciar de novo nem editar enquanto roda
  assert.equal((await call('POST /api/missions/:id/start', { id: m.id })).code, 409);
  assert.equal((await call('PUT /api/missions/:id', { id: m.id }, { steps: [] })).code, 409);

  // pausada: só etapas pendentes mudam
  ms.controlMission(m.id, 'pause');
  const locked = await call('PUT /api/missions/:id', { id: m.id }, { steps: [step('s1', [], { risky: true, title: 'Mudou' }), step('s2', ['s1'])] });
  assert.equal(locked.code, 409);
  const pend = await call('PUT /api/missions/:id', { id: m.id }, { steps: [step('s1', [], { risky: true }), step('s2', ['s1'], { title: 'Ajustada' }), step('s3', ['s2'])] });
  assert.equal(pend.code, 200);
  const after = ms.getMission(m.id)!;
  assert.equal(after.steps[0].status, 'waiting_approval');
  assert.equal(after.steps[1].title, 'Ajustada');
  assert.equal(after.steps.length, 3);
  assert.equal((await call('PUT /api/missions/:id', { id: m.id }, { goal: 'x' })).code, 409);
  ms.controlMission(m.id, 'cancel');
});
