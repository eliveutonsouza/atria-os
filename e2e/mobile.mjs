// Auditoria mobile (iPhone 14 e SE, WebKit + Chromium): nenhuma tela pode rolar para os lados,
// nenhum elemento visível passa da largura e nenhum campo tem fonte < 16px (zoom do Safari).
import { chromium, webkit, devices } from 'playwright';

const B = process.env.YUI_URL ?? 'https://yui.eliveutonsouza.cloud';
const SHOTS = process.env.YUI_SHOTS ?? '/e2e/shots/mobile';
const ROUTES = ['/', '/agents', '/runs', '/tools', '/claude', '/routines', '/app', '/app/ops', '/app/agents', '/app/agents/backend', '/app/runs', '/app/missions', '/app/workflows', '/app/workflows/post-instagram', '/app/schedule', '/app/projects', '/app/browser', '/app/terminal', '/app/claude', '/app/tools', '/app/inbox', '/app/infra', '/app/settings', '/app/vault', '/app/brain', '/app/company', '/app/company/documentos', '/app/company/busca'];
const OWN_SCROLL = '.xterm, .react-flow, [data-own-scroll]';
const fails = [];
let state = null; // sessão reaproveitada entre navegadores (o login tem limite anti-força-bruta)

for (const [engine, device] of [[webkit, 'iPhone 14'], [chromium, 'iPhone 14'], [webkit, 'iPhone SE']]) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...devices[device], ...(state ? { storageState: state } : {}) });
  const page = await ctx.newPage();
  if (!state && process.env.YUI_E2E_SESSION) {
    await ctx.addCookies([{ name: 'yui_sid', value: process.env.YUI_E2E_SESSION, url: B, httpOnly: true, secure: B.startsWith('https'), sameSite: 'Strict' }]);
    state = await ctx.storageState();
  }
  if (!state) {
    await page.goto(B + '/login');
    await page.fill('input[type=password]', process.env.YUI_E2E_PASSWORD);
    await page.keyboard.press('Enter');
    await page.waitForURL((u) => !u.pathname.includes('login'));
    state = await ctx.storageState();
  }
  for (const r of ROUTES) {
    await page.goto(B + r);
    await page.waitForTimeout(2200); // painel do Canvas anima ~550 ms
    const res = await page.evaluate((OWN) => {
      const vw = document.documentElement.clientWidth;
      const issues = [];
      window.scrollTo(300, 0);
      if (window.scrollX) issues.push(`janela rola x=${window.scrollX}`);
      window.scrollTo(0, 0);
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest(OWN)) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
        // só conta o que o dedo rola: overflow-x auto/scroll (hidden/clip não rolam no toque; campos têm rolagem própria)
        const userScroll = /(auto|scroll)/.test(cs.overflowX) && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
        if (userScroll && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 40) {
          const before = el.scrollLeft;
          el.scrollLeft = 300;
          if (el.scrollLeft !== before) issues.push(`rola-x ${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''} ${el.clientWidth}->${el.scrollWidth}`);
          el.scrollLeft = before;
        }
        const rc = el.getBoundingClientRect();
        if (rc.width > 0 && rc.right > vw + 1 && cs.position !== 'fixed' && !el.parentElement?.closest('[data-clip]')) {
          // só reporta o mais externo que estoura e que está na tela verticalmente
          const parentOver = el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 1;
          if (!parentOver && rc.top < innerHeight) issues.push(`estoura ${el.tagName.toLowerCase()} "${(el.innerText || '').trim().slice(0, 24).replace(/\s+/g, ' ')}" right=${Math.round(rc.right)}`);
        }
      }
      for (const i of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select')) {
        if (i.offsetParent && parseFloat(getComputedStyle(i).fontSize) < 16) issues.push(`campo <16px: ${i.getAttribute('aria-label') || i.placeholder || i.tagName}`);
      }
      return [...new Set(issues)].slice(0, 6);
    }, OWN_SCROLL);
    const tag = `${engine.name()}/${device}${r}`;
    if (res.length) fails.push({ tag, res });
    if (engine.name() === 'webkit' && device === 'iPhone 14') await page.screenshot({ path: `${SHOTS}/${r.replace(/\//g, '_') || 'root'}.png` });
  }
  await browser.close();
}
for (const f of fails) console.log(`✗ ${f.tag}\n   ${f.res.join('\n   ')}`);
console.log(`\n${fails.length ? fails.length + ' tela(s) com problema' : 'mobile ok: nenhuma rolagem lateral'}`);
process.exit(fails.length ? 1 : 0);
