import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Updater, envGet, envSet, type Exec, type ExecResult } from '../src/updater.ts';
import { createApi } from '../src/server.ts';

// Executor falso: registra cada comando e responde conforme o cenário.
// `health(tag)` diz o estado do container atria quando ele roda a tag; `fail` faz um comando falhar;
// `stack` são os arquivos em /app/stack da imagem atria-updater (caminho → conteúdo; ausente = imagem sem eles).
interface Scenario { health?: (tag: string | null) => string; fail?: (line: string) => boolean; updaterChanged?: boolean; gate?: Promise<void>; stack?: Record<string, string> }
function fake(dir: string, sc: Scenario = {}) {
  const calls: string[] = [];
  const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' });
  const exec: Exec = async (cmd, args, opts) => {
    const line = [cmd, ...args].join(' ');
    calls.push(opts?.input ? `${line} <stdin>` : line);
    if (sc.gate && args.includes('pull')) await sc.gate;
    if (sc.fail?.(line)) return { code: 1, stdout: '', stderr: 'erro falso' };
    const tag = envGet(readFileSync(join(dir, '.env'), 'utf8'), 'ATRIA_TAG');
    if (args[0] === 'inspect' && args.includes('test-atria-1')) {
      const t = tag ?? 'latest';
      return ok(`ghcr.io/eliveutonsouza/atria-os:${t}|${(sc.health ?? (() => 'healthy'))(tag)}\n`);
    }
    if (args[0] === 'create') return ok('cid-stack\n');
    if (args[0] === 'cp') {
      const dest = args[args.length - 1];
      for (const [rel, body] of Object.entries(sc.stack ?? {})) {
        mkdirSync(dirname(join(dest, rel)), { recursive: true });
        writeFileSync(join(dest, rel), body);
      }
      return ok();
    }
    if (args.includes('config')) return ok(JSON.stringify({ services: { 'atria-updater': { image: `ghcr.io/eliveutonsouza/atria-updater:${tag}` } } }));
    if (args.includes('ps')) return ok('cid123\n');
    if (args[0] === 'inspect') return ok('sha256:old\n');
    if (args[0] === 'image') return ok(sc.updaterChanged ? 'sha256:new\n' : 'sha256:old\n');
    return ok();
  };
  return { exec, calls };
}

function setup(sc: Scenario = {}, env = 'ATRIA_DOMAIN=x.example.com\nATRIA_TAG=v1.0.0\nGHCR_USER=bot\nGHCR_TOKEN=tok-falso\n', files: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'atria-upd-'));
  writeFileSync(join(dir, '.env'), env);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  const f = fake(dir, sc);
  let t = Date.parse('2026-10-09T12:00:00Z');
  const u = new Updater({
    stackDir: dir, project: 'test', statePath: join(dir, 'state', 'updater.json'), version: 'v1.0.0', exec: f.exec,
    healthTimeoutMs: 10_000, pollMs: 1000, sleep: async (ms) => { t += ms; }, now: () => new Date(t), log: () => {},
  });
  return { dir, u, calls: f.calls, tag: () => envGet(readFileSync(join(dir, '.env'), 'utf8'), 'ATRIA_TAG') };
}
const compact = (calls: string[], dir: string) => calls.map((c) => c.replace(`-p test --project-directory ${dir} `, ''));

test('envSet troca, acrescenta e remove sem mexer no resto', () => {
  assert.equal(envSet('A=1\nATRIA_TAG=v1.0.0\nB=2\n', 'ATRIA_TAG', 'v1.1.0'), 'A=1\nATRIA_TAG=v1.1.0\nB=2\n');
  assert.equal(envSet('A=1\n', 'ATRIA_TAG', 'v1.1.0'), 'A=1\nATRIA_TAG=v1.1.0\n');
  assert.equal(envSet('A=1\nATRIA_TAG=v1\nB=2', 'ATRIA_TAG', null), 'A=1\nB=2');
  assert.equal(envGet("X='a b'\n", 'X'), 'a b');
});

test('sequência ok: login, grava a tag, pull, up, saudável → done', async () => {
  const { dir, u, calls, tag } = setup();
  assert.equal(u.start({ tag: 'v1.1.0', commandId: 'c1', jobId: 'j1' }), 'accepted');
  assert.equal(u.status().status, 'busy');
  await u.running;
  assert.equal(tag(), 'v1.1.0');
  const s = u.status();
  assert.equal(s.status, 'ready');
  assert.equal(s.tag, 'v1.1.0');
  assert.equal(s.previousTag, 'v1.0.0');
  assert.equal(s.job?.result, 'done');
  assert.equal(s.job?.fromTag, 'v1.0.0');
  assert.equal(s.job?.reported, false);
  assert.deepEqual(compact(calls, dir).slice(0, 3), [
    'docker login ghcr.io -u bot --password-stdin <stdin>',
    'docker pull -q ghcr.io/eliveutonsouza/atria-updater:v1.1.0',
    'docker create ghcr.io/eliveutonsouza/atria-updater:v1.1.0',
  ]);
  assert.match(compact(calls, dir)[3], /^docker cp -q cid-stack:\/app\/stack\/\. /);
  assert.deepEqual(compact(calls, dir).slice(4, 8), [
    'docker rm cid-stack',
    'docker compose pull atria atria-code atria-browser',
    'docker compose up -d atria atria-code atria-browser',
    "docker inspect -f {{.Config.Image}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} test-atria-1",
  ]);
  // imagem do atualizador igual: sem container auxiliar
  assert.ok(!calls.some((c) => c.startsWith('docker run')));
  // estado persistido e ack
  const saved = JSON.parse(readFileSync(join(dir, 'state', 'updater.json'), 'utf8'));
  assert.equal(saved.job.result, 'done');
  assert.equal(u.ack('outro'), false);
  assert.equal(u.ack('c1'), true);
  assert.equal(u.status().job?.reported, true);
});

test('health falha → volta para a tag anterior → rolled_back', async () => {
  const { u, calls, tag } = setup({ health: (t) => (t === 'v1.1.0' ? 'starting' : 'healthy') });
  u.start({ tag: 'v1.1.0', commandId: 'c2', jobId: 'j2' });
  await u.running;
  assert.equal(tag(), 'v1.0.0');
  const s = u.status();
  assert.equal(s.job?.result, 'rolled_back');
  assert.match(s.job?.error ?? '', /não ficou saudável em 10 s/);
  assert.equal(s.status, 'ready');
  assert.equal(calls.filter((c) => c.includes(' up -d atria atria-code atria-browser')).length, 2);
});

test('unhealthy encerra a espera antes do tempo e reverte', async () => {
  const { u, calls } = setup({ health: (t) => (t === 'v1.1.0' ? 'unhealthy' : 'healthy') });
  u.start({ tag: 'v1.1.0', commandId: 'c3', jobId: 'j3' });
  await u.running;
  assert.equal(u.status().job?.result, 'rolled_back');
  assert.match(u.status().job?.error ?? '', /unhealthy/);
  assert.equal(calls.filter((c) => c.includes('test-atria-1')).length, 2);
});

test('pull da tag nova falha → rollback sem esperar health', async () => {
  const { u, tag } = setup({ fail: (l) => l.includes('pull') && readFileSync(join(u.opts.stackDir, '.env'), 'utf8').includes('v9.9.9') });
  u.start({ tag: 'v9.9.9', commandId: 'c4', jobId: 'j4' });
  await u.running;
  assert.equal(tag(), 'v1.0.0');
  assert.equal(u.status().job?.result, 'rolled_back');
  assert.match(u.status().job?.error ?? '', /pull/);
});

test('rollback também não sobe → failed e status error', async () => {
  const { u, tag } = setup({ health: () => 'unhealthy' });
  u.start({ tag: 'v1.1.0', commandId: 'c5', jobId: 'j5' });
  await u.running;
  assert.equal(tag(), 'v1.0.0');
  assert.equal(u.status().job?.result, 'failed');
  assert.equal(u.status().status, 'error');
});

test('sem ATRIA_TAG antes: rollback remove a linha (volta ao padrão latest)', async () => {
  const { u, tag } = setup({ health: (t) => (t === 'v1.1.0' ? 'unhealthy' : 'healthy') }, 'A=1\n');
  u.start({ tag: 'v1.1.0', commandId: 'c6', jobId: 'j6' });
  await u.running;
  assert.equal(tag(), null);
  assert.equal(u.status().job?.result, 'rolled_back');
});

test('imagem do atualizador mudou → container auxiliar recria o serviço', async () => {
  const { u, calls } = setup({ updaterChanged: true });
  u.start({ tag: 'v1.1.0', commandId: 'c7', jobId: 'j7' });
  await u.running;
  assert.equal(u.status().job?.result, 'done');
  const run = calls.find((c) => c.startsWith('docker run'));
  assert.ok(run, 'container auxiliar');
  assert.match(run!, /ghcr\.io\/eliveutonsouza\/atria-updater:v1\.1\.0/);
  assert.match(run!, /up -d atria-updater/);
});

const STACK_ANTES = { 'docker-compose.yml': 'compose v1.0.0', 'browser/old.sh': 'velho', 'meu-override.yml': 'do usuário' };
const STACK_NOVA = { 'docker-compose.yml': 'compose v1.1.0', 'Caddyfile': 'caddy novo', 'browser/entrypoint.sh': 'novo', '.env': 'NUNCA=1' };
const ler = (dir: string, rel: string) => (existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), 'utf8') : null);

test('update troca os arquivos do compose pelos da imagem do atualizador da tag', async () => {
  const { dir, u, calls } = setup({ stack: STACK_NOVA }, undefined, STACK_ANTES);
  u.start({ tag: 'v1.1.0', commandId: 's1', jobId: 's1' });
  await u.running;
  assert.equal(u.status().job?.result, 'done');
  assert.equal(ler(dir, 'docker-compose.yml'), 'compose v1.1.0');
  assert.equal(ler(dir, 'Caddyfile'), 'caddy novo');
  assert.equal(ler(dir, 'browser/entrypoint.sh'), 'novo');
  assert.equal(ler(dir, 'browser/old.sh'), null); // pasta trocada inteira
  assert.equal(ler(dir, 'meu-override.yml'), 'do usuário'); // o que a imagem não traz fica
  assert.match(ler(dir, '.env') ?? '', /ATRIA_TAG=v1\.1\.0/); // .env nunca vem da imagem
  // compose novo validado antes do pull
  const c = compact(calls, dir);
  assert.ok(c.indexOf('docker compose config -q') < c.indexOf('docker compose pull atria atria-code atria-browser'));
});

test('rollback restaura compose e arquivos anteriores junto com a tag', async () => {
  const { dir, u, tag } = setup({ stack: STACK_NOVA, health: (t) => (t === 'v1.1.0' ? 'unhealthy' : 'healthy') }, undefined, STACK_ANTES);
  u.start({ tag: 'v1.1.0', commandId: 's2', jobId: 's2' });
  await u.running;
  assert.equal(u.status().job?.result, 'rolled_back');
  assert.equal(tag(), 'v1.0.0');
  assert.equal(ler(dir, 'docker-compose.yml'), 'compose v1.0.0');
  assert.equal(ler(dir, 'browser/old.sh'), 'velho');
  assert.equal(ler(dir, 'browser/entrypoint.sh'), null);
  assert.equal(ler(dir, 'Caddyfile'), null); // acrescentado pela versão nova → sai
  assert.equal(ler(dir, 'meu-override.yml'), 'do usuário');
});

test('compose novo inválido → não sobe, restaura e volta', async () => {
  const { dir, u, calls } = setup({ stack: STACK_NOVA, fail: (l) => l.endsWith('config -q') }, undefined, STACK_ANTES);
  u.start({ tag: 'v1.1.0', commandId: 's3', jobId: 's3' });
  await u.running;
  assert.equal(u.status().job?.result, 'rolled_back');
  assert.match(u.status().job?.error ?? '', /compose da versão nova inválido/);
  assert.equal(ler(dir, 'docker-compose.yml'), 'compose v1.0.0');
  assert.equal(calls.filter((c) => c.includes(' up -d atria ')).length, 1); // só o da versão anterior
});

test('instalação a partir do código (.git): não mexe no compose', async () => {
  const { dir, u, calls } = setup({ stack: STACK_NOVA }, undefined, { ...STACK_ANTES, '.git/HEAD': 'ref: refs/heads/main' });
  u.start({ tag: 'v1.1.0', commandId: 's4', jobId: 's4' });
  await u.running;
  assert.equal(u.status().job?.result, 'done');
  assert.equal(ler(dir, 'docker-compose.yml'), 'compose v1.0.0');
  assert.ok(!calls.some((c) => c.includes('atria-updater:v1.1.0') && c.startsWith('docker pull')));
});

test('imagem da tag sem os arquivos do compose: mantém os atuais', async () => {
  const { dir, u } = setup({ stack: { 'leia-me.txt': 'x' } }, undefined, STACK_ANTES);
  u.start({ tag: 'v1.1.0', commandId: 's5', jobId: 's5' });
  await u.running;
  assert.equal(u.status().job?.result, 'done');
  assert.equal(ler(dir, 'docker-compose.yml'), 'compose v1.0.0');
  assert.equal(ler(dir, 'leia-me.txt'), null);
});

// Atualizador novo subindo numa instalação que um atualizador antigo levou até a versão dele.
function setupBoot(opts: { tag: string; version: string; own?: Record<string, string>; files?: Record<string, string>; fail?: (l: string) => boolean }) {
  const { dir } = setup({}, `ATRIA_TAG=${opts.tag}\n`, opts.files ?? STACK_ANTES);
  const own = mkdtempSync(join(tmpdir(), 'atria-own-'));
  for (const [rel, body] of Object.entries(opts.own ?? STACK_NOVA)) {
    mkdirSync(dirname(join(own, rel)), { recursive: true });
    writeFileSync(join(own, rel), body);
  }
  const f = fake(dir, { fail: opts.fail });
  const u = new Updater({ stackDir: dir, project: 'test', statePath: join(dir, 'state', 'updater.json'), version: opts.version, exec: f.exec, ownStackDir: own, log: () => {} });
  return { dir, u, calls: f.calls };
}

test('ao subir: tag = versão do atualizador e compose diferente → grava os arquivos e recria', async () => {
  const { dir, u, calls } = setupBoot({ tag: 'v1.1.0', version: 'v1.1.0' });
  assert.equal(await u.reconcileStack(), true);
  assert.equal(ler(dir, 'docker-compose.yml'), 'compose v1.1.0');
  assert.equal(ler(dir, 'browser/entrypoint.sh'), 'novo');
  assert.deepEqual(compact(calls, dir), [
    'docker compose config -q',
    'docker compose pull atria atria-code atria-browser',
    'docker compose up -d atria atria-code atria-browser',
  ]);
  assert.equal(await u.reconcileStack(), false); // já em dia
});

test('ao subir: não mexe com .git, com tag diferente da versão ou com versão dev', async () => {
  assert.equal(await setupBoot({ tag: 'v1.1.0', version: 'v1.1.0', files: { ...STACK_ANTES, '.git/HEAD': 'x' } }).u.reconcileStack(), false);
  assert.equal(await setupBoot({ tag: 'v1.0.0', version: 'v1.1.0' }).u.reconcileStack(), false);
  assert.equal(await setupBoot({ tag: 'v1.1.0', version: 'dev' }).u.reconcileStack(), false);
});

test('ao subir: compose inválido → volta os arquivos e sobe como estava', async () => {
  const { dir, u, calls } = setupBoot({ tag: 'v1.1.0', version: 'v1.1.0', fail: (l) => l.endsWith('config -q') });
  assert.equal(await u.reconcileStack(), true);
  assert.equal(ler(dir, 'docker-compose.yml'), 'compose v1.0.0');
  assert.equal(ler(dir, 'browser/old.sh'), 'velho');
  assert.ok(!calls.some((c) => c.includes(' pull ')));
});

test('ocupado e tag inválida', async () => {
  const { u } = setup();
  assert.equal(u.start({ tag: '1.1.0', commandId: 'c', jobId: 'j' }), 'invalid');
  assert.equal(u.start({ tag: 'v1.1.0; rm -rf /', commandId: 'c', jobId: 'j' }), 'invalid');
  assert.equal(u.start({ tag: 'v1.1.0', commandId: '', jobId: 'j' }), 'invalid');
  assert.equal(u.start({ tag: 'v1.1.0', commandId: 'c8', jobId: 'j8' }), 'accepted');
  assert.equal(u.start({ tag: 'v1.2.0', commandId: 'c9', jobId: 'j9' }), 'busy');
  await u.running;
});

test('job interrompido por reinício vira failed ao subir de novo', () => {
  const { dir } = setup();
  const statePath = join(dir, 'state', 'updater.json');
  mkdirSync(join(dir, 'state'));
  writeFileSync(statePath, JSON.stringify({ previousTag: 'v1.0.0', step: 'pulling', job: { commandId: 'c', jobId: 'j', tag: 'v1.1.0', fromTag: 'v1.0.0', startedAt: 'x', finishedAt: null, result: null, error: null, reported: false } }));
  const u2 = new Updater({ stackDir: dir, project: 'test', statePath, version: 'x', exec: fake(dir).exec, log: () => {} });
  assert.equal(u2.status().job?.result, 'failed');
  assert.equal(u2.status().step, null);
});

test('API: token, 400, 409, 202, status e ack', async () => {
  let release = () => {};
  const { u } = setup({ gate: new Promise<void>((r) => { release = r; }) });
  const srv = createApi(u, 'segredo');
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const call = (path: string, init: RequestInit = {}, token = 'segredo') =>
    fetch(base + path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  try {
    assert.equal((await fetch(base + '/healthz')).status, 200);
    assert.equal((await fetch(base + '/status')).status, 401);
    assert.equal((await call('/status', {}, 'errado')).status, 401);
    assert.equal((await call('/update', { method: 'POST', body: JSON.stringify({ tag: 'latest', commandId: 'c' }) })).status, 400);
    assert.equal((await call('/update', { method: 'POST', body: 'não é json' })).status, 400);
    const ok = await call('/update', { method: 'POST', body: JSON.stringify({ tag: 'v1.1.0', commandId: 'c10', jobId: 'j10' }) });
    assert.equal(ok.status, 202);
    assert.deepEqual(await ok.json(), { accepted: true });
    assert.equal((await call('/update', { method: 'POST', body: JSON.stringify({ tag: 'v1.2.0', commandId: 'c11' }) })).status, 409);
    assert.equal((await (await call('/status')).json()).status, 'busy');
    release();
    await u.running;
    const st = await (await call('/status')).json();
    assert.equal(st.status, 'ready');
    assert.equal(st.tag, 'v1.1.0');
    assert.equal(st.version, 'v1.0.0');
    assert.equal(st.job.result, 'done');
    assert.equal((await call('/ack', { method: 'POST', body: JSON.stringify({ commandId: 'c10' }) })).status, 200);
    assert.equal((await call('/ack', { method: 'POST', body: JSON.stringify({ commandId: 'nada' }) })).status, 404);
    assert.equal((await call('/nada')).status, 404);
  } finally {
    srv.close();
  }
});

test('API sem token configurado fica desligada', async () => {
  const { u } = setup();
  const srv = createApi(u, '');
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(base + '/status', { headers: { authorization: 'Bearer ' } })).status, 503);
  } finally {
    srv.close();
  }
});
