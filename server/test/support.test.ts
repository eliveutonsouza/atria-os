import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { CentralCommand, CommandResult } from '../../shared/telemetry.ts';

// Suporte remoto e avisos do Atria Central: link assinado (válido, vencido, reusado, assinatura errada,
// acesso desligado, outra instância), sessão de 2 h que expira e é encerrada, e os comandos notice/notice_cancel.
const root = mkdtempSync(join(tmpdir(), 'atria-support-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
process.env.ATRIA_DOCKER_API = 'http://127.0.0.1:9';
process.env.ATRIA_BROWSER_MCP = 'http://127.0.0.1:9/mcp';
process.env.ATRIA_PG_URL = '';
process.env.ATRIA_UPDATER_TOKEN = '';
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });
mkdirSync(process.env.ATRIA_WORKSPACE_DIR, { recursive: true });

const { db } = await import('../src/db.ts');
const settings = await import('../src/settings.ts');
const { registerAuth, setPassword } = await import('../src/auth.ts');
const { inboxItems } = await import('../src/runs.ts');
const telemetry = await import('../src/telemetry.ts');
const central = await import('../src/central.ts');
const support = await import('../src/support.ts');

const KEY = 'atk_teste_suporte_123';

// Central falso: guarda os resultados dos comandos e devolve os comandos da vez no ingest
const results: { id: string; auth: string | undefined; body: CommandResult }[] = [];
let pending: CentralCommand[] = [];
const fake = createServer((req: IncomingMessage, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const m = /^\/api\/commands\/([^/]+)\/result$/.exec(req.url ?? '');
    if (m) {
      results.push({ id: decodeURIComponent(m[1]), auth: req.headers.authorization, body: JSON.parse(raw) });
      return res.writeHead(204).end();
    }
    if (req.url === '/api/ingest' && pending.length) {
      const commands = pending;
      pending = [];
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ commands }));
    }
    res.writeHead(204).end();
  });
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
const centralUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
after(() => fake.close());
settings.setRaw('monitor.url', centralUrl);
settings.setRaw('monitor.key', KEY);

// App com o mesmo guard de sessão do index.ts
const app = Fastify();
await app.register(cookie, { secret: 'x'.repeat(32) });
await app.register(rateLimit, { global: false });
registerAuth(app);
app.addHook('preHandler', async (req, reply) => {
  const url = req.url.split('?')[0];
  if (!url.startsWith('/api/') || url.startsWith('/api/auth/')) return;
  const { requireAuth } = await import('../src/auth.ts');
  await requireAuth(req, reply);
});
settings.register(app);
central.register(app);
support.register(app);
await app.ready();
after(() => app.close());

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
function token(over: Partial<{ iid: string; n: string; exp: number; by: string }> = {}, key = KEY) {
  const p = { iid: telemetry.instanceId(), n: b64(Math.random().toString(36).repeat(2)).slice(0, 22), exp: Math.floor(Date.now() / 1000) + 60, by: 'Atria Central', ...over };
  const first = b64(JSON.stringify(p));
  return `${first}.${b64(createHmac('sha256', key).update(first).digest())}`;
}
// cada tentativa de um IP diferente: o limite de 10/min por IP não entra no caminho dos testes
let ip = 0;
const login = (t: string) => app.inject({ method: 'POST', url: '/api/auth/support', payload: { t }, remoteAddress: `10.0.0.${++ip}` });
const cookieOf = (r: { cookies: { name: string; value: string }[] }) => {
  const c = r.cookies.find((x) => x.name === 'atria_sid');
  return c ? `atria_sid=${c.value}` : '';
};
const until = async (fn: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const recentEvents = async () => (await telemetry.collectTelemetry({ events: 'recent' })).events;

test('página /support carrega o script do próprio site (sem script inline)', async () => {
  const page = await app.inject({ method: 'GET', url: '/support?t=abc' });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /<script src="\/support\.js"><\/script>/);
  assert.doesNotMatch(page.body, /<script>/);
  const js = await app.inject({ method: 'GET', url: '/support.js' });
  assert.match(js.headers['content-type'] as string, /javascript/);
  assert.match(js.body, /\/api\/auth\/support/);
});

test('link válido abre sessão de suporte de 2 h, visível no status, inbox e telemetria; reuso é recusado', async () => {
  const t = token();
  const r = await login(t);
  assert.equal(r.statusCode, 204, r.body);
  const sid = cookieOf(r);
  assert.ok(sid);
  const st = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie: sid } });
  const j = st.json();
  assert.equal(j.authed, true);
  assert.equal(j.session, 'support');
  assert.equal(j.support.active, true);
  const ttl = Date.parse(j.support.expiresAt) - Date.now();
  assert.ok(ttl > 119 * 60_000 && ttl <= 120 * 60_000, String(ttl));
  const row = db.prepare(`SELECT kind, label FROM sessions WHERE kind = 'support'`).get() as { kind: string; label: string };
  assert.deepEqual({ ...row }, { kind: 'support', label: 'Atria Central' });
  assert.ok(inboxItems().some((i) => i.id.startsWith('support:') && i.tag === 'Suporte'));
  assert.ok((await recentEvents()).some((e) => e.kind === 'support_login' && e.level === 'warn'));
  assert.equal((await app.inject({ method: 'GET', url: '/api/support/sessions', headers: { cookie: sid } })).statusCode, 200);

  const again = await login(t);
  assert.equal(again.statusCode, 401);
  assert.match(again.json().error, /já foi usado/);

  // sem sessão o status não conta nada
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/auth/status' })).json(), { authed: false });

  // a sessão de suporte não desliga o próprio acesso nem troca a senha
  const put = await app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie: sid }, payload: { 'support.remoteAccess': false } });
  assert.equal(put.statusCode, 403);
  const pw = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { cookie: sid }, payload: { current: 'x', next: 'yyyyyyyy' } });
  assert.equal(pw.statusCode, 403);

  // "Encerrar acesso": a sessão de suporte cai e o histórico registra
  const end = await app.inject({ method: 'DELETE', url: '/api/support/sessions', headers: { cookie: sid } });
  assert.equal(end.json().ended, 1);
  assert.equal((await app.inject({ method: 'GET', url: '/api/notices', headers: { cookie: sid } })).statusCode, 401);
  assert.equal(support.supportState().active, false);
  assert.equal(support.supportHistory()[0].endedBy, 'support');
  assert.ok((await recentEvents()).some((e) => e.kind === 'support_end'));
});

test('link vencido, longo demais, com assinatura errada, de outra instância ou malformado é recusado', async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const [t, re] of [
    [token({ exp: now - 1 }), /expirado/],
    [token({ exp: now + 600 }), /longa/],
    [token({}, 'atk_outra_chave'), /inválido/],
    [token({ iid: '00000000-0000-0000-0000-000000000000' }), /outra instância/],
  ] as const) {
    const r = await login(t);
    assert.equal(r.statusCode, 401, t);
    assert.match(r.json().error, re);
  }
  const bad = await login('não é token');
  assert.equal(bad.statusCode, 400);
  assert.equal(support.supportState().active, false);
});

test('acesso remoto desligado pelo cliente: 403 e nada de sessão', async () => {
  settings.setRaw('support.remoteAccess', 'false');
  const r = await login(token());
  assert.equal(r.statusCode, 403);
  assert.match(r.json().error, /desligado/);
  assert.equal(cookieOf(r), '');
  settings.setRaw('support.remoteAccess', null);
  assert.equal(settings.getSetting('support.remoteAccess'), true); // padrão ligado
});

test('sessão de suporte expira sozinha e vira "expirou" no histórico', async () => {
  const r = await login(token());
  const sid = cookieOf(r);
  const past = new Date(Date.now() - 1000).toISOString();
  db.prepare(`UPDATE sessions SET expires_at = ? WHERE kind = 'support'`).run(past);
  db.prepare('UPDATE support_access SET expires_at = ? WHERE ended_at IS NULL').run(past);
  assert.equal((await app.inject({ method: 'GET', url: '/api/notices', headers: { cookie: sid } })).statusCode, 401);
  assert.equal(support.supportState().active, false);
  assert.equal(support.supportHistory()[0].endedBy, 'expired');
  assert.ok(!inboxItems().some((i) => i.id.startsWith('support:')));
});

test('troca de senha e comando support_end encerram o suporte', async () => {
  await setPassword('senha-do-dono-1');
  const owner = cookieOf(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'senha-do-dono-1' } }));
  assert.ok(owner);
  await login(token());
  assert.equal(support.supportState().active, true);
  const pw = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { cookie: owner }, payload: { current: 'senha-do-dono-1', next: 'senha-do-dono-2' } });
  assert.equal(pw.statusCode, 204);
  assert.equal(support.supportState().active, false);
  assert.equal(support.supportHistory()[0].endedBy, 'password');

  assert.equal((await login(token())).statusCode, 204);
  central.dispatchCommands({ commands: [{ id: 'cmd-end-1', kind: 'support_end', payload: {} }] }, { url: centralUrl, key: KEY });
  await until(() => results.some((r) => r.id === 'cmd-end-1'));
  const res = results.find((r) => r.id === 'cmd-end-1')!;
  assert.equal(res.auth, `Bearer ${KEY}`);
  assert.equal(res.body.status, 'done');
  assert.equal(support.supportHistory()[0].endedBy, 'central');
  // o dono continua logado
  assert.equal((await app.inject({ method: 'GET', url: '/api/notices', headers: { cookie: owner } })).statusCode, 200);
});

test('aviso: chega pelo pulso, aparece, é lido (evento com ref), é cancelado e expira', async () => {
  const owner = cookieOf(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'senha-do-dono-2' } }));
  pending = [{ id: 'cmd-n1', kind: 'notice', payload: { noticeId: 'n1', title: 'Manutenção sábado 22h', body: 'Fora do ar por até 10 minutos.', level: 'warn', expiresAt: null, push: false } }];
  settings.setRaw('monitor.enabled', 'true');
  const pulse = await telemetry.sendPulse();
  assert.equal(pulse.ok, true);
  await until(() => results.some((r) => r.id === 'cmd-n1'));
  assert.equal(results.find((r) => r.id === 'cmd-n1')!.body.status, 'done');

  const list = (await app.inject({ method: 'GET', url: '/api/notices', headers: { cookie: owner } })).json() as { id: string; level: string; readAt: string | null }[];
  assert.deepEqual(list.map((n) => [n.id, n.level, n.readAt]), [['n1', 'warn', null]]);
  assert.ok(inboxItems().some((i) => i.id === 'notice:n1' && i.tone === 'warn'));

  // reentrega do mesmo comando: não duplica e reenvia o resultado
  const before = results.length;
  central.dispatchCommands({ commands: [{ id: 'cmd-n1', kind: 'notice', payload: { noticeId: 'n1', title: 'outro', body: '', level: 'info', expiresAt: null, push: false } }] }, { url: centralUrl, key: KEY });
  await until(() => results.length > before);
  assert.equal(results.at(-1)!.id, 'cmd-n1');
  assert.equal(support.activeNotices().length, 1);
  assert.equal(support.activeNotices()[0].title, 'Manutenção sábado 22h');

  const read = await app.inject({ method: 'POST', url: '/api/notices/n1/read', headers: { cookie: owner } });
  assert.equal(read.statusCode, 204);
  assert.ok(support.activeNotices()[0].readAt);
  assert.ok(!inboxItems().some((i) => i.id === 'notice:n1'));
  assert.ok((await recentEvents()).some((e) => e.kind === 'notice_read' && e.ref === 'n1'));
  assert.equal((await app.inject({ method: 'POST', url: '/api/notices/nada/read', headers: { cookie: owner } })).statusCode, 404);

  central.dispatchCommands({ commands: [{ id: 'cmd-c1', kind: 'notice_cancel', payload: { noticeId: 'n1' } }] }, { url: centralUrl, key: KEY });
  await until(() => results.some((r) => r.id === 'cmd-c1'));
  assert.equal(support.activeNotices().length, 0);

  // vencido não aparece; inválido falha
  central.dispatchCommands(
    {
      commands: [
        { id: 'cmd-n2', kind: 'notice', payload: { noticeId: 'n2', title: 'Velho', body: '', level: 'info', expiresAt: new Date(Date.now() - 60_000).toISOString(), push: false } },
        { id: 'cmd-n3', kind: 'notice', payload: { noticeId: 'n3', title: '', body: '', level: 'mega', expiresAt: null, push: false } as never },
      ],
    },
    { url: centralUrl, key: KEY },
  );
  await until(() => results.some((r) => r.id === 'cmd-n2') && results.some((r) => r.id === 'cmd-n3'));
  assert.equal(support.activeNotices().length, 0);
  assert.equal(results.find((r) => r.id === 'cmd-n3')!.body.status, 'failed');
});

test('snapshot anuncia comandos, suporte e avisos; sem atualizador fica "missing" e sem update', async () => {
  const snap = await telemetry.collectTelemetry({ events: 'recent' });
  assert.deepEqual(snap.instance.capabilities, ['commands', 'support', 'notice']);
  assert.equal(snap.instance.supportAllowed, true);
  assert.equal(snap.instance.updatesAllowed, true);
  assert.deepEqual(snap.instance.updater, { status: 'missing', tag: null, step: null });
  // comando desconhecido: falha com aviso, sem derrubar nada
  central.dispatchCommands({ commands: [{ id: 'cmd-x', kind: 'bogus' } as never] }, { url: centralUrl, key: KEY });
  await until(() => results.some((r) => r.id === 'cmd-x'));
  assert.equal(results.find((r) => r.id === 'cmd-x')!.body.status, 'failed');
});
