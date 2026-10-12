// Pente fino da UI (v1.7.0) numa instalação de TESTE: erros visíveis, sem clique duplo, confirmação antes de
// ações perigosas, edição não salva protegida, sem inglês na tela e foco visível.
// docker run --rm --network host -v $PWD/e2e:/e2e -w /e2e -e ATRIA_URL=http://127.0.0.1:18090 -e ATRIA_E2E_PASSWORD=… \
//   mcr.microsoft.com/playwright:v1.63.0-noble bash -c "npm i -s playwright@1.63.0 >/dev/null 2>&1; node ui-pente.mjs"
import { chromium } from 'playwright';

const B = process.env.ATRIA_URL ?? 'http://127.0.0.1:18090';
const SHOTS = process.env.ATRIA_SHOTS ?? '/e2e/shots-test';
const results = [];
const errors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✓ ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    const err = String(e?.message ?? e).split('\n')[0];
    results.push({ name, ok: false, err });
    console.log(`✗ ${name} (${Date.now() - t0}ms) — ${err}`);
    await page.screenshot({ path: `${SHOTS}/ui-fail-${name.replace(/\W+/g, '-')}.png` }).catch(() => {});
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
const dialog = () => page.locator('[role=alertdialog], [role=dialog][aria-modal=true]').last();

await check('login: servidor fora não vira "Senha incorreta"', async () => {
  const p2 = await ctx.newPage();
  await p2.route('**/api/auth/login', (r) => r.fulfill({ status: 502, body: 'Bad Gateway' }));
  await p2.goto(B + '/login');
  await p2.waitForSelector('input[type=password]', { timeout: 15000 });
  await p2.fill('input[type=password]', 'qualquer');
  await p2.keyboard.press('Enter');
  await p2.waitForTimeout(1500);
  const txt = await p2.locator('body').innerText();
  assert(!/senha incorreta/i.test(txt), 'mostrou "Senha incorreta" com servidor fora');
  assert(/não respondeu|servidor|tente de novo/i.test(txt), `sem mensagem de servidor: ${txt.slice(0, 200)}`);
  await p2.close();
});

await check('login', async () => {
  await page.goto(B + '/');
  await page.waitForSelector('input[type=password]', { timeout: 15000 });
  await page.fill('input[type=password]', process.env.ATRIA_E2E_PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  assert((await api('/api/bootstrap')).status === 200, 'sem sessão');
});

const ENGLISH = /Live operations|\bTIMELINE\b|\bTimeline\b|\bRUNNING\b|\bQUEUED\b|\bBACKGROUND\b|\bArtifacts\b|System overview|Infrastructure|Overnight|Agent network|Live preview|Backlinks|Morning brief|Rotinas de trabalho|\(done\)|\(failed\)|Qdrant|Embeddings/;
await check('sem inglês/jargão nas páginas principais', async () => {
  const bad = [];
  for (const p of ['', 'ops', 'agents', 'runs', 'artifacts', 'inbox', 'missions', 'workflows', 'schedule', 'projects', 'company', 'vault', 'skills', 'tools', 'settings', 'usage']) {
    await page.goto(`${B}/app${p ? `/${p}` : ''}`);
    await page.waitForTimeout(1800);
    const m = (await page.locator('.app-main').first().innerText()).match(ENGLISH);
    if (m) bad.push(`${p || 'início'}: "${m[0]}"`);
  }
  assert(!bad.length, bad.join(' · '));
});

await check('menus: "Início" em todo lugar', async () => {
  await page.goto(B + '/app');
  await page.waitForTimeout(1500);
  const txt = await page.locator('nav, aside').allInnerTexts();
  assert(!txt.join(' ').includes('Visão geral'), 'ainda aparece "Visão geral" no menu');
});

await check('Aprovações: erro de rede mostra erro, não "nada pendente"', async () => {
  await page.route('**/api/approvals*', (r) => r.abort());
  await page.goto(B + '/app/inbox');
  await page.waitForTimeout(2500);
  const txt = await page.locator('.app-main').first().innerText();
  await page.unroute('**/api/approvals*');
  assert(!/Nada precisa de você/.test(txt), 'mostrou vazio com erro');
  assert(/Não consegui|Tentar de novo/.test(txt), `sem estado de erro: ${txt.slice(0, 160)}`);
  await page.screenshot({ path: `${SHOTS}/ui-inbox-erro.png` });
});

await check('memória: "Esquecer" pede confirmação; Cancelar mantém', async () => {
  const r = await post('/api/memory', { text: 'Teste do pente fino: prefere café sem açúcar.' });
  assert(r.status < 300, `memória: ${r.body.slice(0, 120)}`);
  await page.goto(B + '/app/settings/account');
  await page.waitForTimeout(2000);
  const row = page.locator('text=prefere café sem açúcar').first();
  await row.scrollIntoViewIfNeeded();
  await page.locator('button:has-text("Esquecer")').first().click();
  await dialog().waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${SHOTS}/ui-confirmar-esquecer.png` });
  await dialog().locator('button', { hasText: /Cancelar|Voltar/ }).first().click();
  await page.waitForTimeout(800);
  const still = (await api('/api/memory')).json.items.some((m) => /café sem açúcar/.test(m.text));
  assert(still, 'apagou mesmo cancelando');
  // erro ao esquecer aparece como aviso
  await page.route('**/api/memory/*', (rt) => (rt.request().method() === 'DELETE' ? rt.fulfill({ status: 500, body: '{"error":"falha simulada"}' }) : rt.continue()));
  await page.locator('button:has-text("Esquecer")').first().click();
  await dialog().locator('button', { hasText: /Esquecer|Confirmar|Apagar|Remover/ }).last().click();
  await page.locator('[role=alert]').filter({ hasText: /falha simulada|Não consegui/ }).first().waitFor({ timeout: 5000 });
  await page.unroute('**/api/memory/*');
  const id = (await api('/api/memory')).json.items.find((m) => /café sem açúcar/.test(m.text))?.id;
  if (id) await api(`/api/memory/${id}`, { method: 'DELETE' });
});

await check('"+ Novo agente" com clique duplo cria um só', async () => {
  const before = (await api('/api/agents')).json;
  const n0 = (before.agents ?? before).length;
  await page.goto(B + '/app/agents');
  await page.waitForTimeout(1500);
  const btn = page.locator('button', { hasText: 'Novo agente' }).first();
  await btn.dblclick();
  await page.waitForTimeout(2500);
  const after = (await api('/api/agents')).json;
  const list = after.agents ?? after;
  const created = list.length - n0;
  for (const a of list.filter((x) => !(before.agents ?? before).some((y) => y.id === x.id))) await api(`/api/agents/${a.id}`, { method: 'DELETE' });
  assert(created <= 1, `criou ${created} agentes`);
});

await check('agente: sair com edição não salva pergunta', async () => {
  const list = (await api('/api/agents')).json;
  const a = (list.agents ?? list)[0];
  await page.goto(`${B}/app/agents/${a.id}`);
  await page.waitForTimeout(2000);
  await page.locator('.app-main button, .app-main [role=tab]').filter({ hasText: /^Configuração$/ }).first().click();
  await page.waitForTimeout(800);
  const field = page.locator('.app-main textarea:visible, .app-main input[type=text]:visible').first();
  await field.click({ timeout: 10000 });
  await page.keyboard.type(' teste');
  await page.waitForTimeout(500);
  // sai escolhendo outro agente na lista (troca de tela)
  await page.locator('.app-main :text-is("Backend"):visible').first().click({ timeout: 5000 });
  await page.waitForTimeout(800);
  const asked = await dialog().isVisible().catch(() => false);
  if (asked) await dialog().locator('button', { hasText: /Continuar editando|Cancelar/ }).first().click();
  // descarta a edição para não deixar lixo
  await page.reload();
  assert(asked, 'saiu sem perguntar');
});

await check('foco visível com Tab nos campos', async () => {
  await page.goto(B + '/app/settings/account');
  await page.waitForTimeout(1500);
  await page.locator('main input').first().focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const style = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return { tag: el.tagName, outline: cs.outlineStyle, ow: cs.outlineWidth, shadow: cs.boxShadow, border: cs.borderColor };
  });
  assert(style.outline !== 'none' || (style.shadow && style.shadow !== 'none'), `sem foco visível: ${JSON.stringify(style)}`);
});

await check('Execuções: textos em português', async () => {
  await page.goto(B + '/app/runs');
  await page.waitForTimeout(1500);
  const txt = await page.locator('.app-main').first().innerText();
  assert(!/RUNNING|QUEUED|TIMELINE/.test(txt), 'textos em inglês');
});

await check('sem erros de página', async () => {
  assert(!errors.length, errors.slice(0, 3).join(' | '));
});

const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} ok`);
await browser.close();
process.exit(ok === results.length ? 0 : 1);
