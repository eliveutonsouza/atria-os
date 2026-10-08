import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Loja de skills: parse do skills.sh, instalação na plataforma e por agente (isolamento), escopo,
// remoção e a tool da Yui que só instala depois da aprovação. Rede simulada com um fetch falso.
const root = mkdtempSync(join(tmpdir(), 'atria-skills-'));
process.env.HOME = join(root, 'home');
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
process.env.PATH = ''; // sem `gh`: nada de token real nos testes
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });
const seedAgents = join(process.env.ATRIA_SEED_DIR, '.claude', 'agents');
mkdirSync(seedAgents, { recursive: true });
const realSeed = new URL('../../workspace-seed/.claude/agents/', import.meta.url).pathname;
for (const f of ['frontend.md', 'backend.md']) copyFileSync(join(realSeed, f), join(seedAgents, f));

const TREE = {
  sha: 'root1',
  tree: [
    { path: 'README.md', type: 'blob', sha: 'r', size: 10 },
    { path: 'skills', type: 'tree', sha: 's' },
    { path: 'skills/tdd', type: 'tree', sha: 'tdd-v1' },
    { path: 'skills/tdd/SKILL.md', type: 'blob', sha: 'a', size: 60 },
    { path: 'skills/tdd/refs/mocks.md', type: 'blob', sha: 'b', size: 5 },
    { path: 'skills/grill-me', type: 'tree', sha: 'g' },
    { path: 'skills/grill-me/SKILL.md', type: 'blob', sha: 'c', size: 40 },
  ],
};
const FILES: Record<string, string> = {
  'skills/tdd/SKILL.md': '---\nname: tdd\ndescription: Test-driven development.\n---\n# TDD\n',
  'skills/tdd/refs/mocks.md': 'mocks',
  'skills/grill-me/SKILL.md': '---\nname: grill-me\ndescription: Grill.\n---\n',
};
const DETAIL =
  '<meta name="description" content="Test-driven development. Use when &quot;red-green&quot;."/>' +
  '<span class="text-sm font-medium text-foreground truncate">Socket</span><span class="text-xs font-mono uppercase px-2 py-1 rounded bg-green-500/10 text-green-500">Pass</span>' +
  '<span class="text-sm font-medium text-foreground truncate">Snyk</span><span class="text-xs font-mono uppercase px-2 py-1 rounded bg-amber-500/10">Warn</span>';
let treeCalls = 0;
globalThis.fetch = (async (input: string | URL) => {
  const url = String(input);
  const ok = (body: string) => new Response(body, { status: 200 });
  if (url.startsWith('https://api.github.com/repos/mattpocock/skills/git/trees/')) {
    treeCalls++;
    return ok(JSON.stringify(TREE));
  }
  if (url.startsWith('https://api.github.com/')) return new Response('nf', { status: 404 });
  const raw = url.match(/^https:\/\/raw\.githubusercontent\.com\/mattpocock\/skills\/HEAD\/(.+)$/);
  if (raw) {
    const p = raw[1].split('/').map(decodeURIComponent).join('/');
    return p in FILES ? ok(FILES[p]) : new Response('nf', { status: 404 });
  }
  if (url.startsWith('https://www.skills.sh/mattpocock/skills/')) return ok(DETAIL);
  return new Response('nf', { status: 404 });
}) as typeof fetch;

const hub = await import('../src/skillsHub.ts');
const admin = await import('../src/agentsAdmin.ts');
const { agentOptions, brainExtensions, runPromptExtras } = await import('../src/extensions.ts');
const { pendingApprovals, resolveApproval } = await import('../src/runs.ts');

const fakeApp = new Proxy({}, { get: () => () => fakeApp });
admin.register(fakeApp as never);
hub.register(fakeApp as never);
const callTool = (name: string, args: Record<string, unknown>) => {
  for (const e of brainExtensions()) {
    const r = e.run(name, args, { dryRun: false });
    if (r) return r as Promise<Record<string, unknown>>;
  }
  throw new Error(`tool ${name} não registrada`);
};
const home = process.env.HOME!;
const pluginPaths = (agentId: string) => (agentOptions(agentId).plugins ?? []).map((p) => (p as { path: string }).path);

test('ranking do skills.sh: lê os objetos escapados do HTML e o total', () => {
  const html = 'All Time (1,235,569)…{\\"source\\":\\"vercel-labs/skills\\",\\"skillId\\":\\"find-skills\\",\\"name\\":\\"find-skills\\",\\"installs\\":3754035,\\"weeklyInstalls\\":[1,2,3],\\"isOfficial\\":true}{\\"source\\":\\"uizze.sh\\",\\"skillId\\":\\"ui-taste\\",\\"name\\":\\"ui-taste\\",\\"installs\\":470,\\"installsYesterday\\":2,\\"change\\":468}{\\"source\\":\\"vercel-labs/skills\\",\\"skillId\\":\\"find-skills\\",\\"name\\":\\"find-skills\\",\\"installs\\":1}';
  const r = hub.parseLeaderboard(html);
  assert.equal(r.total, 1235569);
  assert.equal(r.skills.length, 2);
  assert.deepEqual(r.skills[0], { source: 'vercel-labs/skills', skillId: 'find-skills', name: 'find-skills', installs: 3754035, weekly: [1, 2, 3], official: true });
  assert.equal(r.skills[1].change, 468);
});

test('ficha: descrição e auditorias', () => {
  const d = hub.parseDetailPage(DETAIL);
  assert.equal(d.description, 'Test-driven development. Use when "red-green".');
  assert.deepEqual(d.audits, [{ name: 'Socket', result: 'pass' }, { name: 'Snyk', result: 'warn' }]);
});

test('referência colada: skills.sh, GitHub e comando npx', () => {
  assert.deepEqual(hub.parseRef('https://skills.sh/mattpocock/skills/tdd'), { source: 'mattpocock/skills', skillId: 'tdd' });
  assert.deepEqual(hub.parseRef('npx skills add https://github.com/anthropics/skills --skill frontend-design'), { source: 'anthropics/skills', skillId: 'frontend-design' });
  assert.deepEqual(hub.parseRef('mattpocock/skills --skill grill-me'), { source: 'mattpocock/skills', skillId: 'grill-me' });
  assert.equal(hub.parseRef('qualquer coisa'), null);
});

test('origem e skill inválidas são recusadas', async () => {
  await assert.rejects(hub.installSkill({ source: '../etc', skillId: 'x', scope: 'platform' }), /origem inválida/);
  await assert.rejects(hub.installSkill({ source: 'open.feishu.cn', skillId: 'x', scope: 'platform' }), /origem inválida/);
  await assert.rejects(hub.installSkill({ source: 'mattpocock/skills', skillId: '../tdd', scope: 'platform' }), /skill inválida/);
  await assert.rejects(hub.installSkill({ source: 'mattpocock/skills', skillId: 'tdd', scope: 'agents', agents: ['ninguem'] }), /não existe/);
  assert.equal(hub.validName('..'), false);
});

test('instala só no Backend: o pacote vai para as execuções dele e de mais ninguém', async () => {
  const r = await hub.installSkill({ source: 'mattpocock/skills', skillId: 'tdd', scope: 'agents', agents: ['backend'] });
  assert.equal(r.name, 'tdd');
  assert.equal(r.treeSha, 'tdd-v1');
  assert.deepEqual(r.audits.map((a) => a.result), ['pass', 'warn']);
  const pack = join(home, '.atria', 'skill-packs', 'backend');
  assert.match(readFileSync(join(pack, 'skills', 'tdd', 'SKILL.md'), 'utf8'), /name: tdd/);
  assert.equal(readFileSync(join(pack, 'skills', 'tdd', 'refs', 'mocks.md'), 'utf8'), 'mocks');
  assert.equal(JSON.parse(readFileSync(join(pack, '.claude-plugin', 'plugin.json'), 'utf8')).name, 'atria-backend');
  assert.equal(existsSync(join(home, '.claude', 'skills', 'tdd')), false);
  assert.ok(pluginPaths('backend').includes(pack));
  assert.equal(pluginPaths('frontend').some((p) => p.includes('skill-packs')), false);
  assert.match(runPromptExtras({ runId: 'r', agentId: 'backend', project: null, display: null }), /atria-backend:tdd/);
  assert.doesNotMatch(runPromptExtras({ runId: 'r', agentId: 'frontend', project: null, display: null }), /atria-backend/);
});

test('muda o alcance para a plataforma e de volta para dois agentes', () => {
  hub.setScope('tdd', 'platform');
  assert.ok(existsSync(join(home, '.claude', 'skills', 'tdd', 'SKILL.md')));
  assert.equal(existsSync(join(home, '.atria', 'skill-packs', 'backend', 'skills', 'tdd')), false);
  hub.setScope('tdd', 'agents', ['backend', 'Frontend']);
  assert.equal(existsSync(join(home, '.claude', 'skills', 'tdd')), false);
  assert.deepEqual(hub.listInstalled()[0].agents, ['backend', 'frontend']);
  assert.ok(pluginPaths('frontend').some((p) => p.endsWith('skill-packs/frontend')));
});

test('remover de um agente mantém no outro; remover de vez apaga a cópia', () => {
  hub.uninstallSkill('tdd', 'frontend');
  assert.deepEqual(hub.listInstalled()[0].agents, ['backend']);
  assert.equal(existsSync(join(home, '.atria', 'skill-packs', 'frontend', 'skills', 'tdd')), false);
  hub.uninstallSkill('tdd');
  assert.equal(hub.listInstalled().length, 0);
  assert.equal(existsSync(join(home, '.atria', 'skills-lib', 'tdd')), false);
  assert.equal(existsSync(join(home, '.atria', 'skill-packs', 'backend', 'skills', 'tdd')), false);
});

test('atualização: detecta pasta alterada no GitHub', async () => {
  await hub.installSkill({ source: 'mattpocock/skills', skillId: 'grill-me', scope: 'platform' });
  assert.equal((await hub.checkUpdates())[0].updateAvailable, false);
  TREE.tree.find((t) => t.path === 'skills/grill-me')!.sha = 'g2';
  assert.equal((await hub.checkUpdates())[0].updateAvailable, true);
  hub.uninstallSkill('grill-me');
});

test('Yui: skill_instalar só instala depois da aprovação', async () => {
  const before = treeCalls;
  const r = await callTool('skill_instalar', { source: 'mattpocock/skills', skill: 'tdd', escopo: 'agentes', agentes: ['Backend'] });
  assert.equal(r.status, 'aguardando_aprovacao');
  let pending = pendingApprovals().find((a) => a.runId === 'skills:install:mattpocock/skills/tdd');
  for (let i = 0; !pending && i < 50; i++) {
    await new Promise((res) => setTimeout(res, 20));
    pending = pendingApprovals().find((a) => a.runId === 'skills:install:mattpocock/skills/tdd');
  }
  assert.ok(pending, 'aprovação criada');
  assert.equal(hub.listInstalled().length, 0);
  assert.equal(treeCalls, before, 'nada baixado antes de aprovar');
  resolveApproval(pending.id, true);
  for (let i = 0; !hub.listInstalled().length && i < 100; i++) await new Promise((res) => setTimeout(res, 20));
  assert.deepEqual(hub.listInstalled().map((s) => [s.name, s.agents]), [['tdd', ['backend']]]);
  const bad = await callTool('skill_instalar', { source: 'open.feishu.cn', skill: 'x', escopo: 'plataforma', agentes: [] });
  assert.equal(bad.ok, false);
});
