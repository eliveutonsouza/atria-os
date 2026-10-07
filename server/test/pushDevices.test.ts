import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Dispositivos de notificação: listagem com id e remoção por aparelho.
// Banco temporário: o env precisa estar pronto antes de importar os módulos.
const root = mkdtempSync(join(tmpdir(), 'atria-push-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
process.env.VAPID_SUBJECT = 'mailto:teste@example.com';
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });

const { db, now } = await import('../src/db.ts');
const push = await import('../src/push.ts');

// App falso que guarda os handlers por "MÉTODO caminho".
type Handler = (req: unknown, reply: unknown) => unknown;
const routes = new Map<string, Handler>();
const fakeApp = Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map((m) => [m, (path: string, h: Handler) => routes.set(`${m.toUpperCase()} ${path}`, h)]));
push.register(fakeApp as never);

const reply = () => {
  const r = { status: 200, body: undefined as unknown, code(n: number) { r.status = n; return r; }, send(b?: unknown) { r.body = b; return r; } };
  return r;
};
const add = (endpoint: string, device: string) =>
  db.prepare('INSERT INTO push_subscriptions(endpoint, keys, device, created_at) VALUES(?, ?, ?, ?)').run(endpoint, '{}', device, now());

test('GET /api/push/devices devolve id e DELETE remove só aquele aparelho', async () => {
  add('https://push.example/a', 'iPhone');
  add('https://push.example/b', 'Chrome no Linux');
  const list = (await routes.get('GET /api/push/devices')!({}, reply())) as { id: number; device: string; created_at: string }[];
  assert.equal(list.length, 2);
  assert.ok(list.every((d) => Number.isInteger(d.id) && d.device && d.created_at));
  assert.ok(list.every((d) => !('endpoint' in d)));

  const iphone = list.find((d) => d.device === 'iPhone')!;
  const r = reply();
  await routes.get('DELETE /api/push/devices/:id')!({ params: { id: String(iphone.id) } }, r);
  assert.equal(r.status, 204);
  const after = (await routes.get('GET /api/push/devices')!({}, reply())) as { device: string }[];
  assert.deepEqual(after.map((d) => d.device), ['Chrome no Linux']);

  const again = reply();
  await routes.get('DELETE /api/push/devices/:id')!({ params: { id: String(iphone.id) } }, again);
  assert.equal(again.status, 404);
  const bad = reply();
  await routes.get('DELETE /api/push/devices/:id')!({ params: { id: 'x' } }, bad);
  assert.equal(bad.status, 400);
});
