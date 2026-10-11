import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Multi-execução por projeto: vagas da fila, distribuição entre projetos e conversa separada por projeto.
const root = mkdtempSync(join(tmpdir(), 'atria-multi-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });
mkdirSync(process.env.ATRIA_WORKSPACE_DIR, { recursive: true });

const runs = await import('../src/runs.ts');
const brain = await import('../src/brain.ts');
const proj = await import('../src/projects.ts');
const { config } = await import('../src/config.ts');

test('padrão: 4 execuções ao mesmo tempo', () => {
  assert.equal(config.maxConcurrentRuns, 4);
});

test('hasFreeSlot: limite vale para quem trabalha; quem espera aprovação não ocupa vaga', () => {
  assert.equal(runs.hasFreeSlot(4, 3, 0), true);
  assert.equal(runs.hasFreeSlot(4, 4, 0), false);
  assert.equal(runs.hasFreeSlot(4, 4, 1), true); // 1 esperando aprovação libera a vaga
  assert.equal(runs.hasFreeSlot(4, 8, 6), false); // teto rígido de 2× protege a memória
});

test('pickNext: prefere o mais antigo de um projeto sem execução rodando', () => {
  const queued = [
    { id: 'a1', project: 'a' },
    { id: 'a2', project: 'a' },
    { id: 'b1', project: 'b' },
  ];
  assert.equal(runs.pickNext(queued, new Set(['a']))?.id, 'b1');
  assert.equal(runs.pickNext(queued, new Set())?.id, 'a1');
  assert.equal(runs.pickNext(queued, new Set(['a', 'b']))?.id, 'a1'); // todos ocupados: ordem de chegada
  assert.equal(runs.pickNext([], new Set()), undefined);
});

test('conversa separada por projeto (NULL = Geral)', () => {
  brain.saveMessage('user', 'oi no geral', 'text', null);
  brain.saveMessage('user', 'oi no stoq', 'text', 'stoq');
  brain.saveMessage('yui', 'resposta stoq', 'text', 'stoq');
  assert.deepEqual(brain.recentMessages(10, 'stoq').map((m) => m.text), ['oi no stoq', 'resposta stoq']);
  assert.deepEqual(brain.recentMessages(10, null).map((m) => m.text), ['oi no geral']);
});

test('projeto ativo: vazio vira null e segue o setActiveProject', () => {
  proj.setActiveProject(null);
  assert.equal(proj.activeProject(), null);
  proj.setActiveProject('stoq');
  assert.equal(proj.activeProject(), 'stoq');
  brain.saveMessage('user', 'padrão = projeto ativo', 'text');
  assert.equal(brain.recentMessages(10).at(-1)?.text, 'padrão = projeto ativo');
  proj.setActiveProject(null);
});

test('workflowRunDir: cada execução do mesmo workflow tem pasta própria e estável', async () => {
  await import('../src/workflows.ts');
  const { db } = await import('../src/db.ts');
  const ins = db.prepare(`INSERT INTO workflow_runs(id, workflow, status, current, nodes, started_at) VALUES(?, 'posts', 'running', NULL, '{}', ?)`);
  ins.run('wfaaaaaa1', '2026-10-11T17:30:00.000Z');
  ins.run('wfbbbbbb2', '2026-10-11T17:30:00.000Z');
  const a = runs.workflowRunDir('/w/proj', 'wfaaaaaa1');
  const b = runs.workflowRunDir('/w/proj', 'wfbbbbbb2');
  assert.notEqual(a, b);
  assert.equal(a, runs.workflowRunDir('/w/proj', 'wfaaaaaa1'));
  assert.match(a, /^\/w\/proj\/\.atria\/execucoes\/posts\/2026-10-11_\d\dh30-wfaaaa$/);
});
