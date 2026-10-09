import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { CommandResult } from '../../shared/telemetry.ts';

// Atualização remota (comando 'update'): recusa com a opção desligada, drenagem da fila antes de chamar
// o atualizador, e a reconciliação do resultado com um atualizador falso (servidor HTTP local).
const root = mkdtempSync(join(tmpdir(), 'atria-updates-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
process.env.ATRIA_DOCKER_API = 'http://127.0.0.1:9';
process.env.ATRIA_BROWSER_MCP = 'http://127.0.0.1:9/mcp';
process.env.ATRIA_PG_URL = '';
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });
mkdirSync(process.env.ATRIA_WORKSPACE_DIR, { recursive: true });

// atualizador falso
const UPD_TOKEN = 'tok-atualizador';
type Job = { commandId: string; jobId: string; tag: string; fromTag: string | null; startedAt: string; finishedAt: string | null; result: null | 'done' | 'rolled_back' | 'failed'; error: string | null; reported: boolean };
const upd = { status: 'ready' as 'ready' | 'busy' | 'error', tag: 'v1.0.0' as string | null, job: null as Job | null, updateCode: 202, calls: [] as { path: string; auth?: string; body: unknown }[] };
const updater = createServer((req: IncomingMessage, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    upd.calls.push({ path: `${req.method} ${req.url}`, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
    if (req.headers.authorization !== `Bearer ${UPD_TOKEN}`) return res.writeHead(401).end();
    if (req.url === '/status') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: upd.status, tag: upd.tag, previousTag: null, step: null, version: '1.0.0', job: upd.job }));
    if (req.url === '/update') return res.writeHead(upd.updateCode, { 'content-type': 'application/json' }).end('{"accepted":true}');
    if (req.url === '/ack') {
      if (upd.job) upd.job.reported = true;
      return res.writeHead(204).end();
    }
    res.writeHead(404).end();
  });
});
await new Promise<void>((r) => updater.listen(0, '127.0.0.1', r));
after(() => updater.close());
process.env.ATRIA_UPDATER_URL = `http://127.0.0.1:${(updater.address() as AddressInfo).port}`;
process.env.ATRIA_UPDATER_TOKEN = UPD_TOKEN;

// Central falso: só os resultados
const results: { id: string; body: CommandResult }[] = [];
const fake = createServer((req: IncomingMessage, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const m = /^\/api\/commands\/([^/]+)\/result$/.exec(req.url ?? '');
    if (m) results.push({ id: decodeURIComponent(m[1]), body: JSON.parse(raw) });
    res.writeHead(204).end();
  });
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
after(() => fake.close());
const centralUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
const KEY = 'atk_teste_upd';

const { db, now } = await import('../src/db.ts');
const settings = await import('../src/settings.ts');
const runs = await import('../src/runs.ts');
const telemetry = await import('../src/telemetry.ts');
const central = await import('../src/central.ts');
settings.setRaw('monitor.url', centralUrl);
settings.setRaw('monitor.key', KEY);
central.startCentral({ timers: false });
central.drain.pollMs = 20;

const until = async (fn: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const of = (id: string) => results.filter((r) => r.id === id).map((r) => r.body);
const send = (id: string, tag = 'v1.1.0') => central.dispatchCommands({ commands: [{ id, kind: 'update', payload: { jobId: `job-${id}`, tag } }] }, { url: centralUrl, key: KEY });

test('snapshot anuncia "update" e o estado do atualizador quando ele responde', async () => {
  const snap = await telemetry.collectTelemetry({ events: 'recent' });
  assert.deepEqual(snap.instance.capabilities, ['commands', 'support', 'notice', 'update']);
  assert.deepEqual(snap.instance.updater, { status: 'ready', tag: 'v1.0.0', step: null });
  assert.ok(upd.calls.every((c) => c.auth === `Bearer ${UPD_TOKEN}`));
});

test('atualizações desligadas pelo cliente: recusa com etapa refused e nem chama o atualizador', async () => {
  settings.setRaw('update.allowRemote', 'false');
  const before = upd.calls.length;
  send('u-off');
  await until(() => of('u-off').length > 0);
  assert.deepEqual(of('u-off').map((r) => [r.status, r.step]), [['failed', 'refused']]);
  assert.ok(!upd.calls.slice(before).some((c) => c.path === 'POST /update'));
  assert.equal(central.localUpdate()?.result, 'refused');
  settings.setRaw('update.allowRemote', null);
});

test('tag inválida falha sem segurar a fila', async () => {
  send('u-bad', 'latest');
  await until(() => of('u-bad').length > 0);
  assert.equal(of('u-bad')[0].status, 'failed');
  assert.equal(runs.queueHeld(), false);
});

test('drena: segura a fila, espera as execuções em andamento e só então chama o atualizador', async () => {
  db.prepare(`INSERT INTO runs(id, agent_id, instruction, task, state, created_at, started_at) VALUES('r-busy', 'backend', 'x', 'x', 'running', ?, ?)`).run(now(), now());
  send('u-1');
  await until(() => of('u-1').some((r) => r.step === 'draining'));
  assert.deepEqual(of('u-1').map((r) => r.step), ['received', 'draining']);
  assert.equal(runs.queueHeld(), true);
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(!upd.calls.some((c) => c.path === 'POST /update'), 'não pode chamar o atualizador com execução rodando');

  // segundo pedido enquanto o primeiro está em andamento: recusado
  send('u-2');
  await until(() => of('u-2').length > 0);
  assert.equal(of('u-2')[0].status, 'failed');

  db.prepare(`UPDATE runs SET state = 'done', finished_at = ? WHERE id = 'r-busy'`).run(now());
  await until(() => of('u-1').some((r) => r.step === 'pulling'));
  const call = upd.calls.find((c) => c.path === 'POST /update')!;
  assert.deepEqual(call.body, { tag: 'v1.1.0', commandId: 'u-1', jobId: 'job-u-1' });
  assert.equal(runs.queueHeld(), true); // segue segurada até o reinício (ou a reconciliação)
  assert.ok(!of('u-1').some((r) => r.status !== 'progress'));
  assert.ok((await telemetry.collectTelemetry({ events: 'recent' })).events.some((e) => e.kind === 'update_step' && e.ref === 'job-u-1'));
});

test('reconciliação: resultado do atualizador vai ao Central, recebe /ack e solta a fila', async () => {
  upd.job = { commandId: 'u-1', jobId: 'job-u-1', tag: 'v1.1.0', fromTag: 'v1.0.0', startedAt: now(), finishedAt: now(), result: 'done', error: null, reported: false };
  assert.equal(await central.reconcileUpdate(), true);
  assert.deepEqual(of('u-1').at(-1) && [of('u-1').at(-1)!.status, of('u-1').at(-1)!.step], ['done', 'healthy']);
  assert.ok(upd.calls.some((c) => c.path === 'POST /ack' && (c.body as { commandId: string }).commandId === 'u-1'));
  assert.equal(runs.queueHeld(), false);
  assert.equal(central.localUpdate()?.result, 'done');
  // já informado: não repete
  assert.equal(await central.reconcileUpdate(), false);

  // reentrega do comando já concluído: reenvia o resultado final, não atualiza de novo
  const n = upd.calls.filter((c) => c.path === 'POST /update').length;
  send('u-1');
  await until(() => of('u-1').filter((r) => r.status === 'done').length === 2);
  assert.equal(upd.calls.filter((c) => c.path === 'POST /update').length, n);
});

test('reconciliação no boot de uma atualização revertida', async () => {
  upd.job = { commandId: 'u-old', jobId: 'job-old', tag: 'v1.2.0', fromTag: 'v1.1.0', startedAt: now(), finishedAt: now(), result: 'rolled_back', error: 'não ficou saudável em 180 s', reported: false };
  assert.equal(await central.reconcileUpdate(), true);
  const r = of('u-old')[0];
  assert.equal(r.status, 'failed');
  assert.equal(r.step, 'rolled_back');
  assert.match(r.text ?? '', /v1\.1\.0/);
  assert.equal(upd.job.reported, true);
});

test('Central fora do ar: reconciliação não dá /ack e tenta de novo depois', async () => {
  upd.job = { commandId: 'u-f', jobId: 'job-f', tag: 'v1.3.0', fromTag: 'v1.2.0', startedAt: now(), finishedAt: now(), result: 'failed', error: 'pull falhou', reported: false };
  settings.setRaw('monitor.url', 'http://127.0.0.1:9');
  assert.equal(await central.reconcileUpdate(), false);
  assert.equal(upd.job.reported, false);
  settings.setRaw('monitor.url', centralUrl);
  assert.equal(await central.reconcileUpdate(), true);
  assert.deepEqual([of('u-f')[0].status, of('u-f')[0].step], ['failed', 'failed']);
});

test('atualizador ocupado (409): falha e solta a fila', async () => {
  upd.updateCode = 409;
  send('u-409');
  await until(() => of('u-409').some((r) => r.status === 'failed'));
  assert.match(of('u-409').at(-1)!.text ?? '', /ocupado/);
  assert.equal(runs.queueHeld(), false);
});
