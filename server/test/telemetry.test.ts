import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { RunInfo } from '../../shared/protocol.ts';
import type { TelemetrySnapshot } from '../../shared/telemetry.ts';

// Telemetria do Yui Monitor: privacidade do snapshot, chave da URL de saúde e o pulso (com backoff).
// Banco e workspace temporários; docker e navegador apontam para uma porta fechada (falha rápida).
const root = mkdtempSync(join(tmpdir(), 'yui-telemetry-'));
process.env.YUI_DATA_DIR = join(root, 'data');
process.env.YUI_WORKSPACE_DIR = join(root, 'ws');
process.env.YUI_SEED_DIR = join(root, 'seed');
process.env.YUI_DOCKER_API = 'http://127.0.0.1:9';
process.env.YUI_BROWSER_MCP = 'http://127.0.0.1:9/mcp';
process.env.YUI_PG_URL = '';
mkdirSync(process.env.YUI_DATA_DIR, { recursive: true });
mkdirSync(process.env.YUI_WORKSPACE_DIR, { recursive: true });

const { db, now } = await import('../src/db.ts');
const { emit } = await import('../src/bus.ts');
const { setRaw } = await import('../src/settings.ts');
const telemetry = await import('../src/telemetry.ts');

const KEY = 'ymk_teste_123';

// monitor falso: guarda o que chega e responde com o código da vez
const got: { auth: string | undefined; body: TelemetrySnapshot }[] = [];
let reply = 200;
const monitor = createServer((req: IncomingMessage, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url === '/api/ingest') got.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
    res.writeHead(reply).end();
  });
});
await new Promise<void>((r) => monitor.listen(0, '127.0.0.1', r));
const monitorUrl = `http://127.0.0.1:${(monitor.address() as AddressInfo).port}/`;
after(() => monitor.close());

const app = Fastify();
await app.register(rateLimit, { global: false });
telemetry.register(app);
await app.ready();
after(() => app.close());

test('snapshot não leva tarefa, resultado nem título de aprovação', async () => {
  db.prepare(`INSERT INTO runs(id, agent_id, instruction, task, state, result, created_at, finished_at, cost_usd) VALUES('s1', 'backend', 'SEGREDO-000', 'SEGREDO-123', 'failed', 'SEGREDO-456', ?, ?, 0.5)`).run(now(), now());
  db.prepare(`INSERT INTO approvals(id, run_id, title, rows, status, created_at) VALUES('a1', 's1', 'SEGREDO-789', '[]', 'pending', ?)`).run(now());
  const run = { id: 's1', agent: 'Backend', agentId: 'backend', project: null, task: 'SEGREDO-123', state: 'failed', progress: 100, currentOp: null, tools: [], steps: [], startedAt: null, finishedAt: now(), result: 'SEGREDO-456', sessionId: null, tokensIn: 0, tokensOut: 0, costUsd: 0.5 } as RunInfo;
  emit({ type: 'run.updated', run });
  emit({ type: 'approval.requested', approval: { id: 'a1', runId: 's1', title: 'SEGREDO-789', rows: [{ label: 'x', value: 'SEGREDO-abc' }], createdAt: now() } });
  console.error('falha técnica de teste\nsegunda linha');

  const snap = await telemetry.collectTelemetry({ events: 'recent' });
  const json = JSON.stringify(snap);
  assert.ok(!json.includes('SEGREDO'), json);
  assert.equal(snap.schema, 1);
  assert.equal(snap.runs.failed24h, 1);
  assert.equal(snap.work.approvalsPending, 1);
  assert.deepEqual(snap.byAgent.map((a) => [a.id, a.runs24h, a.failed24h, a.cost24h]), [['backend', 1, 1, 0.5]]);
  assert.ok(snap.events.some((e) => e.kind === 'run_failed' && e.agent === 'backend'));
  assert.ok(snap.events.some((e) => e.kind === 'approval_requested'));
  assert.ok(snap.events.some((e) => e.kind === 'boot'));
  assert.ok(snap.errors.lastHour >= 1);
  assert.equal(snap.errors.recent.at(-1)?.text, 'falha técnica de teste');
  assert.deepEqual(snap.containers, []); // docker fora: lista vazia, sem estourar
  assert.equal(snap.services.dockerProxy, false);
  assert.equal(snap.services.company, null);
  assert.match(snap.instance.id, /^[0-9a-f-]{36}$/);
});

test('URL de saúde: 503 sem chave, 401 com chave errada, 200 com a certa', async () => {
  const get = (auth?: string) => app.inject({ method: 'GET', url: '/api/telemetry', headers: auth ? { authorization: auth } : {} });
  assert.equal((await get(`Bearer ${KEY}`)).statusCode, 503);
  setRaw('monitor.url', monitorUrl);
  setRaw('monitor.key', KEY);
  setRaw('monitor.enabled', 'true');
  assert.equal((await get()).statusCode, 401);
  assert.equal((await get('Bearer errada')).statusCode, 401);
  const ok = await get(`Bearer ${KEY}`);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().schema, 1);
  setRaw('monitor.enabled', 'false');
  assert.equal((await get(`Bearer ${KEY}`)).statusCode, 503);
  setRaw('monitor.enabled', 'true');
});

test('monitor ligado sozinho com endereço e chave e sem escolha explícita', () => {
  setRaw('monitor.enabled', null);
  assert.equal(telemetry.monitorConfig().enabled, true);
  setRaw('monitor.enabled', 'true');
});

test('pulso: backoff em 500, eventos mantidos e limpos depois do 2xx', async () => {
  assert.deepEqual([1, 2, 3, 4, 9].map(telemetry.backoffMs), [30_000, 60_000, 120_000, 240_000, 300_000]);
  reply = 500;
  const r1 = await telemetry.sendPulse();
  assert.equal(r1.ok, false);
  assert.equal(r1.status, 500);
  assert.equal(telemetry.pulseState().fails, 1);
  const pending = telemetry.pulseState().pending;
  assert.ok(pending > 0);
  await telemetry.sendPulse();
  assert.equal(telemetry.pulseState().fails, 2);

  reply = 200;
  const r2 = await telemetry.sendPulse();
  assert.equal(r2.ok, true);
  assert.equal(telemetry.pulseState().fails, 0);
  assert.equal(telemetry.pulseState().pending, 0);
  const last = got.at(-1)!;
  assert.equal(last.auth, `Bearer ${KEY}`);
  assert.equal(last.body.events.length, pending);
  assert.ok(!JSON.stringify(last.body).includes('SEGREDO'));

  // só o que aconteceu depois do último envio vai no próximo pulso
  emit({ type: 'live.status', active: true, muted: false });
  await telemetry.sendPulse();
  assert.deepEqual(got.at(-1)!.body.events.map((e) => e.kind), ['voice_on']);
  const st = await app.inject({ method: 'GET', url: '/api/telemetry/status' });
  assert.equal(st.json().last.ok, true);
});

test('Testar conexão usa endereço e chave do formulário', async () => {
  const bad = await app.inject({ method: 'POST', url: '/api/telemetry/test', payload: { url: 'http://exemplo.com', key: 'x' } });
  assert.equal(bad.json().ok, false);
  assert.match(bad.json().error, /https/);
  const ok = await app.inject({ method: 'POST', url: '/api/telemetry/test', payload: { url: monitorUrl, key: 'ymk_outra' } });
  assert.equal(ok.json().ok, true);
  assert.equal(got.at(-1)!.auth, 'Bearer ymk_outra');
});
