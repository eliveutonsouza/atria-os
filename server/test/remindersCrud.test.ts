import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';

// CRUD de lembretes pelo painel, relatórios (nome seguro) e telas sob medida.
// Banco e workspace temporários: o env precisa estar pronto antes de importar os módulos.
const root = mkdtempSync(join(tmpdir(), 'atria-rem-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });
const reportsDir = join(process.env.ATRIA_WORKSPACE_DIR, '.atria', 'reports');
const viewsDir = join(process.env.ATRIA_WORKSPACE_DIR, '.atria', 'views');
mkdirSync(reportsDir, { recursive: true });
mkdirSync(viewsDir, { recursive: true });

const { db } = await import('../src/db.ts');
const remindersApi = await import('../src/remindersApi.ts');
const reportsApi = await import('../src/reportsApi.ts');
const customViews = await import('../src/customViews.ts');

const app = Fastify();
remindersApi.register(app);
reportsApi.register(app);
customViews.register(app);
await app.ready();

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
  const r = await app.inject({ method, url, payload: payload as never });
  return { code: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

test('lembretes: criar, listar, editar, cancelar e excluir', async () => {
  const c = await call('POST', '/api/reminders', { text: 'Ligar pro contador', dueAt: inHours(2), repeat: null });
  assert.equal(c.code, 201);
  const id = c.body.id as string;
  assert.equal(c.body.status, 'pending');

  assert.equal((await call('POST', '/api/reminders', { text: '  ', dueAt: inHours(1) })).code, 400);
  assert.equal((await call('POST', '/api/reminders', { text: 'x', dueAt: inHours(-2) })).code, 400);
  assert.equal((await call('POST', '/api/reminders', { text: 'x', dueAt: inHours(1), repeat: 'anual' })).code, 400);

  const list = await call('GET', '/api/reminders?status=pending');
  assert.deepEqual(list.body.map((r: { id: string }) => r.id), [id]);

  const e = await call('PUT', `/api/reminders/${id}`, { text: 'Ligar pro contador às 15h', repeat: 'semanal' });
  assert.equal(e.code, 200);
  assert.equal(e.body.text, 'Ligar pro contador às 15h');
  assert.equal(e.body.repeat, 'semanal');
  assert.equal(e.body.dueAt, c.body.dueAt);
  assert.equal((await call('PUT', `/api/reminders/${id}`, { repeat: null })).body.repeat, null);
  assert.equal((await call('PUT', '/api/reminders/nao-existe', { text: 'x' })).code, 404);

  assert.equal((await call('POST', `/api/reminders/${id}/cancel`)).code, 204);
  assert.equal((await call('GET', '/api/reminders?status=pending')).body.length, 0);
  assert.equal((await call('GET', '/api/reminders?status=cancelled')).body[0].id, id);
  assert.equal((await call('PUT', `/api/reminders/${id}`, { text: 'y' })).code, 409);

  assert.equal((await call('DELETE', `/api/reminders/${id}`)).code, 204);
  assert.equal((await call('DELETE', `/api/reminders/${id}`)).code, 404);
  assert.equal((await call('GET', '/api/reminders?status=all')).body.length, 0);
});

test('lembrete perdido aparece em pendentes e volta a pendente quando reagendado', async () => {
  db.prepare(`INSERT INTO reminders(id, text, due_at, repeat, status, created_at) VALUES('perd1', 'Pagar boleto', ?, NULL, 'missed', ?)`).run(inHours(-5), inHours(-6));
  const pend = await call('GET', '/api/reminders');
  assert.equal(pend.body.find((r: { id: string }) => r.id === 'perd1')?.status, 'missed');
  assert.equal((await call('PUT', '/api/reminders/perd1', { text: 'Pagar boleto hoje' })).code, 400); // perdido exige horário novo
  const e = await call('PUT', '/api/reminders/perd1', { dueAt: inHours(3) });
  assert.equal(e.code, 200);
  assert.equal(e.body.status, 'pending');
});

test('relatórios: nome validado contra path traversal', async () => {
  for (const ok of ['2026-10-06-1430.json', 'relatorio_semanal.v2.json']) assert.equal(reportsApi.validReportName(ok), true, ok);
  for (const bad of ['../x.json', '..json', '.oculto.json', 'a/b.json', 'a\\b.json', 'x.txt', '', 'x.json\0', '%2e%2e.json'])
    assert.equal(reportsApi.validReportName(bad), false, bad);

  writeFileSync(join(reportsDir, '2026-10-05-0900.json'), JSON.stringify({ title: 'Semana 40', lead: 'ok', generatedAt: '2026-10-05T09:00:00.000Z' }));
  writeFileSync(join(reportsDir, '2026-10-06-0900.json'), JSON.stringify({ title: 'Semana 41', lead: 'ok' }));
  const list = await call('GET', '/api/reports');
  assert.deepEqual(list.body.map((r: { name: string }) => r.name), ['2026-10-06-0900.json', '2026-10-05-0900.json']);
  assert.equal((await call('GET', '/api/reports/2026-10-05-0900.json')).body.title, 'Semana 40');
  assert.equal((await call('GET', '/api/reports/nada.json')).code, 404);
  assert.equal((await call('GET', '/api/reports/..%2F..%2Fsegredo.json')).code, 400);
  assert.equal((await call('DELETE', '/api/reports/..%2Fdata.json')).code, 400);
  assert.equal((await call('DELETE', '/api/reports/2026-10-05-0900.json')).code, 204);
  assert.equal(existsSync(join(reportsDir, '2026-10-05-0900.json')), false);
  assert.equal((await call('GET', '/api/reports')).body.length, 1);
});

test('telas sob medida: renomear e excluir (linha + pasta)', async () => {
  const v = customViews.saveCustom({ title: 'Leads da semana', blocks: [{ type: 'markdown', text: 'oi' }] }, 'yui', 'view1');
  mkdirSync(join(viewsDir, 'view1'), { recursive: true });
  writeFileSync(join(viewsDir, 'view1', 'index.html'), '<p>oi</p>');
  writeFileSync(join(viewsDir, 'view1.json'), '{}');
  const r = await call('PATCH', `/api/custom/${v.id}`, { title: 'Leads · semana 41' });
  assert.equal(r.code, 200);
  assert.equal(r.body.title, 'Leads · semana 41');
  assert.equal(r.body.spec.title, 'Leads · semana 41');
  assert.equal((await call('PATCH', `/api/custom/${v.id}`, { title: ' ' })).code, 400);
  assert.equal((await call('DELETE', '/api/custom/..%2Fviews')).code, 400);
  assert.equal((await call('DELETE', `/api/custom/${v.id}`)).code, 204);
  assert.equal(existsSync(join(viewsDir, 'view1')), false);
  assert.equal(existsSync(join(viewsDir, 'view1.json')), false);
  assert.equal(customViews.getCustom('view1'), null);
  assert.equal((await call('DELETE', `/api/custom/${v.id}`)).code, 404);
});
