// Auditoria mobile/tablet (iPhone 14 em pé e deitado, SE, iPads; WebKit + Chromium): nenhuma tela pode rolar
// para os lados, nenhum elemento visível passa da largura, nenhum campo tem fonte < 16px (zoom do Safari),
// o cabeçalho do celular cabe em até 2 linhas e o fim da página não fica sob a barra de abas.
// Alvos de toque < 40px viram aviso (não reprovam).
import { chromium, webkit, devices } from 'playwright';

const B = process.env.ATRIA_URL ?? 'https://atria.eliveutonsouza.cloud';
const SHOTS = process.env.ATRIA_SHOTS ?? '/e2e/shots';
const ROUTES = ['/app/more', '/app/usage', '/app/reminders', '/app/missions/new', '/', '/agents', '/runs', '/tools', '/claude', '/routines', '/app', '/app/ops', '/app/agents', '/app/agents/backend', '/app/runs', '/app/missions', '/app/workflows', '/app/workflows/post-instagram', '/app/schedule', '/app/projects', '/app/browser', '/app/terminal', '/app/claude', '/app/tools', '/app/skills', '/app/skills/installed', '/app/inbox', '/app/infra', '/app/settings', '/app/vault', '/app/brain', '/app/company', '/app/company/documentos', '/app/company/busca', '/app/help', '/app/help/guia%3Aworkflows', '/app/help/resultados', '/app/help/faq'];
const OWN_SCROLL = '.xterm, .react-flow, [data-own-scroll]';
const fails = [];
const warns = [];
// [motor, aparelho, pasta dos screenshots | null]
const DEVICES = [
  [webkit, 'iPhone 14', 'iphone14'],
  [webkit, 'iPhone 14 landscape', 'iphone14-deitado'],
  [chromium, 'iPhone 14', null],
  [webkit, 'iPhone SE', null],
  [webkit, 'iPad (gen 7)', 'ipad'],
  [webkit, 'iPad Pro 11 landscape', 'ipad-deitado'],
].filter(([, d]) => !process.env.ATRIA_DEVICES || process.env.ATRIA_DEVICES.split(',').includes(d));
let state = null; // sessão reaproveitada entre navegadores (o login tem limite anti-força-bruta)

for (const [engine, device, shotDir] of DEVICES) {
  if (shotDir) await import('node:fs').then((fs) => fs.mkdirSync(`${SHOTS}/${shotDir}`, { recursive: true }));
  const browser = await engine.launch();
  // http local (container de teste): CSP manda upgrade-insecure-requests, então ignora a CSP
  const ctx = await browser.newContext({ ...devices[device], ...(B.startsWith('http://') ? { bypassCSP: true } : {}), ...(state ? { storageState: state } : {}) });
  if (B.startsWith('http://')) {
    // tira CSP/HSTS das respostas (o WebKit insiste em subir para https mesmo com bypassCSP)
    await ctx.route('**/*', async (route) => {
      if (route.request().url().includes('/api/events')) return route.continue(); // SSE não termina
      const res = await route.fetch();
      const headers = { ...res.headers() };
      delete headers['content-security-policy'];
      delete headers['strict-transport-security'];
      await route.fulfill({ response: res, headers });
    });
  }
  const page = await ctx.newPage();
  if (!state && process.env.ATRIA_E2E_SESSION) {
    await ctx.addCookies([{ name: 'atria_sid', value: process.env.ATRIA_E2E_SESSION, url: B, httpOnly: true, secure: B.startsWith('https'), sameSite: 'Strict' }]);
    state = await ctx.storageState();
  }
  if (!state) {
    await page.goto(B + '/login');
    await page.fill('input[type=password]', process.env.ATRIA_E2E_PASSWORD);
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
        // faixas roláveis de chips/abas (.h-scroll) são intencionais: nem elas nem os filhos contam
        if (el.closest('.h-scroll')) continue;
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
      const phone = document.documentElement.classList.contains('is-phone');
      const main = document.querySelector('main.app-main');
      // celular: cabeçalho da página em no máximo 2 linhas (título + ações cabem numa faixa)
      const head = main?.querySelector(':scope > header');
      if (phone && head && head.getBoundingClientRect().height > 110) issues.push(`cabeçalho alto ${Math.round(head.getBoundingClientRect().height)}px`);
      // celular: o fim da página tem de ficar acima da barra de abas
      const tabs = document.querySelector('nav[aria-label="Navegação principal"]');
      if (phone && main && tabs) {
        main.scrollTop = main.scrollHeight;
        // telas de tela cheia (Cérebro: canvas absoluto) cuidam do próprio espaço
        const last = [...main.children].filter((c) => c.getBoundingClientRect().height > 0 && getComputedStyle(c).position !== 'absolute').at(-1);
        const top = tabs.getBoundingClientRect().top;
        if (last && last.getBoundingClientRect().bottom > top + 1) issues.push(`fim da página sob a barra de abas (${Math.round(last.getBoundingClientRect().bottom - top)}px)`);
        main.scrollTop = 0;
      }
      // alvos de toque pequenos (aviso)
      const small = [];
      if (document.documentElement.classList.contains('is-coarse')) {
        for (const b of document.querySelectorAll('button, [role=button], select, a.app-btn')) {
          if (b.closest(OWN) || !b.offsetParent) continue;
          const r = b.getBoundingClientRect();
          if (r.width && r.height && r.bottom > 0 && r.top < innerHeight && Math.min(r.width, r.height) < 40) small.push((b.getAttribute('aria-label') || b.innerText || b.tagName).trim().slice(0, 20));
        }
      }
      return { issues: [...new Set(issues)].slice(0, 6), small: [...new Set(small)] };
    }, OWN_SCROLL);
    const tag = `${engine.name()}/${device}${r}`;
    if (res.issues.length) fails.push({ tag, res: res.issues });
    if (res.small.length) warns.push(`${tag}: ${res.small.length} alvo(s) <40px (${res.small.slice(0, 4).join(', ')})`);
    if (shotDir && engine.name() === 'webkit') await page.screenshot({ path: `${SHOTS}/${shotDir}/${r.replace(/\//g, '_') || 'root'}.png` });
  }
  await browser.close();
}
if (warns.length) console.log(`avisos de toque:\n  ${warns.slice(0, 40).join('\n  ')}\n`);
for (const f of fails) console.log(`✗ ${f.tag}\n   ${f.res.join('\n   ')}`);
console.log(`\n${fails.length ? fails.length + ' tela(s) com problema' : 'mobile ok: nenhuma rolagem lateral'}`);
process.exit(fails.length ? 1 : 0);
