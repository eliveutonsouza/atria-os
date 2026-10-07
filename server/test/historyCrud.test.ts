import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Históricos (execuções, conversa, aprovações, inbox) e CRUD local de projetos.
// Banco e workspace temporários: o env precisa estar pronto antes de importar os módulos.
const root = mkdtempSync(join(tmpdir(), 'atria-hist-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });
mkdirSync(process.env.ATRIA_WORKSPACE_DIR, { recursive: true });

const { db, now } = await import('../src/db.ts');
const runs = await import('../src/runs.ts');
const hist = await import('../src/historyApi.ts');
const proj = await import('../src/projects.ts');

const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
const addRun = (id: string, state: string, at: string, project: string | null = null) => {
  db.prepare(`INSERT INTO runs(id, agent_id, project, instruction, task, state, created_at, finished_at) VALUES(?, 'dev', ?, 'x', ?, ?, ?, ?)`).run(id, project, `tarefa ${id}`, state, at, state === 'queued' ? null : at);
  db.prepare(`INSERT INTO run_events(run_id, t, kind, text) VALUES(?, ?, 'system', 'evento')`).run(id, at);
};
const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;

test('deleteRun apaga a execução e os eventos', async () => {
  addRun('d1', 'done', now());
  assert.equal(await runs.deleteRun('d1'), true);
  assert.equal(runs.getRun('d1'), null);
  assert.equal(count(`SELECT COUNT(*) AS n FROM run_events WHERE run_id = 'd1'`), 0);
  assert.equal(await runs.deleteRun('d1'), false);
});

test('deleteRun cancela uma execução na fila antes de apagar', async () => {
  // fila parada: sem pump, a run fica 'queued'
  addRun('q0', 'queued', now());
  assert.equal(await runs.deleteRun('q0'), true);
  assert.equal(runs.getRun('q0'), null);
});

test('purgeRuns apaga só terminadas antigas; ativas ficam', () => {
  addRun('old-done', 'done', daysAgo(40));
  addRun('old-failed', 'failed', daysAgo(40));
  addRun('old-queued', 'queued', daysAgo(40));
  addRun('old-waiting', 'waiting_approval', daysAgo(40));
  addRun('new-done', 'done', daysAgo(2));
  const n = runs.purgeRuns(30);
  assert.equal(n, 2);
  assert.equal(runs.getRun('old-done'), null);
  assert.equal(runs.getRun('old-failed'), null);
  assert.ok(runs.getRun('old-queued'));
  assert.ok(runs.getRun('old-waiting'));
  assert.ok(runs.getRun('new-done'));
  assert.equal(count(`SELECT COUNT(*) AS n FROM run_events WHERE run_id IN ('old-done','old-failed')`), 0);
  db.prepare(`DELETE FROM runs WHERE id IN ('old-queued','old-waiting')`).run();
});

test('listRunsPage pagina por created_at', () => {
  addRun('p1', 'done', daysAgo(3));
  const first = runs.listRunsPage(null, 1);
  assert.equal(first.runs.length, 1);
  assert.ok(first.next);
  const next = runs.listRunsPage(first.next, 10);
  assert.ok(next.runs.length > 0);
  assert.ok(next.runs.every((r) => r.id !== first.runs[0].id));
});

test('dispensar uma falha tira do inbox; aprovações não são dispensáveis', () => {
  addRun('f1', 'failed', now());
  assert.ok(runs.inboxItems().some((i) => i.id === 'failed:f1'));
  assert.equal(runs.dismissInboxItem('failed:f1'), true);
  assert.ok(!runs.inboxItems().some((i) => i.id === 'failed:f1'));
  assert.equal(runs.dismissInboxItem('approval:x'), false);
});

test('histórico de aprovações traz só resolvidas, com kind e resolved_at', async () => {
  const p1 = runs.askApproval('own1', 'Deploy?', []);
  const p2 = runs.askApproval('own2', 'Excluir?', [], undefined, { kind: 'destructive' });
  const [a1, a2] = runs.pendingApprovals().filter((a) => a.runId === 'own1' || a.runId === 'own2');
  assert.equal(hist.approvalHistory().length, 0);
  runs.resolveApproval(a1.id, true);
  runs.resolveApproval(a2.id, false);
  await Promise.all([p1, p2]);
  const h = hist.approvalHistory();
  assert.equal(h.length, 2);
  const d = h.find((x) => x.id === a2.id)!;
  assert.equal(d.status, 'rejected');
  assert.equal(d.kind, 'destructive');
  assert.ok(d.resolvedAt);
  assert.equal(h.find((x) => x.id === a1.id)!.status, 'approved');
});

test('conversa: página com before e limpar', () => {
  for (let i = 0; i < 5; i++) db.prepare('INSERT INTO messages(id, who, text, source, at) VALUES(?, ?, ?, ?, ?)').run(`m${i}`, i % 2 ? 'yui' : 'user', `msg ${i}`, 'text', daysAgo(5 - i));
  const last = hist.messagesPage(null, 2);
  assert.deepEqual(last.map((m) => m.text), ['msg 3', 'msg 4']);
  const older = hist.messagesPage(last[0].at, 10);
  assert.deepEqual(older.map((m) => m.text), ['msg 0', 'msg 1', 'msg 2']);
  assert.equal(hist.clearMessages(), 5);
  assert.equal(hist.messagesPage(null, 10).length, 0);
});

test('projetos: config validada, gravada no atria.json e remoção bloqueada com run ativa', () => {
  const dir = join(process.env.ATRIA_WORKSPACE_DIR!, 'site-teste');
  mkdirSync(dir);
  writeFileSync(join(dir, 'atria.json'), JSON.stringify({ name: 'Site', repo: 'eu/site-teste', extra: 1 }));
  assert.ok('error' in proj.validateSettings({ healthUrl: 'ftp://x' }));
  assert.ok('error' in proj.validateSettings({ preview: '../etc' }));
  assert.ok('error' in proj.validateSettings({ approvalPatterns: 'npm' }));
  const v = proj.validateSettings({ healthUrl: 'https://site.test/health', container: 'site-api', preview: 'dist/', approvalPatterns: [' npm run deploy ', ''] });
  assert.ok('ok' in v);
  proj.writeProjectSettings('site-teste', v.ok);
  const saved = JSON.parse(readFileSync(join(dir, 'atria.json'), 'utf8'));
  assert.deepEqual(saved, { name: 'Site', repo: 'eu/site-teste', extra: 1, healthUrl: 'https://site.test/health', container: 'site-api', preview: 'dist', approvalPatterns: ['npm run deploy'] });

  assert.equal(proj.validGitUrl('https://user:tok@github.com/a/b.git'), null);
  assert.equal(proj.validGitUrl('git@github.com:a/b.git'), null);
  assert.equal(proj.slugFromUrl('https://github.com/Eu/Meu_Site.git'), 'meu-site');

  addRun('busy', 'running', now(), 'site-teste');
  assert.throws(() => proj.removeProject('site-teste'), /execuções ativas/);
  db.prepare(`UPDATE runs SET state = 'done' WHERE id = 'busy'`).run();
  assert.throws(() => proj.removeProject('site'), /não está no Atria OS/); // nunca por aproximação
  proj.removeProject('site-teste');
  assert.equal(existsSync(dir), false);
});
