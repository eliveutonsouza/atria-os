import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// F1 (v1.2.0): orçamento pelo % do plano, regras de aprovação salvas, objetivo do projeto e versões de agente.
const root = mkdtempSync(join(tmpdir(), 'atria-guard-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });
const seedAgents = join(process.env.ATRIA_SEED_DIR, '.claude', 'agents');
mkdirSync(seedAgents, { recursive: true });
const realSeed = new URL('../../workspace-seed/.claude/agents/', import.meta.url).pathname;
for (const f of ['frontend.md', 'backend.md']) copyFileSync(join(realSeed, f), join(seedAgents, f));

const { db, kvSet, now } = await import('../src/db.ts');
const rules = await import('../src/approvalRules.ts');
await import('../src/workflows.ts');
const budget = await import('../src/budget.ts');
const runs = await import('../src/runs.ts');
const settings = await import('../src/settings.ts');
const projects = await import('../src/projects.ts');
const admin = await import('../src/agentsAdmin.ts');
const rt = await import('../src/routines.ts');

const fakeApp = new Proxy({}, { get: () => () => fakeApp });
admin.register(fakeApp as never);
after(() => { for (const r of rt.listRoutines()) rt.deleteRoutine(r.id); });

test('ruleKey: só chaves estreitas (MCP exata ou comando + subcomando)', () => {
  assert.equal(rules.ruleKey('mcp', 'mcp__gmail__send_email'), 'mcp__gmail__send_email');
  assert.equal(rules.ruleKey('mcp', 'mcp__*'), null);
  assert.equal(rules.ruleKey('bash', 'git push origin main'), 'git push');
  assert.equal(rules.ruleKey('bash', 'git'), null);
  assert.equal(rules.ruleKey('bash', 'git push && rm -rf /'), null);
  assert.equal(rules.ruleKey('bash', 'sudo rm x'), null);
  assert.equal(rules.ruleKey('bash', 'npm --force install'), null);
  assert.equal(rules.ruleKey('bash', 'echo $(whoami)'), null);
});

test('regra salva vale só para o agente e o projeto dela; curinga é recusado', () => {
  assert.equal(rules.addRule({ kind: 'bash', key: '*', agentId: 'backend', project: 'stoq' }, 'allow'), null);
  const r = rules.addRule({ kind: 'bash', key: 'git push', agentId: 'backend', project: 'stoq' }, 'allow');
  assert.ok(r);
  assert.equal(rules.matchRule('bash', 'git push origin main', 'backend', 'stoq'), 'allow');
  assert.equal(rules.matchRule('bash', 'git push origin main', 'frontend', 'stoq'), null);
  assert.equal(rules.matchRule('bash', 'git push origin main', 'backend', null), null);
  assert.equal(rules.matchRule('bash', 'git push; rm -rf x', 'backend', 'stoq'), null); // composto nunca herda
  rules.addRule({ kind: 'bash', key: 'git push', agentId: 'backend', project: 'stoq' }, 'deny');
  assert.equal(rules.matchRule('bash', 'git push', 'backend', 'stoq'), 'deny');
  assert.equal(rules.listRules().length, 1);
});

test('lembrar decisão: aprovação com regra cria a regra; vermelha nunca', async () => {
  const pending = runs.askApproval('run-x', 'Dev quer publicar', [], undefined, { rule: { kind: 'mcp', key: 'mcp__gh__merge_pr', agentId: 'backend', project: null } });
  const ap = runs.pendingApprovals().find((a) => a.runId === 'run-x')!;
  assert.equal(ap.rule?.key, 'mcp__gh__merge_pr');
  runs.resolveApproval(ap.id, true, true);
  assert.equal(await pending, true);
  assert.equal(rules.matchRule('mcp', 'mcp__gh__merge_pr', 'backend', null), 'allow');
  const red = runs.askApproval('run-y', 'Excluir', [], undefined, { kind: 'destructive', rule: { kind: 'mcp', key: 'mcp__gh__delete_repo', agentId: 'backend', project: null } });
  const ap2 = runs.pendingApprovals().find((a) => a.runId === 'run-y')!;
  assert.equal(ap2.rule, undefined);
  runs.resolveApproval(ap2.id, true, true);
  await red;
  assert.equal(rules.matchRule('mcp', 'mcp__gh__delete_repo', 'backend', null), null);
});

test('overLimit: só janelas de 5 h/semana acima do limite e que ainda não reiniciaram', () => {
  const t = Date.parse('2026-10-11T12:00:00Z');
  const lim = [
    { kind: 'five_hour', label: '', pct: 96, resetsAt: '2026-10-11T14:00:00Z' },
    { kind: 'seven_day', label: '', pct: 50, resetsAt: '2026-10-15T00:00:00Z' },
    { kind: 'seven_day_opus', label: '', pct: 99, resetsAt: '2026-10-15T00:00:00Z' },
  ];
  assert.equal(budget.overLimit(95, lim, t)?.kind, 'five_hour');
  assert.equal(budget.overLimit(97, lim, t), null);
  assert.equal(budget.overLimit(95, lim, Date.parse('2026-10-11T15:00:00Z')), null); // já reiniciou
});

test('portão: rotina espera acima do limite; pedido manual passa', () => {
  const reset = new Date(Date.now() + 3600_000).toISOString();
  kvSet('claude_limits', JSON.stringify({ at: now(), limits: [{ kind: 'five_hour', label: '', pct: 97, resetsAt: reset }] }));
  const auto = { id: 'a', project: null, origin: 'routine', routine_id: 'r1', workflow_run_id: null };
  const manual = { id: 'b', project: null, origin: 'yui', routine_id: null, workflow_run_id: null };
  assert.match(budget.gate(auto) ?? '', /^Aguardando limite do Claude/);
  assert.equal(budget.gate(manual), null);
  assert.equal(runs.gateReason(manual), null);
  settings.setRaw('budget.stopPct', '99');
  assert.equal(budget.gate(auto), null);
  settings.setRaw('budget.stopPct', '95');
  kvSet('claude_limits', JSON.stringify({ at: now(), limits: [] }));
});

test('workflow disparado por rotina conta como automático', () => {
  db.prepare(`INSERT INTO workflow_runs(id, workflow, status, current, nodes, origin, started_at) VALUES('wr1', 'x', 'running', NULL, '{}', 'routine', ?)`).run(now());
  db.prepare(`INSERT INTO workflow_runs(id, workflow, status, current, nodes, origin, started_at) VALUES('wr2', 'x', 'running', NULL, '{}', 'manual', ?)`).run(now());
  assert.equal(runs.isAutomaticRun({ routine_id: null, workflow_run_id: 'wr1' }), true);
  assert.equal(runs.isAutomaticRun({ routine_id: null, workflow_run_id: 'wr2' }), false);
});

test('objetivo do projeto: valida e grava no atria.json', () => {
  const dir = join(process.env.ATRIA_WORKSPACE_DIR!, 'stoq');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'atria.json'), '{"name":"Stoq"}');
  const v = projects.validateSettings({ goal: 'Chegar a 50 clientes' });
  assert.ok('ok' in v);
  projects.writeProjectSettings('stoq', (v as { ok: object }).ok);
  assert.equal(projects.findProject('stoq')?.goal, 'Chegar a 50 clientes');
  assert.ok('error' in projects.validateSettings({ goal: 'x'.repeat(601) }));
});

test('versões do agente: edição guarda cópia; restaurar volta e guarda a atual', async () => {
  const file = join(process.env.ATRIA_WORKSPACE_DIR!, '.claude', 'agents', 'backend.md');
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, original.replace(/^name: .*$/m, 'name: Backend Editado'));
  // cópia como a edição faria
  const hist = join(process.env.ATRIA_WORKSPACE_DIR!, '.atria', 'agents-history');
  mkdirSync(hist, { recursive: true });
  writeFileSync(join(hist, 'backend-2026-10-01T10-00-00-000Z.md'), original);
  writeFileSync(join(hist, 'backend-copia-2026-10-01T10-00-00-000Z.md'), original); // de outro agente: não aparece
  const vs = admin.agentVersions('backend');
  assert.equal(vs.length, 1);
  assert.equal(vs[0].at, '2026-10-01T10:00:00.000Z');
  const r = admin.restoreAgentVersion('backend', vs[0].file);
  assert.ok(!('error' in r));
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.equal(admin.agentVersions('backend').length, 2); // a editada foi para o histórico
  assert.ok('error' in admin.restoreAgentVersion('backend', '../../etc/passwd'));
});

test('"rodar agora" de rotina é manual: não espera o limite', () => {
  const reset = new Date(Date.now() + 3600_000).toISOString();
  kvSet('claude_limits', JSON.stringify({ at: now(), limits: [{ kind: 'five_hour', label: '', pct: 99, resetsAt: reset }] }));
  assert.equal(budget.gate({ id: 'm', project: null, origin: 'manual', routine_id: 'r1', workflow_run_id: null }), null);
  assert.match(budget.gate({ id: 'a', project: null, origin: 'routine', routine_id: 'r1', workflow_run_id: null }) ?? '', /Aguardando limite/);
  kvSet('claude_limits', JSON.stringify({ at: now(), limits: [] }));
});

test('evento de limite sem porcentagem não apaga o valor lido', async () => {
  const cu = await import('../src/claudeUsage.ts');
  kvSet('claude_limits', JSON.stringify({ at: now(), limits: [{ kind: 'five_hour', label: 'five_hour', pct: 97, resetsAt: '2030-01-01T00:00:00.000Z' }] }));
  cu.saveRateLimit({ rateLimitType: 'five_hour', status: 'allowed', resetsAt: 1893456000 });
  const l = cu.claudeLimits()!.limits.find((x) => x.kind === 'five_hour')!;
  assert.equal(l.pct, 97);
  assert.equal(l.status, 'allowed');
  kvSet('claude_limits', JSON.stringify({ at: now(), limits: [] }));
});
