// Regressão ponta a ponta do Yui Console (produção). Rodar via ./scripts-deploy.sh ou:
// docker run --rm --network host -v $PWD/e2e:/e2e -w /e2e -e YUI_E2E_PASSWORD=… mcr.microsoft.com/playwright:v1.63.0-noble \
//   bash -c "npm i -s playwright@1.63.0 >/dev/null 2>&1; node run.mjs"
import { chromium } from 'playwright';

const B = process.env.YUI_URL ?? 'https://yui.eliveutonsouza.cloud';
const SHOTS = process.env.YUI_SHOTS ?? '/e2e/shots';
const results = [];
const errors = [];

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, err: String(e?.message ?? e).split('\n')[0] });
    await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, '-')}.png` }).catch(() => {});
  }
}
const api = (path, init) => page.evaluate(([p, i]) => fetch(p, i).then(async (r) => ({ status: r.status, body: await r.text() })), [path, init ?? {}]);
const title = () => page.locator('section[aria-label] h1').first().innerText();
async function openRoute(path) {
  await page.goto(B + path);
  await page.waitForTimeout(1800);
}
async function chat(text) {
  const input = page.locator('input[aria-label="Mensagem para Yui"]');
  await input.fill(text);
  await input.press('Enter');
}

await check('login', async () => {
  // YUI_E2E_SESSION: token de sessão temporário (criado no banco pelo operador) em vez da senha
  if (process.env.YUI_E2E_SESSION) {
    await ctx.addCookies([{ name: 'yui_sid', value: process.env.YUI_E2E_SESSION, url: B, httpOnly: true, secure: B.startsWith('https'), sameSite: 'Strict' }]);
    await page.goto(B + '/');
    await page.waitForTimeout(1500);
    if (page.url().includes('login')) throw new Error('sessão inválida');
    return;
  }
  await page.goto(B + '/login');
  await page.fill('input[type=password]', process.env.YUI_E2E_PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });
});

await check('health/full', async () => {
  const r = await api('/api/health/full');
  const h = JSON.parse(r.body);
  for (const k of ['openai', 'github', 'dockerProxy', 'browser']) if (!h[k]) throw new Error(`${k} falso`);
  if (h.claudeAuth === 'none') throw new Error('claude sem auth');
});

for (const [path, name] of [
  ['/dashboard', 'dashboard'], ['/agents', 'agents'], ['/runs', 'runs'], ['/infra', 'infra'], ['/report', 'report'],
  ['/tools', 'tools'], ['/tools/mcp', 'tools-mcp'], ['/tools/skills', 'tools-skills'], ['/agents/backend', 'agent-detail'],
  ['/workflows', 'workflows'], ['/workflows/post-instagram', 'workflow-editor'], ['/routines', 'routines'], ['/claude', 'claude-guide'],
  ['/terminal/shell', 'terminal'],
]) {
  await check(`view ${name}`, async () => {
    await openRoute(path);
    const t = await title();
    if (!t || /em construção/i.test(t)) throw new Error(`título "${t}"`);
    const body = await page.locator('section[aria-label]').first().innerText();
    if (/em construção/i.test(body)) throw new Error('view stub');
    await page.screenshot({ path: `${SHOTS}/view-${name}.png` });
  });
}

await check('workflow editor tem nós e markdown', async () => {
  await openRoute('/workflows/post-instagram');
  const n = await page.locator('.react-flow__node').count();
  if (n < 4) throw new Error(`${n} nós`);
  const md = await api('/api/workflows/post-instagram');
  if (!JSON.parse(md.body).markdown?.includes('## 1.')) throw new Error('markdown sem passos');
});

await check('agente: config com MCP', async () => {
  const r = JSON.parse((await api('/api/agents/backend')).body);
  if (!Array.isArray(r.mcp) || !Array.isArray(r.skills)) throw new Error('AgentConfig incompleto');
});

await check('toolbox com ferramentas', async () => {
  const r = JSON.parse((await api('/api/toolbox')).body);
  const list = Array.isArray(r) ? r : r.items;
  if (!list || list.length < 15) throw new Error(`${list?.length} itens`);
});

await check('terminal shell executa', async () => {
  await openRoute('/terminal/shell');
  await page.waitForTimeout(2500);
  await page.locator('.yui-terminal').click();
  await page.keyboard.type('echo e2e-$((6*7))');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  if (!(await page.locator('.xterm-rows').innerText()).includes('e2e-42')) throw new Error('sem saída');
});

await check('pwa: manifest instalável + service worker', async () => {
  await openRoute('/');
  const cdp = await ctx.newCDPSession(page);
  const m = await cdp.send('Page.getAppManifest');
  if (m.errors.length) throw new Error(`manifest: ${JSON.stringify(m.errors)}`);
  const inst = await cdp.send('Page.getInstallabilityErrors');
  if (inst.installabilityErrors.length) throw new Error(`instalabilidade: ${JSON.stringify(inst.installabilityErrors)}`);
  const sw = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active);
  if (!sw) throw new Error('SW inativo');
  const apiCached = await page.evaluate(async () => {
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (r.url.includes('/api/')) return true;
    return false;
  });
  if (apiCached) throw new Error('/api em cache');
});

await check('palette ⌘K', async () => {
  await openRoute('/');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(400);
  if (!(await page.locator('[role=dialog][aria-label="Comandos"]').isVisible())) throw new Error('não abriu');
  await page.keyboard.press('Escape');
});

await check('chat: abre agentes', async () => {
  await openRoute('/');
  await chat('Mostra os agentes.');
  await page.waitForURL((u) => u.pathname === '/agents', { timeout: 45000 });
});

await check('chat: abre terminal', async () => {
  await openRoute('/');
  await chat('abre o terminal');
  await page.waitForURL((u) => u.pathname.startsWith('/terminal'), { timeout: 45000 });
});

await check('chat: gráfico sob medida', async () => {
  await openRoute('/');
  await chat('Faz um gráfico das execuções por agente.');
  await page.waitForURL((u) => u.pathname.startsWith('/views/'), { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/custom-chart.png` });
});

// ---------- v3: dashboard ----------
await check('sidebar abre na borda e entra no dashboard', async () => {
  await openRoute('/');
  await page.mouse.move(3, 450);
  await page.waitForTimeout(700);
  const nav = page.locator('nav[aria-label]').filter({ hasText: 'Visão geral' }).first();
  if (!(await nav.isVisible())) throw new Error('sidebar não apareceu');
  await nav.getByText('Agentes', { exact: true }).first().click();
  await page.waitForURL((u) => u.pathname === '/app/agents', { timeout: 8000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/v3-app-agents.png` });
});

await check('orb minimizado volta para a Yui', async () => {
  await openRoute('/app');
  await page.getByRole('button', { name: /Falar com a Yui/ }).first().click();
  await page.waitForURL((u) => u.pathname === '/', { timeout: 8000 });
});

for (const pg of ['', 'ops', 'agents', 'runs', 'missions', 'workflows', 'schedule', 'projects', 'browser', 'terminal', 'claude', 'tools', 'inbox', 'infra', 'settings', 'vault', 'brain']) {
  await check(`app /${pg || 'overview'}`, async () => {
    await openRoute(`/app${pg ? `/${pg}` : ''}`);
    await page.waitForTimeout(600);
    const body = await page.locator('body').innerText();
    if (/em construção/i.test(body)) throw new Error('stub');
    await page.screenshot({ path: `${SHOTS}/v3-${pg || 'overview'}.png` });
  });
}

await check('navegador ao vivo recebe frames', async () => {
  await openRoute('/app/browser');
  await page.waitForTimeout(4000);
  const ok = await page.evaluate(() => [...document.querySelectorAll('img')].some((i) => i.naturalWidth > 200 && /^(blob:|data:image)/.test(i.src)));
  if (!ok) throw new Error('sem frame');
});

await check('configurações + setup status', async () => {
  const st = JSON.parse((await api('/api/setup/status')).body);
  if (st.needsPassword) throw new Error('pede senha em produção');
  const s = JSON.parse((await api('/api/settings')).body);
  if (!s.values || !s.secrets) throw new Error('settings sem payload');
});

// ---------- Vault + VS Code + Cérebro ----------
const E2E_NOTE = `00-Inbox/E2E ${Date.now()}.md`;
await check('vault: API cria nota e indexa link/backlink', async () => {
  const r = await api('/api/vault/file', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: E2E_NOTE, text: '# E2E\n[[Yui Console]] #e2e' }) });
  if (r.status !== 200) throw new Error(`criar ${r.status} ${r.body}`);
  await page.waitForTimeout(800);
  const g = JSON.parse((await api('/api/vault/graph')).body);
  if (!g.links.some((l) => l.s === E2E_NOTE && l.t === '01-Projeto/Yui Console.md')) throw new Error('link não indexado');
  const b = JSON.parse((await api(`/api/vault/backlinks?path=${encodeURIComponent('01-Projeto/Yui Console.md')}`)).body);
  if (!b.some((x) => x.path === E2E_NOTE)) throw new Error('backlink ausente');
  const bad = await api('/api/vault/file?path=../../etc/passwd');
  if (bad.status !== 400) throw new Error(`path traversal ${bad.status}`);
});

await check('vault: /code exige login e serve o VS Code', async () => {
  const anon = await fetch(`${B}/code/`, { redirect: 'manual' });
  if (anon.status !== 302 && anon.status !== 401) throw new Error(`sem login ${anon.status}`);
  const r = await api('/code/');
  if (r.status !== 200 || !r.body.includes('workbench')) throw new Error(`logado ${r.status}`);
});

await check('vault: página com VS Code carregado e leitura', async () => {
  await openRoute(`/app/vault/${encodeURIComponent('01-Projeto/Vault & Cérebro.md')}`);
  const frame = page.frameLocator('iframe[title="VS Code"]');
  await frame.locator('.monaco-workbench').waitFor({ timeout: 45000 });
  await frame.locator('.tab', { hasText: 'Vault & Cérebro.md' }).first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${SHOTS}/vault-editor.png` });
  await page.locator('.vault-seg button', { hasText: 'Leitura' }).click();
  await page.locator('.vault-read a.vlink').first().waitFor({ timeout: 8000 });
  await page.screenshot({ path: `${SHOTS}/vault-read.png` });
  await page.locator('.vault-seg button', { hasText: 'Editor' }).click();
});

await check('cérebro: universo desenha e busca seleciona estrela', async () => {
  await openRoute('/app/brain');
  await page.waitForTimeout(1500);
  const lit = await page.evaluate(() => {
    const c = document.querySelector('canvas[aria-label="Universo de notas do vault"]');
    if (!c) return -1;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 120) n++;
    return n;
  });
  if (lit <= 20) throw new Error(`canvas vazio (${lit})`);
  const input = page.locator('input[placeholder^="Buscar estrela"]');
  await input.fill('Vault & Cérebro');
  await input.press('Enter');
  await page.locator('[aria-label="Nota selecionada"]').getByText('Vault & Cérebro').first().waitFor({ timeout: 8000 });
  await page.screenshot({ path: `${SHOTS}/brain.png` });
});

await check('cérebro: constelação abre', async () => {
  await openRoute(`/app/brain/${encodeURIComponent('01-Projeto/Vault & Cérebro.md')}`);
  await page.locator('canvas[aria-label^="Constelação da nota"]').waitFor({ timeout: 8000 });
  await page.locator('[aria-label="Prévia da nota"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/constellation.png` });
});

await check('vault: limpa nota de teste', async () => {
  const r = await api(`/api/vault/file?path=${encodeURIComponent(E2E_NOTE)}`, { method: 'DELETE' });
  if (r.status !== 204) throw new Error(`apagar ${r.status}`);
});

await check('mobile centro', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push(`mobile: ${e.message}`));
  await mp.goto(B + '/');
  await mp.waitForTimeout(2000);
  await mp.screenshot({ path: `${SHOTS}/mobile.png` });
  await m.close();
});

await check('sem erros de página', async () => {
  if (errors.length) throw new Error(errors.slice(0, 3).join(' | '));
});

await browser.close();
const fail = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name} (${r.ms}ms)${r.ok ? '' : ` — ${r.err}`}`);
console.log(`\n${results.length - fail.length}/${results.length} ok`);
process.exit(fail.length ? 1 : 0);
