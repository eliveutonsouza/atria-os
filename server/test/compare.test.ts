import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Refazer com outro modelo: a refeita aponta para o original, a cópia isolada (worktree) aplica ou descarta.
const root = mkdtempSync(join(tmpdir(), 'atria-cmp-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });
const ws = process.env.ATRIA_WORKSPACE_DIR;
mkdirSync(join(ws, '.claude', 'agents'), { recursive: true });
copyFileSync(new URL('../../workspace-seed/.claude/agents/backend.md', import.meta.url).pathname, join(ws, '.claude', 'agents', 'backend.md'));
const proj = join(ws, 'stoq');
mkdirSync(proj, { recursive: true });
const g = (...a: string[]) => execFileSync('git', ['-C', proj, ...a], { stdio: 'pipe' });
g('init', '-q');
g('config', 'user.email', 't@t');
g('config', 'user.name', 't');
writeFileSync(join(proj, 'a.txt'), 'um\n');
g('add', '.');
g('commit', '-qm', 'base');

const { db, now } = await import('../src/db.ts');
const runs = await import('../src/runs.ts');
runs.holdQueue(true); // nada roda de verdade no teste
const cmp = await import('../src/compare.ts');

test('refazer: só depois de terminar; aponta para o original e guarda o modelo', () => {
  db.prepare(`INSERT INTO runs(id, agent_id, project, instruction, task, state, created_at) VALUES('o1', 'backend', 'stoq', 'arruma', 'Arrumar', 'running', ?)`).run(now());
  assert.throws(() => cmp.startCompare('o1', 'claude-opus-5-5'), /terminar/);
  db.prepare(`UPDATE runs SET state = 'done' WHERE id = 'o1'`).run();
  assert.throws(() => cmp.startCompare('o1', 'x; rm -rf /'), /inválido/);
  const r = cmp.startCompare('o1', 'claude-opus-5-5');
  assert.equal(r.compareOf, 'o1');
  assert.match(r.task, /^↺ Arrumar/);
  const c = cmp.comparison(r.id)!;
  assert.equal(c.original.run.id, 'o1');
  assert.equal(c.refeitas.length, 1);
});

test('cópia isolada: aplicar leva as mudanças ao projeto; descartar apaga a cópia', () => {
  const wt = join(ws, '.atria', 'compare', 'r-apply');
  mkdirSync(join(ws, '.atria', 'compare'), { recursive: true });
  g('worktree', 'add', '--detach', wt, 'HEAD');
  writeFileSync(join(wt, 'a.txt'), 'um\ndois\n');
  writeFileSync(join(wt, 'novo.txt'), 'novo\n');
  db.prepare(`INSERT INTO runs(id, agent_id, project, instruction, task, state, created_at, compare_of, worktree) VALUES('r-apply', 'backend', 'stoq', 'x', 'x', 'done', ?, 'o1', ?)`).run(now(), wt);
  assert.match(cmp.comparison('r-apply')!.refeitas.find((s) => s.run.id === 'r-apply')!.diff ?? '', /2 files? changed/);
  const res = cmp.applyCompare('r-apply');
  assert.match(res.stat, /2 files? changed/);
  assert.equal(readFileSync(join(proj, 'a.txt'), 'utf8'), 'um\ndois\n');
  assert.ok(existsSync(join(proj, 'novo.txt')));
  assert.ok(!existsSync(wt));

  const wt2 = join(ws, '.atria', 'compare', 'r-drop');
  g('worktree', 'add', '--detach', wt2, 'HEAD');
  db.prepare(`INSERT INTO runs(id, agent_id, project, instruction, task, state, created_at, compare_of, worktree) VALUES('r-drop', 'backend', 'stoq', 'x', 'x', 'done', ?, 'o1', ?)`).run(now(), wt2);
  assert.ok(cmp.discardCompare('r-drop'));
  assert.ok(!existsSync(wt2));
});

test('aplicar com mudanças não salvas da original: recusa com a lista e substitui quando pedido', () => {
  writeFileSync(join(proj, 'NOTAS.md'), 'da original\n'); // não commitado
  const wt = join(ws, '.atria', 'compare', 'r-conf');
  g('worktree', 'add', '--detach', wt, 'HEAD');
  writeFileSync(join(wt, 'NOTAS.md'), 'da refeita\n');
  db.prepare(`INSERT INTO runs(id, agent_id, project, instruction, task, state, created_at, compare_of, worktree) VALUES('r-conf', 'backend', 'stoq', 'x', 'x', 'done', ?, 'o1', ?)`).run(now(), wt);
  assert.throws(() => cmp.applyCompare('r-conf'), (e: unknown) => e instanceof cmp.CompareConflict && (e as InstanceType<typeof cmp.CompareConflict>).conflicts.includes('NOTAS.md'));
  assert.equal(readFileSync(join(proj, 'NOTAS.md'), 'utf8'), 'da original\n');
  cmp.applyCompare('r-conf', true);
  assert.equal(readFileSync(join(proj, 'NOTAS.md'), 'utf8'), 'da refeita\n');
  assert.ok(!existsSync(wt));
});
