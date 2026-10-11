import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// F3 (v1.4.0): entregas registradas, nota 👍/👎 e checagens do fim da missão.
const root = mkdtempSync(join(tmpdir(), 'atria-f3-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });
const ws = process.env.ATRIA_WORKSPACE_DIR;
mkdirSync(join(ws, 'stoq'), { recursive: true });
writeFileSync(join(ws, 'stoq', 'atria.json'), '{"name":"Stoq"}');

const { db, now } = await import('../src/db.ts');
await import('../src/workflows.ts');
const runs = await import('../src/runs.ts');
const art = await import('../src/artifacts.ts');
const missions = await import('../src/missions.ts');

test('registrar entrega: só dentro do /workspace, atualiza pelo caminho', () => {
  const f = join(ws, 'stoq', 'proposta.pdf');
  writeFileSync(f, '%PDF-1.4 teste');
  const a = art.registerArtifact(f, { title: 'Proposta', project: 'stoq', runId: 'r1' });
  assert.ok(!('error' in a));
  const b = art.registerArtifact(f, { title: 'Proposta v2', project: 'stoq', runId: 'r1' });
  assert.ok(!('error' in b) && !('error' in a) && b.id === a.id);
  assert.equal(art.listArtifacts({ project: 'stoq' }).length, 1);
  assert.ok('error' in art.registerArtifact('/etc/passwd', { project: null, runId: null }));
  assert.ok('error' in art.registerArtifact(join(ws, 'stoq', 'nao-existe.pdf'), { project: null, runId: null }));
});

test('varredura do fim da execução: pasta do workflow, relatórios e imagens novas; ignora o antigo', () => {
  const started = new Date(Date.now() - 60_000).toISOString();
  db.prepare(`INSERT INTO workflow_runs(id, workflow, status, current, nodes, origin, started_at) VALUES('wfx', 'posts', 'running', NULL, '{}', 'manual', ?)`).run(started);
  const dir = runs.workflowRunDir(join(ws, 'stoq'), 'wfx');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'legendas.md'), '# legendas');
  writeFileSync(join(ws, 'stoq', 'tela.png'), 'png');
  writeFileSync(join(ws, 'stoq', 'velho.png'), 'png');
  const old = new Date(Date.now() - 3600_000);
  utimesSync(join(ws, 'stoq', 'velho.png'), old, old);
  writeFileSync(join(ws, 'stoq', 'codigo.ts'), 'x'); // código novo na raiz não é entrega
  const found = art.scanRun({ id: 'run-wf', project: 'stoq', workflow_run_id: 'wfx', started_at: started });
  const names = found.map((e) => e.title).sort();
  assert.deepEqual(names, ['legendas.md', 'tela.png']);
});

test('nota 👍/👎: grava, emite "rated" e limpa com 0', () => {
  db.prepare(`INSERT INTO runs(id, agent_id, project, instruction, task, state, created_at) VALUES('rt1', 'backend', NULL, 'x', 'Relatório', 'done', ?)`).run(now());
  let rated = 0;
  runs.runBus.on('rated', () => rated++);
  assert.equal(runs.rateRun('rt1', -1)?.rating, -1);
  assert.equal(rated, 1);
  assert.equal(runs.rateRun('rt1', 0)?.rating, null);
  assert.equal(runs.rateRun('nao-existe', 1), null);
});

test('checagens do fim da missão: vazio, falha no texto e arquivo prometido sem entrega', () => {
  db.prepare(`INSERT INTO runs(id, agent_id, project, instruction, task, state, created_at) VALUES('m1', 'backend', NULL, 'x', 'x', 'done', ?)`).run(now());
  db.prepare(`INSERT INTO runs(id, agent_id, project, instruction, task, state, created_at) VALUES('m2', 'backend', NULL, 'x', 'x', 'done', ?)`).run(now());
  const step = (id: string, instruction: string, result: string | null, runId: string | null) => ({ id, title: `Etapa ${id}`, agentId: 'backend', agent: 'Backend', instruction, dependsOn: [], risky: false, display: null, status: 'done' as const, runId, result });
  const w = missions.missionWarnings({
    steps: [
      step('1', 'pesquisa', '', null),
      step('2', 'publica', 'Não consegui acessar o painel.', null),
      step('3', 'gere um PDF da proposta', 'Pronto, PDF gerado.', 'm1'),
      step('4', 'escreva o texto', 'Texto ok.', 'm2'),
    ],
  });
  assert.equal(w.length, 3);
  assert.match(w[0], /sem resultado/);
  assert.match(w[1], /falha/);
  assert.match(w[2], /nenhuma entrega/);
});

test('lista de entregas: arquivo apagado sai do índice e não esconde os outros no limite', async () => {
  const { rmSync } = await import('node:fs');
  const a = join(ws, 'stoq', 'velha.md');
  const b = join(ws, 'stoq', 'nova.md');
  writeFileSync(a, 'a');
  writeFileSync(b, 'b');
  art.registerArtifact(a, { project: 'stoq', runId: null });
  await new Promise((r) => setTimeout(r, 5));
  art.registerArtifact(b, { project: 'stoq', runId: null });
  rmSync(b);
  const one = art.listArtifacts({ limit: 1 });
  assert.equal(one.length, 1);
  assert.notEqual(one[0].path, b);
});
