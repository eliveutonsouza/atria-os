import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeFetch } from './notifyFake.ts';

// Avisos: envio por Telegram, e-mail (Resend) e push; canal não configurado; falha que não lança; rotas.
const root = mkdtempSync(join(tmpdir(), 'atria-notify-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
process.env.ATRIA_DOMAIN = 'atria.example.com';
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });

const { setRaw } = await import('../src/settings.ts');
const notify = await import('../src/notify.ts');
const { state, fetchImpl } = fakeFetch();
notify.setNotifyFetch(fetchImpl);

type Handler = (req: unknown, reply: unknown) => unknown;
const routes = new Map<string, Handler>();
const fakeApp = Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map((m) => [m, (path: string, h: Handler) => routes.set(`${m.toUpperCase()} ${path}`, h)]));
notify.register(fakeApp as never); // sem token: o polling não começa
const reply = () => {
  const r = { status: 200, body: undefined as unknown, code(n: number) { r.status = n; return r; }, send(b?: unknown) { r.body = b; return r; } };
  return r;
};

const reset = () => {
  for (const k of ['notify.telegram.token', 'notify.telegram.chatId', 'notify.email.resendKey', 'notify.email.to', 'notify.email.from']) setRaw(k, null);
  state.clear();
  state.failTelegram = false;
  state.resendStatus = 200;
};

test('publicUrl usa o domínio do painel', () => {
  assert.equal(notify.publicUrl('/app/workflows/pedido/abc'), 'https://atria.example.com/app/workflows/pedido/abc');
  assert.equal(notify.publicUrl('app'), 'https://atria.example.com/app');
});

test('canal não configurado volta ok:false sem chamar nada', async () => {
  reset();
  const r = await notify.sendNotice({ title: 'Oi', text: 'x', channels: ['telegram', 'email', 'push'] });
  assert.deepEqual(r.map((x) => [x.channel, x.ok]), [['telegram', false], ['email', false], ['push', false]]);
  assert.equal(r[0].error, 'não configurado');
  assert.equal(r[1].error, 'não configurado');
  assert.match(r[2].error!, /nenhum aparelho/);
  assert.equal(state.calls.length, 0);
  // token sem chat vinculado
  setRaw('notify.telegram.token', '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  const [t] = await notify.sendNotice({ title: 'Oi', text: 'x', channels: ['telegram'] });
  assert.equal(t.ok, false);
  assert.match(t.error!, /não vinculado/);
});

test('Telegram: mensagem HTML com botão do formulário e anexos (foto e documento)', async () => {
  reset();
  setRaw('notify.telegram.token', '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  setRaw('notify.telegram.chatId', '999');
  const img = join(root, 'site.png');
  const pdf = join(root, 'proposta.pdf');
  writeFileSync(img, Buffer.alloc(100));
  writeFileSync(pdf, Buffer.alloc(200));
  const [r] = await notify.sendNotice({
    title: 'Reunião <Lead>', text: 'Mande a gravação & o resumo', url: notify.publicUrl('/app/workflows/pedido/p1'),
    files: [img, pdf, join(root, 'sumiu.txt')], channels: ['telegram'], inputRequestId: 'p1', kind: 'input',
  });
  assert.equal(r.ok, true);
  assert.equal(typeof r.telegramMessageId, 'number');
  assert.match(r.error!, /sumiu\.txt: arquivo não encontrado/);
  const [m] = state.tg('sendMessage');
  const body = m.body as { chat_id: string; text: string; parse_mode: string; reply_markup: { inline_keyboard: { text: string; url: string }[][] } };
  assert.equal(m.url, 'https://api.telegram.org/bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ/sendMessage');
  assert.equal(body.chat_id, '999');
  assert.equal(body.parse_mode, 'HTML');
  assert.match(body.text, /<b>Reunião &lt;Lead&gt;<\/b>/);
  assert.match(body.text, /gravação &amp; o resumo/);
  assert.match(body.text, /Responda esta mensagem/);
  assert.deepEqual(body.reply_markup.inline_keyboard[0][0], { text: 'Abrir formulário', url: 'https://atria.example.com/app/workflows/pedido/p1' });
  assert.equal(state.tg('sendPhoto').length, 1);
  assert.equal(state.tg('sendDocument').length, 1);
  assert.ok(state.tg('sendPhoto')[0].body instanceof FormData);
});

test('e-mail pela Resend: HTML, destino e anexos em base64', async () => {
  reset();
  setRaw('notify.email.resendKey', 're_testekey123456');
  setRaw('notify.email.to', 'eu@example.com, socio@example.com');
  setRaw('notify.email.from', 'Atria <avisos@example.com>');
  const f = join(root, 'resumo.md');
  writeFileSync(f, '# resumo');
  const [r] = await notify.sendNotice({ title: 'Site pronto', text: 'Linha 1\nLinha <2>', url: 'https://atria.example.com/app', files: [f], channels: ['email'] });
  assert.equal(r.ok, true);
  const [c] = state.resend();
  assert.equal(c.headers.authorization, 'Bearer re_testekey123456');
  const b = c.body as { from: string; to: string[]; subject: string; html: string; attachments: { filename: string; content: string }[] };
  assert.equal(b.from, 'Atria <avisos@example.com>');
  assert.deepEqual(b.to, ['eu@example.com', 'socio@example.com']);
  assert.equal(b.subject, 'Site pronto');
  assert.match(b.html, /Linha 1<br>Linha &lt;2&gt;/);
  assert.match(b.html, /href="https:\/\/atria.example.com\/app"/);
  assert.deepEqual(b.attachments, [{ filename: 'resumo.md', content: Buffer.from('# resumo').toString('base64') }]);
});

test('falha de canal não lança: Telegram fora do ar e Resend recusando', async () => {
  reset();
  setRaw('notify.telegram.token', '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  setRaw('notify.telegram.chatId', '999');
  setRaw('notify.email.resendKey', 're_testekey123456');
  setRaw('notify.email.to', 'eu@example.com');
  state.failTelegram = true;
  state.resendStatus = 422;
  const r = await notify.sendNotice({ title: 'x', text: 'y', channels: ['telegram', 'email', 'push'] });
  assert.equal(r.length, 3);
  assert.ok(r.every((x) => !x.ok));
  assert.match(r[0].error!, /rede fora/);
  assert.match(r[1].error!, /Resend: domínio não verificado/);
});

test('rotas: status, código de vínculo, teste e desvincular', async () => {
  reset();
  const st = (await routes.get('GET /api/notify/status')!({}, reply())) as import('../../shared/protocol.ts').NotifyStatus;
  assert.deepEqual(st.telegram, { configured: false, linked: false, chatName: null, botName: null, linkCode: null, error: null });
  assert.equal(st.email.configured, false);
  assert.equal(st.push.devices, 0);
  assert.equal(st.remindHours, 24);

  const r0 = reply();
  await routes.get('POST /api/notify/telegram/link-code')!({}, r0);
  assert.equal(r0.status, 400);

  setRaw('notify.telegram.token', '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  const { code } = (await routes.get('POST /api/notify/telegram/link-code')!({}, reply())) as { code: string };
  assert.match(code, /^[A-Z2-9]{6}$/);
  setRaw('notify.telegram.chatId', '999');
  const st2 = (await routes.get('GET /api/notify/status')!({}, reply())) as import('../../shared/protocol.ts').NotifyStatus;
  assert.equal(st2.telegram.configured, true);
  assert.equal(st2.telegram.linked, true);
  assert.equal(st2.telegram.linkCode, code);

  const bad = reply();
  await routes.get('POST /api/notify/test')!({ body: { channel: 'sms' } }, bad);
  assert.equal(bad.status, 400);
  const ok = (await routes.get('POST /api/notify/test')!({ body: { channel: 'telegram' } }, reply())) as { channel: string; ok: boolean };
  assert.deepEqual([ok.channel, ok.ok], ['telegram', true]);
  assert.match((state.tg('sendMessage')[0].body as { text: string }).text, /Teste do Atria OS/);

  const del = reply();
  await routes.get('DELETE /api/notify/telegram/link')!({}, del);
  assert.equal(del.status, 204);
  const st3 = (await routes.get('GET /api/notify/status')!({}, reply())) as import('../../shared/protocol.ts').NotifyStatus;
  assert.equal(st3.telegram.linked, false);
});
