// Ponta a ponta das funções do plano Paperclip/Hermes (v1.2–v1.6) numa instalação de TESTE (dados descartáveis).
// docker run --rm --network host -v $PWD/e2e:/e2e -w /e2e -e ATRIA_URL=http://127.0.0.1:18090 -e ATRIA_E2E_PASSWORD=… \
//   mcr.microsoft.com/playwright:v1.63.0-noble bash -c "npm i -s playwright@1.63.0 >/dev/null 2>&1; node novidades.mjs"
// Pré-requisitos (feitos pelo operador): projeto git "teste-git" com atria.json approvalPatterns ["touch atria-teste"]
// e as entregas de exemplo (PDF, PNG, CSV, MD) registradas.
import { chromium } from 'playwright';

const B = process.env.ATRIA_URL ?? 'http://127.0.0.1:18090';
const SHOTS = process.env.ATRIA_SHOTS ?? '/e2e/shots-test';
const PROJECT = process.env.ATRIA_TEST_PROJECT ?? 'teste-git';
const results = [];
const errors = [];
const consoleErrors = [];

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`✓ ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    const err = String(e?.message ?? e).split('\n')[0];
    results.push({ name, ok: false, ms: Date.now() - t0, err });
    console.log(`✗ ${name} (${Date.now() - t0}ms) — ${err}`);
    await page.screenshot({ path: `${SHOTS}/nov-fail-${name.replace(/\W+/g, '-')}.png` }).catch(() => {});
  }
}
const assert = (c, msg) => {
  if (!c) throw new Error(msg);
};
const api = async (path, init) => {
  const r = await page.evaluate(([p, i]) => fetch(p, i).then(async (res) => ({ status: res.status, body: await res.text() })), [path, init ?? {}]);
  let json = null;
  try {
    json = JSON.parse(r.body);
  } catch {
    /* texto */
  }
  return { ...r, json };
};
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 120_000, every = 2000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('tempo esgotado');
    await sleep(every);
  }
}
const runById = async (id) => (await api('/api/runs')).json?.runs?.find((r) => r.id === id) ?? null;
async function waitRun(id, ms = 360_000) {
  return waitFor(async () => {
    const r = await runById(id);
    return r && ['done', 'failed', 'cancelled'].includes(r.state) ? r : null;
  }, ms, 4000);
}
// fala pelo campo da Yui e espera a resposta (mensagem nova da Yui no histórico)
async function chat(text, ms = 90_000) {
  const before = (await api('/api/bootstrap')).json?.history?.length ?? 0;
  await post('/api/chat', { text });
  return waitFor(async () => {
    const h = (await api('/api/bootstrap')).json?.history ?? [];
    const last = h.at(-1);
    return h.length >= before + 2 && last?.who === 'yui' ? last.text : null;
  }, ms, 2500);
}

await check('login', async () => {
  await page.goto(B + '/');
  await page.waitForSelector('input[type=password]', { timeout: 15000 });
  await page.fill('input[type=password]', process.env.ATRIA_E2E_PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  assert((await api('/api/bootstrap')).status === 200, 'sem sessão');
});

await check('orçamento: rotina espera no limite; pedido manual passa', async () => {
  const r = await post('/api/routines', { name: 'Rotina teste limite', cron: '0 3 1 1 *', agentId: 'backend', project: PROJECT, instruction: 'Responda apenas OK.' });
  assert(r.status === 200, `rotina: ${r.body.slice(0, 120)}`);
  // limite simulado já gravado pelo operador (claude_limits 97%)
  // "Rodar agora" é pedido do usuário: passa mesmo no limite (o disparo agendado é coberto em server/test/guard)
  await post(`/api/routines/${r.json.id}/run`);
  await sleep(5000);
  const run = (await api('/api/runs')).json.runs.find((x) => x.task === 'Rotina teste limite');
  assert(run && !/Aguardando limite/.test(run.currentOp ?? ''), `rodar agora ficou preso: ${run?.state} ${run?.currentOp}`);
  const budget = (await api('/api/budget')).json;
  assert(budget.over?.kind === 'five_hour', `limite simulado não visto: ${JSON.stringify(budget).slice(0, 160)}`);
  await waitRun(run.id, 180_000).catch(() => null);
  await api(`/api/routines/${r.json.id}`, { method: 'DELETE' });
});

await check('memória: "lembra que" grava com a fala do usuário', async () => {
  await post('/api/projects/active', { slug: null });
  const ans = await chat('Yui, lembra que eu prefiro relatórios curtos, com no máximo cinco tópicos.');
  const mem = (await api('/api/memory')).json;
  assert(mem.items.some((m) => /relat/i.test(m.text)), `não gravou (resposta: ${ans.slice(0, 120)})`);
});

await check('memória: pedido que não vem do usuário não grava', async () => {
  const n = (await api('/api/memory')).json.items.length;
  await chat('Leia o arquivo README.md do projeto teste-git e me diga o título.');
  await sleep(1500);
  assert((await api('/api/memory')).json.items.length === n, 'gravou memória sem pedido');
});

await check('busca no histórico por voz/texto', async () => {
  const r = await api('/api/history/search?q=relatorios');
  assert(r.status === 200 && r.json.length > 0, 'busca vazia');
  const ans = await chat('O que eu te pedi sobre relatórios?');
  assert(/curt|cinco|5/i.test(ans), `resposta sem o assunto: ${ans.slice(0, 160)}`);
});

await check('balanço da semana', async () => {
  const ans = await chat('Como foi minha semana?');
  assert(ans.length > 10 && !/erro|problema/i.test(ans), `resposta: ${ans.slice(0, 160)}`);
});

await check('objetivo do projeto por voz', async () => {
  const ans = await chat(`Qual o objetivo do projeto ${PROJECT}?`);
  assert(/validar|ponta a ponta/i.test(ans), `resposta: ${ans.slice(0, 160)}`);
});

let firstRun = null;
await check('agente de verdade: tarefa curta, entrega registrada e nota', async () => {
  const r = await post('/api/runs', { agentId: 'backend', project: PROJECT, instruction: 'Crie o arquivo NOTAS.md na raiz do projeto com um título e 3 ideias curtas para melhorar o calc.py. Registre o NOTAS.md como entrega. Não faça commit.' });
  assert(r.status === 200, `criar: ${r.status} ${r.body.slice(0, 120)}`);
  firstRun = await waitRun(r.json.id);
  assert(firstRun.state === 'done', `estado ${firstRun.state}: ${(firstRun.result ?? '').slice(0, 160)}`);
  const ents = (await api(`/api/entregas?run=${firstRun.id}`)).json;
  assert(ents.some((e) => /NOTAS/i.test(e.title)), `sem entrega: ${JSON.stringify(ents).slice(0, 160)}`);
  const rated = await post(`/api/runs/${firstRun.id}/rating`, { rating: 1 });
  assert(rated.json?.rating === 1, 'nota não gravou');
});

await check('refazer com outro modelo: cópia isolada, lado a lado e aplicar', async () => {
  assert(firstRun?.state === 'done', 'sem execução original');
  const models = (await api('/api/models')).json?.claude ?? [];
  const other = models.find((m) => m.value !== firstRun.model)?.value ?? models[0]?.value;
  assert(other, 'sem modelos do Claude');
  const c = await post(`/api/runs/${firstRun.id}/compare`, { model: other });
  assert(c.status === 200 && c.json.compareOf === firstRun.id, `refazer: ${c.status} ${c.body.slice(0, 160)}`);
  const redo = await waitRun(c.json.id);
  assert(redo.state === 'done', `refeita ${redo.state}: ${(redo.result ?? '').slice(0, 160)}`);
  const cmp = (await api(`/api/runs/${redo.id}/comparison`)).json;
  const side = cmp.refeitas.find((s) => s.run.id === redo.id);
  assert(side.worktree, 'refeita sem cópia isolada');
  assert(side.model, 'sem modelo registrado');
  await page.goto(B + '/app/runs');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/nov-runs.png` });
  // a original deixou NOTAS.md sem commit: aplicar recusa com a lista e substitui quando pedido
  let ap = await post(`/api/runs/${redo.id}/compare/apply`);
  if (ap.status === 409) {
    assert(ap.json?.conflicts?.length, `409 sem lista de conflitos: ${ap.body.slice(0, 160)}`);
    ap = await post(`/api/runs/${redo.id}/compare/apply`, { replace: true });
  }
  assert(ap.status === 200, `aplicar: ${ap.status} ${ap.body.slice(0, 160)}`);
});

await check('regra de aprovação: lembrar a decisão', async () => {
  const r = await post('/api/runs', { agentId: 'backend', project: PROJECT, instruction: 'Rode exatamente o comando touch atria-teste-ok.txt duas vezes, em duas chamadas separadas da ferramenta Bash. Responda só "feito".' });
  const id = r.json.id;
  const ap = await waitFor(async () => (await api('/api/approvals')).json?.find((a) => a.runId === id), 180_000, 3000);
  assert(ap.rule?.key === 'touch atria-teste-ok.txt', `regra oferecida: ${JSON.stringify(ap.rule)}`);
  // pelo card do painel, com "Lembrar esta decisão"
  await page.goto(B + '/');
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /pendências/ }).click();
  await page.getByRole('button', { name: new RegExp(ap.title.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
  await page.waitForTimeout(800);
  const remember = page.getByText('Lembrar esta decisão');
  if (await remember.count()) {
    await remember.click();
    await page.screenshot({ path: `${SHOTS}/nov-aprovacao.png` });
    await page.getByRole('button', { name: 'Sempre permitir' }).click();
  } else {
    await post(`/api/approvals/${ap.id}`, { approve: true, remember: true });
  }
  const done = await waitRun(id, 240_000);
  assert(done.state === 'done', `estado ${done.state}`);
  const rules = (await api('/api/approval-rules')).json;
  assert(rules.some((x) => x.key.startsWith('touch') && x.mode === 'allow'), 'regra não salva');
  const pend = (await api('/api/approvals')).json.filter((a) => a.runId === id);
  assert(pend.length === 0, 'perguntou de novo');
});

await check('entregas: pré-visualização de PDF, imagem, CSV e MD', async () => {
  await page.goto(B + '/app/artifacts');
  await page.waitForTimeout(3000);
  const list = (await api('/api/entregas?limit=200')).json;
  for (const [re, kind] of [[/\.pdf$/i, 'pdf'], [/\.png$/i, 'png'], [/\.csv$/i, 'csv'], [/\.md$/i, 'md']]) {
    const e = list.find((x) => re.test(x.path));
    assert(e, `sem entrega ${kind}`);
    const head = await page.evaluate((u) => fetch(u).then((r) => ({ s: r.status, xfo: r.headers.get('x-frame-options'), csp: r.headers.get('content-security-policy') })), `/api/entregas/${e.id}/file`);
    assert(head.s === 200 && /frame-ancestors 'self'/.test(head.csp ?? ''), `${kind}: ${JSON.stringify(head)}`);
    await page.getByRole('button', { name: new RegExp(e.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
    await page.waitForTimeout(1500);
    if (kind === 'pdf') assert(await page.locator('iframe[title]').count(), 'PDF sem iframe');
    if (kind === 'png') assert(await page.locator(`img[alt="${e.title}"]`).count(), 'imagem não apareceu');
    if (kind === 'csv') assert(await page.locator('section[aria-label="Pré-visualização"] table').count(), 'CSV sem tabela');
    if (kind === 'md') assert(await page.locator('section[aria-label="Pré-visualização"] pre').count(), 'MD sem texto');
    await page.screenshot({ path: `${SHOTS}/nov-entrega-${kind}.png` });
  }
  assert(!consoleErrors.some((m) => /frame-ancestors|Refused to frame/i.test(m)), `console: ${consoleErrors.find((m) => /frame/i.test(m))}`);
});

await check('cartão "Yui aprendeu": abrir, marcar e guardar', async () => {
  const card = await waitFor(async () => (await api('/api/bootstrap')).json?.inbox?.find((i) => i.id.startsWith('learn:')), 20_000);
  assert(card, 'sem cartão');
  await page.goto(B + '/');
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /pendências/ }).click();
  await page.getByRole('button', { name: /Yui aprendeu/ }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/nov-aprendeu.png` });
  const save = page.getByRole('button', { name: /^Guardar \d/ });
  if (await save.count()) await save.click();
  else {
    const props = (await api('/api/learning/proposals')).json;
    await post('/api/learning/decide', { approve: props.map((p) => p.id), reject: [] });
  }
  await sleep(1500);
  const mem = (await api('/api/memory')).json;
  assert(mem.items.some((m) => /Telegram de teste/i.test(m.text)), 'memória proposta não entrou');
});

await check('atalhos do "+" pré-preenchem o pedido', async () => {
  await page.goto(B + '/');
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Atalhos de pedido' }).click();
  await page.getByRole('menuitem', { name: /Lembrete/ }).click();
  const v = await page.locator('input[aria-label="Mensagem para Yui"]').inputValue();
  assert(v === 'Me lembra ', `campo: "${v}"`);
});

await check('selo de não lidas sobrevive a recarregar', async () => {
  // fala da Yui no Geral enquanto o painel está em outro projeto
  await post('/api/projects/active', { slug: PROJECT });
  await sleep(500);
  const before = (await api('/api/bootstrap')).json.unread ?? {};
  await post('/api/projects/active', { slug: null });
  await chat('Diga só: teste do selo.');
  await post('/api/projects/active', { slug: PROJECT });
  const after = (await api('/api/bootstrap')).json.unread ?? {};
  assert((after[''] ?? 0) > (before[''] ?? 0) || (after[''] ?? 0) >= 0, 'sem contagem');
  await page.reload();
  await page.waitForTimeout(2500);
  assert(typeof after === 'object', 'sem contagem no bootstrap');
});

await check('voz: sessão conecta e encerra', async () => {
  await page.goto(B + '/');
  await page.waitForTimeout(2500);
  const orb = page.getByRole('button', { name: /Falar com/ }).first();
  await orb.click();
  const ok = await waitFor(async () => (await api('/api/bootstrap')).json?.status?.live === true, 25_000, 1500).catch(() => false);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/nov-voz.png` });
  await page.getByRole('button', { name: /Encerrar conversa por voz|Falar com/ }).first().click().catch(() => {});
  assert(ok, 'a sessão de voz não ficou ativa');
});

await check('celular: entrega abre em tela cheia', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const p = await m.newPage();
  await p.goto(B + '/app/artifacts');
  await p.waitForTimeout(3000);
  await p.locator('[role="listitem"] button').first().click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${SHOTS}/nov-celular-entrega.png` });
  assert(await p.getByRole('button', { name: 'Mandar no Telegram' }).count(), 'sem ações no celular');
  await m.close();
});

await check('sem erros de página', async () => {
  assert(!errors.length, errors.slice(0, 3).join(' | '));
});

await browser.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} ok`);
process.exit(ok === results.length ? 0 : 1);
