import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import type { ServerEvent } from '../../shared/protocol.ts';

// Verificação humana no navegador dos agentes: detector sobre HTMLs de exemplo e pausa do agente com CDP falso.
const root = mkdtempSync(join(tmpdir(), 'atria-chl-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });

const { db, now } = await import('../src/db.ts');
const { onEmit } = await import('../src/bus.ts');
const { agentOptions, registerAgentOptions } = await import('../src/extensions.ts');
const { getRun, inboxItems } = await import('../src/runs.ts');
const chl = await import('../src/browserChallenge.ts');
const { detectChallenge, configureChallenge, challengeState } = chl;

// ---------- detector ----------

const CLOUDFLARE = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="refresh" content="390"></head>
<body><div class="main-wrapper" role="main"><div class="main-content"><h1 class="zone-name-title h1">www.exemplo.com</h1>
<h2 class="h2" id="challenge-running">Checking if the site connection is secure</h2><div id="challenge-stage"></div>
<div id="challenge-body-text" class="core-msg spacer">www.exemplo.com needs to review the security of your connection before proceeding.</div></div></div>
<script>(function(){window._cf_chl_opt={cvId: '3',cZone: "www.exemplo.com",cType: 'managed'};}());</script></body></html>`;

const TURNSTILE = `<html><head><title>Verificação</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script></head>
<body><main><h1>Verifique se você é humano</h1><p>Conclua a verificação abaixo para continuar.</p>
<div class="cf-turnstile" data-sitekey="0x4AAAAAAA"><iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv0/0/abc/0x4AAAAAAA/auto/normal" style="width:300px;height:65px"></iframe></div></main></body></html>`;

const TURNSTILE_LOGIN = `<html><head><title>Entrar · Loja Exemplo</title></head><body><header><nav>Início Produtos Ofertas Contato Minha conta</nav></header>
<main><h1>Entrar na sua conta</h1><form><label>E-mail <input name="email"></label><label>Senha <input type="password" name="senha"></label>
<div class="cf-turnstile" data-sitekey="0x4AAA"></div><button>Entrar</button></form>
<p>Ainda não tem conta? Cadastre-se e receba ofertas exclusivas, frete grátis na primeira compra e acompanhe seus pedidos em tempo real.</p></main>
<footer>Loja Exemplo LTDA · CNPJ 00.000.000/0001-00 · Política de privacidade · Termos de uso · Trocas e devoluções · Atendimento de segunda a sexta</footer></body></html>`;

const RECAPTCHA_GATE = `<html><head><title>Confirme que você não é um robô</title></head><body><h2>Confirme que você não é um robô</h2>
<form method="post"><div class="g-recaptcha" data-sitekey="6Lc"><iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?ar=1&amp;k=6Lc&amp;co=aHR0&amp;hl=pt-BR&amp;v=abc&amp;size=normal" width="304" height="78"></iframe></div></form></body></html>`;

const GOOGLE_SORRY = `<html><head><title>https://www.google.com/search?q=atria</title></head><body><div>Our systems have detected unusual traffic from your computer network.</div>
<div class="g-recaptcha"><iframe src="https://www.google.com/recaptcha/api2/anchor?k=6Le&amp;size=normal"></iframe></div></body></html>`;

const RECAPTCHA_INVISIBLE = `<html><head><title>Contato · Clínica Fisioforma</title><script src="https://www.google.com/recaptcha/api.js?render=6Ld"></script></head>
<body><header><nav>Início Tratamentos Equipe Convênios Contato</nav></header><main><h1>Fale com a gente</h1>
<p>Agende sua avaliação de fisioterapia, pilates ou RPG. Respondemos em até um dia útil. Atendemos de segunda a sábado, das 7h às 20h.</p>
<form><input name="nome"><input name="telefone"><textarea name="mensagem"></textarea><button class="g-recaptcha" data-sitekey="6Ld" data-size="invisible">Enviar</button></form></main>
<div class="grecaptcha-badge" style="width:256px;height:60px"><iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?ar=1&amp;k=6Ld&amp;size=invisible" width="256" height="60"></iframe></div>
<div style="visibility: hidden; position: absolute;"><iframe title="o desafio reCAPTCHA expira em dois minutos" src="https://www.google.com/recaptcha/api2/bframe?hl=pt-BR&amp;v=abc&amp;k=6Ld"></iframe></div>
<footer>Rua Exemplo, 123 · Centro · (11) 0000-0000 · Política de privacidade</footer></body></html>`;

const HCAPTCHA = `<html><head><title>Security check</title><script src="https://js.hcaptcha.com/1/api.js" async defer></script></head>
<body><p>Please complete the security check to continue.</p><div class="h-captcha" data-sitekey="10000000-ffff"><iframe src="https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox&amp;id=0"></iframe></div></body></html>`;

const AKAMAI = `<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY><H1>Access Denied</H1>
You don't have permission to access "http&#58;&#47;&#47;www&#46;loja&#46;com&#47;" on this server.<P>Reference&#32;&#35;18&#46;2b3c4d5e&#46;1700000000&#46;abc123
<P>https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;18&#46;2b3c4d5e</P></BODY></HTML>`;

const PERIMETERX = `<html><head><title>Access to this page has been denied</title></head><body><div id="px-captcha"></div><p>Press &amp; Hold to confirm you are a human (and not a bot).</p>
<script src="https://captcha.px-cdn.net/PXabc/captcha.js"></script></body></html>`;

const DATADOME = `<html><head><title>exemplo.com</title></head><body><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=abc&amp;hash=def" width="100%" height="100%"></iframe></body></html>`;

const NORMAL = `<html><head><title>Notícias de tecnologia · Portal Exemplo</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></head>
<body><header><nav>Início Tecnologia Ciência Games</nav></header><main><article><h1>Como funcionam os CAPTCHAs</h1>
<p>Sites usam verificações como "Verify you are human" para separar pessoas de robôs. Neste artigo explicamos como o reCAPTCHA, o hCaptcha e o Turnstile funcionam, por que aparecem mais para quem usa VPN e o que fazer quando eles não somem.</p>
${'<p>Parágrafo longo de conteúdo do artigo que continua explicando detalhes técnicos e históricos sobre verificações humanas na web. </p>'.repeat(20)}
</article></main><footer>Portal Exemplo · Todos os direitos reservados</footer></body></html>`;

test('detector: desafios conhecidos', () => {
  assert.deepEqual(detectChallenge({ url: 'https://www.exemplo.com/produtos', title: 'Just a moment...', html: CLOUDFLARE }), { kind: 'cloudflare', site: 'exemplo.com' });
  assert.deepEqual(detectChallenge({ url: 'https://app.exemplo.com.br/', title: 'Verificação', html: TURNSTILE }), { kind: 'turnstile', site: 'app.exemplo.com.br' });
  assert.equal(detectChallenge({ url: 'https://exemplo.com/form', title: 'Confirme que você não é um robô', html: RECAPTCHA_GATE })?.kind, 'recaptcha');
  assert.equal(detectChallenge({ url: 'https://www.google.com/sorry/index?continue=x', title: 'https://www.google.com/search?q=atria', html: GOOGLE_SORRY })?.kind, 'recaptcha');
  assert.equal(detectChallenge({ url: 'https://forum.exemplo.org/', title: 'Security check', html: HCAPTCHA })?.kind, 'hcaptcha');
  assert.deepEqual(detectChallenge({ url: 'https://www.loja.com/', title: 'Access Denied', html: AKAMAI }), { kind: 'akamai', site: 'loja.com' });
  assert.equal(detectChallenge({ url: 'https://www.zillow.com/', title: 'Access to this page has been denied', html: PERIMETERX })?.kind, 'perimeterx');
  assert.equal(detectChallenge({ url: 'https://exemplo.com/', title: 'exemplo.com', html: DATADOME })?.kind, 'datadome');
  assert.equal(detectChallenge({ url: 'https://x.com/', title: 'Verifique se você é humano', text: 'Verifique se você é humano para continuar.' })?.kind, 'generic');
});

test('detector: páginas normais não viram desafio', () => {
  assert.equal(detectChallenge({ url: 'https://portal.exemplo.com/artigo', title: 'Notícias de tecnologia · Portal Exemplo', html: NORMAL }), null);
  assert.equal(detectChallenge({ url: 'https://fisioforma.com.br/contato', title: 'Contato · Clínica Fisioforma', html: RECAPTCHA_INVISIBLE }), null, 'reCAPTCHA invisível de formulário');
  assert.equal(detectChallenge({ url: 'https://loja.exemplo.com/entrar', title: 'Entrar · Loja Exemplo', html: TURNSTILE_LOGIN }), null, 'Turnstile num formulário de login');
  assert.equal(detectChallenge({ url: 'https://exemplo.com/', title: 'Exemplo', html: '<html><body><h1>Olá</h1><p>Bem-vindo ao site.</p></body></html>' }), null);
  // com quadros lidos do DOM: o bframe do reCAPTCHA só conta quando o desafio de imagens está visível
  const frames = [
    { src: 'https://www.google.com/recaptcha/api2/anchor?k=6Ld&size=invisible', visible: true },
    { src: 'https://www.google.com/recaptcha/api2/bframe?k=6Ld', visible: false },
  ];
  assert.equal(detectChallenge({ url: 'https://fisioforma.com.br/contato', title: 'Contato', text: 'x'.repeat(800), frames }), null);
  assert.equal(detectChallenge({ url: 'https://fisioforma.com.br/contato', title: 'Contato', text: 'x'.repeat(800), frames: [frames[0], { ...frames[1], visible: true }] })?.kind, 'recaptcha');
});

// ---------- fluxo do hook com CDP falso ----------

const events: ServerEvent[] = [];
onEmit((ev) => events.push(ev));

function newRun(id: string) {
  db.prepare(`INSERT INTO runs(id, agent_id, project, instruction, task, state, progress, tools, steps, created_at, started_at) VALUES(?, 'qa', NULL, 'testar', 'Testar site', 'running', 10, '[]', '[]', ?, ?)`).run(id, now(), now());
}

const page = (url: string, title: string, html: string) => ({ targetId: 't1', url, title, html, visible: true });
let pages = [page('https://www.exemplo.com/', 'Just a moment...', CLOUDFLARE)];
const notices: { title: string; url?: string; channels: string[] }[] = [];
configureChallenge({ probe: async () => pages, notify: async (m) => void notices.push(m), pollMs: 20 });

const hookFor = (runId: string) => {
  const opts = agentOptions('qa', { runId });
  const m = opts.hooks?.PostToolUse?.find((x) => x.matcher === 'mcp__playwright__.*');
  assert.ok(m, 'hook do navegador registrado');
  return m.hooks[0];
};
const postTool = (url: string): HookInput => ({
  hook_event_name: 'PostToolUse',
  session_id: 's',
  transcript_path: '/tmp/x',
  cwd: '/tmp',
  tool_name: 'mcp__playwright__browser_navigate',
  tool_input: { url },
  tool_response: [{ type: 'text', text: `### Ran Playwright code\n### Page state\n- Page URL: ${url}\n- Page Title: x` }],
  tool_use_id: 'tu1',
});
const ctxOf = (out: unknown) => (out as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext;

test('hook: desafio → aviso → usuário resolve → agente continua', async () => {
  newRun('run-ok');
  configureChallenge({ timeoutMs: 5000 });
  pages = [page('https://www.exemplo.com/', 'Just a moment...', CLOUDFLARE)];
  const out = hookFor('run-ok')(postTool('https://www.exemplo.com/'), 'tu1', { signal: new AbortController().signal });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(getRun('run-ok')?.state, 'waiting_approval');
  assert.equal(getRun('run-ok')?.currentOp, 'Verificação humana pendente em exemplo.com');
  assert.deepEqual({ ...challengeState(), since: null }, { active: true, site: 'exemplo.com', kind: 'cloudflare', since: null });
  assert.ok(inboxItems().some((i) => i.id === 'browser-challenge:exemplo.com' && i.action.type === 'view' && i.action.view === 'browser'));
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].channels, ['push', 'telegram']);
  assert.match(notices[0].url ?? '', /\/app\/browser$/);
  assert.ok(events.some((e) => e.type === 'browser.challenge' && e.active));

  pages = [page('https://www.exemplo.com/', 'Exemplo · Produtos', NORMAL)]; // usuário clicou na tela ao vivo
  assert.equal(ctxOf(await out), 'A verificação foi resolvida pelo usuário; continue.');
  assert.equal(getRun('run-ok')?.state, 'running');
  assert.equal(challengeState().active, false);
  assert.ok(!inboxItems().some((i) => i.id.startsWith('browser-challenge:')));
  assert.ok(events.some((e) => e.type === 'browser.challenge' && !e.active));
});

test('hook: prazo estoura → mensagem de falha e não espera de novo no mesmo site', async () => {
  newRun('run-to');
  configureChallenge({ timeoutMs: 120 });
  pages = [page('https://app.exemplo.com.br/', 'Verificação', TURNSTILE)];
  const hook = hookFor('run-to');
  const msg = 'Não foi possível passar a verificação humana em app.exemplo.com.br; siga sem esse site ou use Firecrawl/Apify/Chrome do usuário.';
  assert.equal(ctxOf(await hook(postTool('https://app.exemplo.com.br/'), 'tu2', { signal: new AbortController().signal })), msg);
  assert.equal(getRun('run-to')?.state, 'running');
  assert.equal(challengeState().active, false);
  const t0 = Date.now();
  assert.equal(ctxOf(await hook(postTool('https://app.exemplo.com.br/'), 'tu3', { signal: new AbortController().signal })), msg);
  assert.ok(Date.now() - t0 < 100, 'segunda vez responde na hora');
});

test('hook: página normal e bloqueio Akamai não pausam', async () => {
  newRun('run-n');
  pages = [page('https://portal.exemplo.com/artigo', 'Notícias', NORMAL)];
  assert.deepEqual(await hookFor('run-n')(postTool('https://portal.exemplo.com/artigo'), 'tu4', { signal: new AbortController().signal }), {});
  pages = [page('https://www.loja.com/', 'Access Denied', AKAMAI)];
  assert.match(ctxOf(await hookFor('run-n')(postTool('https://www.loja.com/'), 'tu5', { signal: new AbortController().signal })) ?? '', /Akamai/);
  assert.equal(getRun('run-n')?.state, 'running');
});

test('agentOptions: hooks de vários módulos são somados', () => {
  const noop = async () => ({});
  registerAgentOptions(() => ({ hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [noop] }], Stop: [{ hooks: [noop] }] } }));
  registerAgentOptions(() => ({ disallowedTools: ['X'] }));
  const o = agentOptions('qa', { runId: 'r1' });
  assert.deepEqual(o.hooks?.PostToolUse?.map((m) => m.matcher), ['mcp__playwright__.*', 'Bash']);
  assert.equal(o.hooks?.Stop?.length, 1);
  assert.ok(o.disallowedTools?.includes('X'));
  // sem execução (ex.: ferramentas avulsas) o hook do navegador não entra
  assert.deepEqual(agentOptions('qa').hooks?.PostToolUse?.map((m) => m.matcher), ['Bash']);
});
