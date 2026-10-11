import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeFetch } from './notifyFake.ts';

// F2 (v1.3.0): conversa pelo Telegram, busca no histórico, balanço falado e rotinas (overlap, catch-up, entrega).
const root = mkdtempSync(join(tmpdir(), 'atria-f2-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
process.env.ATRIA_DOMAIN = 'atria.example.com';
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });
const seedAgents = join(process.env.ATRIA_WORKSPACE_DIR, '.claude', 'agents');
mkdirSync(seedAgents, { recursive: true });
copyFileSync(new URL('../../workspace-seed/.claude/agents/backend.md', import.meta.url).pathname, join(seedAgents, 'backend.md'));

const { db, now } = await import('../src/db.ts');
const { setRaw } = await import('../src/settings.ts');
const notify = await import('../src/notify.ts');
const brain = await import('../src/brain.ts');
const search = await import('../src/search.ts');
const { insights } = await import('../src/insights.ts');
await import('../src/workflows.ts');
const rt = await import('../src/routines.ts');
const { state, fetchImpl } = fakeFetch();
notify.setNotifyFetch(fetchImpl);
after(() => {
  for (const r of rt.listRoutines()) rt.deleteRoutine(r.id);
});

const CHAT = 4242;
let mid = 1;
const msg = (extra: Record<string, unknown>, chat = CHAT) => ({ update_id: mid, message: { message_id: mid++, chat: { id: chat, first_name: 'Eli' }, ...extra } });
const cb = (data: string) => ({ update_id: mid++, callback_query: { id: `cq${mid}`, data, message: { message_id: 50, chat: { id: CHAT } } } });
const sentTexts = () => state.tg('sendMessage').map((c) => (c.body as { text: string }).text);

const asked: string[] = [];
let project: string | null = null;
const resolved: string[] = [];
notify.registerChatBridge({
  ask: async (text) => {
    asked.push(text);
    return `Resposta para: ${text} <b>`;
  },
  transcribe: async () => 'texto do áudio',
  project: () => ({ slug: project, name: project ?? 'Geral' }),
  setProject: (q) => (q === 'stoq' ? ((project = 'stoq'), { ok: true, name: 'Stoq' }) : { ok: false, error: `Não achei o projeto "${q}".`, options: ['Stoq'] }),
  resolveApproval: (id, ok) => (resolved.push(`${id}:${ok}`), { ok: id === 'ap1', title: 'Dev quer publicar' }),
});

beforeEach(() => {
  setRaw('notify.telegram.token', '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  setRaw('notify.telegram.chatId', String(CHAT));
  notify.resetTelegramState();
  state.clear();
  asked.length = 0;
  resolved.length = 0;
});

test('Telegram: sem pedido de workflow, texto vai para a Yui e a resposta volta escapada', async () => {
  await notify.handleUpdate(msg({ text: 'quanto gastei hoje?' }));
  assert.deepEqual(asked, ['quanto gastei hoje?']);
  assert.match(sentTexts().at(-1)!, /Resposta para: quanto gastei hoje\? &lt;b&gt;/);
});

test('Telegram: chat não vinculado nunca chega na Yui', async () => {
  await notify.handleUpdate(msg({ text: 'apaga tudo' }, 1));
  assert.equal(asked.length, 0);
});

test('Telegram: /projeto mostra e troca o projeto da conversa', async () => {
  await notify.handleUpdate(msg({ text: '/projeto' }));
  assert.match(sentTexts().at(-1)!, /Geral/);
  await notify.handleUpdate(msg({ text: '/projeto xyz' }));
  assert.match(sentTexts().at(-1)!, /Não achei/);
  await notify.handleUpdate(msg({ text: '/projeto stoq' }));
  assert.match(sentTexts().at(-1)!, /Stoq/);
  assert.equal(asked.length, 0);
});

test('Telegram: botões de aprovação resolvem pela ponte', async () => {
  await notify.handleUpdate(cb('a:ap1'));
  await notify.handleUpdate(cb('r:ap2'));
  assert.deepEqual(resolved, ['ap1:true', 'ap2:false']);
  assert.match(sentTexts().join('\n'), /Aprovado/);
});

test('Telegram: botões de aprovação vermelha nunca são enviados', async () => {
  assert.equal(await notify.approvalButtons({ id: 'x', title: 'Excluir', rows: [], kind: 'destructive' }), null);
  assert.ok(await notify.approvalButtons({ id: 'y', title: 'Publicar', rows: [{ label: 'Agente', value: 'Dev' }] }));
  const kb = (state.tg('sendMessage').at(-1)!.body as { reply_markup: { inline_keyboard: { callback_data: string }[][] } }).reply_markup.inline_keyboard[0];
  assert.deepEqual(kb.map((b) => b.callback_data), ['a:y', 'r:y']);
});

test('busca: acha conversa e execução por palavra, sem acento e com prefixo', () => {
  assert.equal(search.ftsQuery('o domínio do Stoq'), '"dominio"* "do"* "stoq"*');
  brain.saveMessage('user', 'Renova o domínio do Stoqmate antes de sexta', 'text', 'stoq');
  brain.saveMessage('yui', 'Combinado, aviso na quinta.', 'text', 'stoq');
  db.prepare(`INSERT INTO runs(id, agent_id, project, instruction, task, state, created_at) VALUES('run-s1', 'devops', 'stoq', 'x', 'Renovar domínio', 'done', ?)`).run(now());
  db.prepare(`UPDATE runs SET result = 'Domínio renovado até 2027 na Hostinger.' WHERE id = 'run-s1'`).run();
  const hits = search.searchHistory('dominio stoq');
  assert.ok(hits.some((h) => h.kind === 'conversa' && h.snippet.includes('«')));
  assert.ok(search.searchHistory('hostinger').some((h) => h.kind === 'execucao' && h.id === 'run-s1'));
  assert.equal(search.searchHistory('hostinger', { project: 'outro' }).length, 0);
  db.prepare(`DELETE FROM runs WHERE id = 'run-s1'`).run();
  assert.equal(search.searchHistory('hostinger').length, 0);
});

test('insights: conta execuções, falhas e projetos do período', () => {
  db.prepare(`INSERT INTO runs(id, agent_id, project, instruction, task, state, origin, created_at, cost_usd) VALUES('i1', 'devops', 'stoq', 'x', 'Deploy', 'done', 'yui', ?, 0.5)`).run(now());
  db.prepare(`INSERT INTO runs(id, agent_id, project, instruction, task, state, origin, created_at, cost_usd) VALUES('i2', 'devops', NULL, 'x', 'Backup', 'failed', 'routine', ?, 0.2)`).run(now());
  const r = insights(7);
  assert.equal(r.execucoes, 2);
  assert.equal(r.falhas, 1);
  assert.equal(r.automaticas, 1);
  assert.deepEqual(r.falhas_recentes, ['Backup']);
  assert.equal(r.por_agente[0].execucoes, 2);
});

test('rotinas: overlap pula enquanto a anterior roda; missedSince acha o último horário perdido', () => {
  const r = rt.createRoutine({ name: 'Backup', cron: '0 3 * * *', agentId: 'backend', instruction: 'faz backup', deliver: ['telegram'], deliverMode: 'change' });
  assert.equal(rt.stillActive(r), false);
  db.prepare(`INSERT INTO runs(id, agent_id, project, instruction, task, state, routine_id, created_at) VALUES('rr1', 'devops', NULL, 'x', 'Backup', 'running', ?, ?)`).run(r.id, now());
  assert.equal(rt.stillActive(r), true);
  db.prepare(`UPDATE runs SET state = 'done' WHERE id = 'rr1'`).run();
  const to = Date.parse('2026-10-11T12:00:00Z');
  assert.ok(rt.missedSince('*/30 * * * *', to - 3600_000, to));
  assert.equal(rt.missedSince('0 3 1 1 *', to - 3600_000, to), null);
  const info = rt.routineInfos().find((x) => x.id === r.id)!;
  assert.deepEqual(info.deliver, ['telegram']);
  assert.equal(info.deliverMode, 'change');
  assert.equal(info.overlap, 'skip');
});

test('rotinas: entrega "só se mudou" não repete o mesmo resultado', async () => {
  const r = rt.createRoutine({ name: 'Preço', cron: '0 9 * * *', agentId: 'backend', instruction: 'olha preço', deliver: ['telegram'], deliverMode: 'change' });
  assert.equal(await rt.deliverResult(r.id, true, 'R$ 10'), true);
  assert.equal(await rt.deliverResult(r.id, true, 'R$ 10'), false);
  assert.equal(await rt.deliverResult(r.id, true, 'R$ 12'), true);
  rt.updateRoutine(r.id, { deliverMode: 'fail' });
  assert.equal(await rt.deliverResult(r.id, true, 'R$ 13'), false);
  assert.equal(await rt.deliverResult(r.id, false, 'erro'), true);
});
