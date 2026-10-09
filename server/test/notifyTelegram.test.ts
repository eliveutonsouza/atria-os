import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeFetch } from './notifyFake.ts';

// Telegram: vínculo por código, só o chat ligado, roteamento das respostas para o pedido certo,
// arquivos baixados para o bridge, limite de 20 MB, confirmação por callback e polling com offset.
const root = mkdtempSync(join(tmpdir(), 'atria-tg-test-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
process.env.ATRIA_DOMAIN = 'atria.example.com';
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });

const { kvGet } = await import('../src/db.ts');
const { getSetting, setRaw } = await import('../src/settings.ts');
const notify = await import('../src/notify.ts');
const { state, fetchImpl } = fakeFetch();
notify.setNotifyFetch(fetchImpl);

type Part = Parameters<import('../src/notify.ts').InputBridge['applyPart']>[1];
const bridgeLog = { parts: [] as { id: string; part: Part; content?: string }[], submits: [] as string[] };
let pending: { id: string; title: string; workflowName: string; tgMessageId: number | null }[] = [];
notify.registerInputBridge({
  pending: () => pending,
  applyPart: async (id, part) => {
    // lê o temporário durante a chamada (depois o notify apaga)
    bridgeLog.parts.push({ id, part, content: part.kind === 'text' ? undefined : readFileSync(part.tmpPath, 'utf8') });
    const kinds = new Set(bridgeLog.parts.filter((p) => p.id === id).map((p) => p.part.kind));
    const missing = kinds.has('audio') ? [] : ['Gravação da reunião'];
    return { summary: `Recebi: ${[...kinds].join(', ')}`, missing, complete: !missing.length };
  },
  submit: async (id, via) => {
    bridgeLog.submits.push(`${id}:${via}`);
    return { ok: true };
  },
});

const CHAT = 999;
let mid = 1;
const msg = (extra: Record<string, unknown>, chat = CHAT) => ({ update_id: mid, message: { message_id: mid++, chat: { id: chat, first_name: 'Eli' }, ...extra } });
const cb = (data: string, chat = CHAT) => ({ update_id: mid++, callback_query: { id: `cq${mid}`, data, message: { message_id: 50, chat: { id: chat } } } });
const sentTexts = () => state.tg('sendMessage').map((c) => (c.body as { text: string }).text);
const lastSent = () => state.tg('sendMessage').at(-1)!.body as { text: string; reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] } };

beforeEach(() => {
  setRaw('notify.telegram.token', '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  setRaw('notify.telegram.chatId', String(CHAT));
  notify.resetTelegramState();
  state.clear();
  state.files.clear();
  bridgeLog.parts.length = 0;
  bridgeLog.submits.length = 0;
  pending = [{ id: 'req-a', title: 'Gravação da reunião', workflowName: 'Lead do dia', tgMessageId: 10 }];
});

test('vínculo por código: só /start com o código certo liga o chat', async () => {
  notify.unlinkTelegram();
  const code = notify.newLinkCode();
  await notify.handleUpdate(msg({ text: '/start ERRADO' }, 777));
  await notify.handleUpdate(msg({ text: code }, 777)); // sem /start
  assert.equal(getSetting('notify.telegram.chatId'), '');
  assert.equal(state.calls.length, 0);
  await notify.handleUpdate(msg({ text: `/start ${code.toLowerCase()}` }, 777));
  assert.equal(getSetting('notify.telegram.chatId'), '777');
  assert.equal(notify.notifyStatus().telegram.chatName, 'Eli');
  assert.equal(notify.notifyStatus().telegram.linkCode, null); // código usado
  assert.match(sentTexts()[0], /ligado ao Atria OS/);
  assert.equal((state.tg('sendMessage')[0].body as { chat_id: string }).chat_id, '777');
});

test('mensagem de outro chat é ignorada', async () => {
  await notify.handleUpdate(msg({ text: 'fechou sim' }, 555));
  await notify.handleUpdate(cb('s:req-a', 555));
  assert.equal(bridgeLog.parts.length, 0);
  assert.equal(bridgeLog.submits.length, 0);
  assert.equal(state.calls.length, 0);
});

test('único pendente: texto vai para ele e o bot diz o que falta', async () => {
  await notify.handleUpdate(msg({ text: 'fechou sim, hoje' }));
  assert.deepEqual(bridgeLog.parts.map((p) => [p.id, p.part]), [['req-a', { kind: 'text', text: 'fechou sim, hoje' }]]);
  assert.match(lastSent().text, /Recebi: text/);
  assert.match(lastSent().text, /Falta: Gravação da reunião/);
  assert.equal(lastSent().reply_markup, undefined);
});

test('reply_to escolhe o pedido certo entre vários', async () => {
  pending = [
    { id: 'req-a', title: 'A', workflowName: 'W1', tgMessageId: 10 },
    { id: 'req-b', title: 'B', workflowName: 'W2', tgMessageId: 20 },
  ];
  await notify.handleUpdate(msg({ text: 'resposta', reply_to_message: { message_id: 20 } }));
  assert.equal(bridgeLog.parts[0].id, 'req-b');
});

test('vários pendentes sem reply: pergunta com botões e usa a mensagem guardada após escolher', async () => {
  pending = [
    { id: 'req-a', title: 'A', workflowName: 'W1', tgMessageId: 10 },
    { id: 'req-b', title: 'B', workflowName: 'W2', tgMessageId: 20 },
  ];
  await notify.handleUpdate(msg({ text: 'fechou' }));
  assert.equal(bridgeLog.parts.length, 0);
  assert.match(lastSent().text, /Para qual pedido/);
  assert.deepEqual(lastSent().reply_markup!.inline_keyboard.map((r) => r[0].callback_data), ['p:req-a', 'p:req-b']);
  await notify.handleUpdate(cb('p:req-b'));
  assert.deepEqual(bridgeLog.parts.map((p) => [p.id, p.part.kind]), [['req-b', 'text']]);
  // mensagens seguintes sem reply continuam no pedido escolhido
  await notify.handleUpdate(msg({ text: 'mais' }));
  assert.equal(bridgeLog.parts[1].id, 'req-b');
  assert.equal(state.tg('answerCallbackQuery').length, 1);
});

test('voz, foto e documento chegam baixados ao bridge; temporário apagado depois', async () => {
  state.files.set('voz1', { size: 5, data: Buffer.from('OGGOK') });
  state.files.set('foto-g', { size: 4, data: Buffer.from('JPEG') });
  state.files.set('doc1', { size: 3, data: Buffer.from('PDF') });
  await notify.handleUpdate(msg({ voice: { file_id: 'voz1', file_size: 5, mime_type: 'audio/ogg' } }));
  await notify.handleUpdate(msg({ photo: [{ file_id: 'foto-p', file_size: 1 }, { file_id: 'foto-g', file_size: 4 }], caption: 'print do site' }));
  await notify.handleUpdate(msg({ document: { file_id: 'doc1', file_size: 3, mime_type: 'application/pdf', file_name: 'proposta.pdf' } }));
  const got = bridgeLog.parts.map((p) => [p.part.kind, p.content ?? (p.part as { text: string }).text]);
  assert.deepEqual(got, [['audio', 'OGGOK'], ['image', 'JPEG'], ['text', 'print do site'], ['file', 'PDF']]);
  const doc = bridgeLog.parts[3].part as { name: string; mime: string; size: number; tmpPath: string };
  assert.deepEqual([doc.name, doc.mime, doc.size], ['proposta.pdf', 'application/pdf', 3]);
  for (const p of bridgeLog.parts) if (p.part.kind !== 'text') assert.equal(existsSync(p.part.tmpPath), false);
  // com o áudio o pedido fica completo: botões Enviar / Ainda não
  const kb = lastSent().reply_markup!.inline_keyboard[0].map((b) => b.callback_data);
  assert.deepEqual(kb, ['s:req-a', 'l:req-a']);
});

test('arquivo acima de 20 MB é recusado com o link do formulário', async () => {
  await notify.handleUpdate(msg({ audio: { file_id: 'grande', file_size: 21 * 1024 * 1024, mime_type: 'audio/mpeg' } }));
  assert.equal(bridgeLog.parts.length, 0);
  assert.equal(state.tg('getFile').length, 0);
  assert.match(lastSent().text, /grande demais pelo Telegram/);
  assert.match(lastSent().text, /https:\/\/atria\.example\.com\/app\/workflows\/pedido\/req-a/);
  // tamanho só conhecido no getFile
  state.files.set('doc-grande', { size: 25 * 1024 * 1024, data: Buffer.from('x') });
  await notify.handleUpdate(msg({ document: { file_id: 'doc-grande', file_name: 'video.mov' } }));
  assert.equal(bridgeLog.parts.length, 0);
  assert.match(lastSent().text, /grande demais/);
});

test('callback "Enviar e continuar" chama submit; "Ainda não" não', async () => {
  await notify.handleUpdate(cb('l:req-a'));
  assert.equal(bridgeLog.submits.length, 0);
  await notify.handleUpdate(cb('s:req-a'));
  assert.deepEqual(bridgeLog.submits, ['req-a:telegram']);
  assert.match(lastSent().text, /Enviado/);
  assert.equal(state.tg('editMessageReplyMarkup').length, 2);
  // pedido que já não está pendente
  pending = [];
  await notify.handleUpdate(cb('s:req-a'));
  assert.equal(bridgeLog.submits.length, 1);
});

test('sem pedidos pendentes o bot avisa', async () => {
  pending = [];
  await notify.handleUpdate(msg({ text: 'oi' }));
  assert.match(lastSent().text, /Nenhum workflow/);
});

test('polling: getMe, getUpdates com offset persistido e parada', async () => {
  setRaw('notify.telegram.chatId', String(CHAT));
  state.updates.push([{ ...msg({ text: 'pelo polling' }), update_id: 41 }]);
  const loop = notify.startTelegramPolling();
  const t0 = Date.now();
  while (!bridgeLog.parts.length && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 10));
  notify.stopTelegramPolling();
  await loop;
  assert.equal(kvGet('notify.tg.offset'), '42');
  assert.equal(notify.notifyStatus().telegram.botName, '@atria_teste_bot');
  assert.equal((bridgeLog.parts[0].part as { text: string }).text, 'pelo polling');
  const ups = state.tg('getUpdates');
  assert.equal((ups[0].body as { offset: number }).offset, 0);
  assert.equal((ups[1].body as { offset: number }).offset, 42);
});
