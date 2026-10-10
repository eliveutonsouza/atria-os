import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type { HookCallback, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { BrowserChallengeKind, BrowserChallengeState, InboxItem } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { emit } from './bus.ts';
import { registerAgentOptions, registerRunPrompt } from './extensions.ts';
import { addInboxSource, getRun, holdRun, inboxItems } from './runs.ts';
import { publicUrl, sendNotice, type NoticeMsg } from './notify.ts';

// Verificação humana (Cloudflare, reCAPTCHA, hCaptcha…) no navegador dos agentes (sidecar atria-browser).
// Depois de cada ferramenta do Playwright MCP, lê a página por CDP (só leitura, nunca toca no desafio).
// Se for um desafio: a execução fica aguardando, o usuário é avisado (push + Telegram + Inbox) e resolve
// pela tela ao vivo da página Navegador; quando a página deixa de ser desafio, o agente continua.

export interface Challenge {
  kind: BrowserChallengeKind;
  site: string;
}

export interface PageFrame {
  src: string;
  visible?: boolean; // desconhecido quando vem só do HTML
}

export interface PageInput {
  url: string;
  title: string;
  html?: string;
  text?: string;
  frames?: (PageFrame | string)[];
}

// ---------- detector (puro) ----------

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Títulos típicos de página-portão (já sem acento).
const GATE_TITLE =
  /just a moment|^um momento|attention required|verify you are (a )?human|verifique (se|que) voce e (um )?humano|confirme que voce (e humano|nao e um robo)|are you a robot|voce e um robo|checking your browser|verificando (o |seu )?navegador|human verification|verificacao humana|robot check|pardon our interruption|security check|verificacao de seguranca/;
// Frases no corpo (só contam em páginas curtas, para não pegar artigos sobre CAPTCHA).
const GATE_TEXT =
  /verify you are (a )?human|verifique (se|que) voce e (um )?humano|confirme que voce (e humano|nao e um robo)|unusual traffic|trafego incomum|press (&|and) hold|pressione e (segure|mantenha)|review the security of your connection|(revisar|verificar) a seguranca da (sua )?conexao|checking (if the site connection is secure|your browser)|complete the security check|conclua a verificacao de seguranca|enable javascript and cookies to continue|ative o javascript e os cookies/;

const htmlText = (html: string) =>
  html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function framesOf(input: PageInput): PageFrame[] {
  if (input.frames) return input.frames.map((f) => (typeof f === 'string' ? { src: f } : f));
  const out: PageFrame[] = [];
  for (const m of (input.html ?? '').matchAll(/<iframe\b[^>]*>/gi)) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    if (src) out.push({ src: src.replace(/&amp;/g, '&') });
  }
  return out;
}

export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 80);
  }
}

export function detectChallenge(input: PageInput): Challenge | null {
  const html = input.html ?? '';
  const title = norm(input.title ?? '');
  const text = norm(input.text ?? htmlText(html));
  const frames = framesOf(input);
  const src = (re: RegExp) => frames.filter((f) => re.test(f.src));
  const site = siteOf(input.url);
  const titleHit = GATE_TITLE.test(title);
  const textHit = text.length <= 1500 && GATE_TEXT.test(text);
  const gate = titleHit || textHit;
  const hit = (kind: BrowserChallengeKind): Challenge => ({ kind, site });

  // Bloqueios/desafios de página inteira, reconhecíveis pela marcação do fornecedor.
  if (/id=["']px-captcha|captcha\.px-cdn\.net|_pxCaptcha/i.test(html) || src(/px-cdn\.net|perimeterx/i).length) return hit('perimeterx');
  if (/captcha-delivery\.com/i.test(html) || src(/captcha-delivery\.com/i).length) return hit('datadome');
  // `/cdn-cgi/challenge-platform/scripts/jsd` aparece em páginas normais do Cloudflare; `_cf_chl_opt` só no desafio.
  if (/_cf_chl_opt|\bcf-chl-|id=["']challenge-(form|running|stage|error-text)["']/i.test(html) || /^(just a moment|um momento)|attention required! \| cloudflare/.test(title)) return hit('cloudflare');
  if (/access denied|acesso negado/.test(title) && (/errors\.edgesuite\.net|reference\s*#\s*\d|akamai/i.test(html) || /you don't have permission to access/.test(text))) return hit('akamai');

  // Widgets: só contam numa página-portão (ou com o quadro do desafio visível), nunca num formulário comum.
  const shortPage = text.length < 160;
  const turnstile = src(/challenges\.cloudflare\.com/i).length > 0 || /class=["'][^"']*\bcf-turnstile\b|challenges\.cloudflare\.com\/turnstile/i.test(html);
  if (turnstile && (gate || shortPage)) return hit('turnstile');

  const hcFrames = src(/hcaptcha\.com/i);
  const hcaptcha = hcFrames.length > 0 || /class=["'][^"']*\bh-captcha\b|hcaptcha\.com\/1\/api\.js/i.test(html);
  if (hcaptcha && (gate || shortPage || hcFrames.some((f) => /frame=challenge/.test(f.src) && f.visible === true))) return hit('hcaptcha');

  if (/^https?:\/\/(www\.)?google\.[a-z.]+\/sorry\//i.test(input.url)) return hit('recaptcha');
  const rcFrames = src(/(google\.com|recaptcha\.net)\/recaptcha\//i);
  const anchors = rcFrames.filter((f) => /\/anchor\b/.test(f.src));
  const invisibleOnly = anchors.length > 0 ? anchors.every((f) => /[?&]size=invisible\b/.test(f.src)) : /data-size=["']invisible["']|grecaptcha-badge/i.test(html);
  const recaptcha = rcFrames.length > 0 || /class=["'][^"']*\bg-recaptcha\b/i.test(html);
  if (recaptcha && rcFrames.some((f) => /\/bframe\b/.test(f.src) && f.visible === true)) return hit('recaptcha');
  if (recaptcha && !invisibleOnly && (gate || shortPage)) return hit('recaptcha');

  return gate ? hit('generic') : null;
}

// ---------- leitura das abas por CDP ----------

export interface PageSnapshot extends PageInput {
  targetId: string;
  visible: boolean; // aba em primeiro plano (no Chrome com tela, só a aba ativa de cada janela)
}

export type ChallengeProbe = () => Promise<PageSnapshot[]>;

const READ_PAGE = `(() => {
  const frames = [...document.querySelectorAll('iframe')].map((f) => {
    const r = f.getBoundingClientRect();
    const cs = getComputedStyle(f);
    return { src: f.src || '', visible: r.width > 30 && r.height > 30 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0' };
  });
  return {
    url: location.href,
    title: document.title,
    text: document.body ? document.body.innerText.slice(0, 4000) : '',
    html: document.documentElement.outerHTML.slice(0, 200000),
    frames,
    visible: document.visibilityState === 'visible',
  };
})()`;

const cdpHttp = () => config.browserCdp.replace(/\/$/, '');

function evaluateIn(targetId: string): Promise<PageSnapshot | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${cdpHttp().replace(/^http/, 'ws')}/devtools/page/${targetId}`, { perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });
    const done = (v: PageSnapshot | null) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* já fechado */
      }
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 4000);
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: READ_PAGE, returnByValue: true } })));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { id?: number; result?: { result?: { value?: Omit<PageSnapshot, 'targetId'> } } };
        if (msg.id !== 1) return;
        const v = msg.result?.result?.value;
        done(v ? { ...v, targetId } : null);
      } catch {
        done(null);
      }
    });
    ws.on('error', () => done(null));
  });
}

const cdpProbe: ChallengeProbe = async () => {
  const r = await fetch(`${cdpHttp()}/json/list`, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`cdp ${r.status}`);
  const targets = ((await r.json()) as { id: string; type: string; url: string }[]).filter((t) => t.type === 'page' && /^https?:/.test(t.url));
  const snaps = await Promise.all(targets.map((t) => evaluateIn(t.id)));
  return snaps.filter((s): s is PageSnapshot => !!s);
};

// ---------- estado + pausa do agente ----------

interface Deps {
  probe: ChallengeProbe;
  notify: (msg: NoticeMsg) => Promise<unknown>;
  timeoutMs: number;
  pollMs: number;
}
const deps: Deps = { probe: cdpProbe, notify: sendNotice, timeoutMs: 30 * 60_000, pollMs: 2000 };
/** Testes: CDP falso, aviso capturado e prazos curtos. */
export function configureChallenge(d: Partial<Deps>): void {
  Object.assign(deps, d);
}

let current: (Challenge & { since: string }) | null = null;
const gaveUp = new Map<string, Set<string>>(); // runId → sites em que o prazo já estourou

export const challengeState = (): BrowserChallengeState => ({ active: !!current, site: current?.site ?? null, kind: current?.kind ?? null, since: current?.since ?? null });

function publish() {
  emit({ type: 'browser.challenge', ...challengeState() });
  emit({ type: 'inbox.updated', inbox: inboxItems() });
}

function begin(ch: Challenge, runId: string) {
  if (current && current.site === ch.site) return;
  current = { ...ch, since: new Date().toISOString() };
  publish();
  const agent = getRun(runId)?.agent ?? 'Um agente';
  deps
    .notify({
      title: `Verificação humana em ${ch.site}`,
      text: `${agent} parou em ${ch.site}: o site pede para provar que é humano. Abra o Navegador e resolva o desafio na tela ao vivo; o agente continua sozinho depois.`,
      url: publicUrl('/app/browser'),
      channels: ['push', 'telegram'],
      kind: 'notice',
    })
    .catch(() => {});
}

function end() {
  if (!current) return;
  current = null;
  publish();
}

// URL da página que a ferramenta deixou aberta ("Page URL: …" na resposta do Playwright MCP).
function urlHint(toolResponse: unknown): string | null {
  let s: string;
  try {
    s = typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse);
  } catch {
    return null;
  }
  return /Page URL:\s*(https?:\/\/[^\s"\\]+)/.exec(s ?? '')?.[1] ?? null;
}

// Desafio na aba que o agente está usando: a do site da resposta, senão as abas em primeiro plano.
// `onlySite`: na espera, olha todas as abas daquele site (aba fechada ou que saiu do site = liberado).
async function findChallenge(hint: string | null, onlySite?: string): Promise<Challenge | null> {
  const snaps = await deps.probe();
  if (onlySite) return snaps.filter((s) => siteOf(s.url) === onlySite).map(detectChallenge).find((c) => !!c) ?? null;
  const byUrl = hint ? snaps.filter((s) => siteOf(s.url) === siteOf(hint)) : [];
  const pool = byUrl.length ? byUrl : snaps.filter((s) => s.visible);
  for (const s of pool) {
    const ch = detectChallenge(s);
    if (ch) return ch;
  }
  return null;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

const say = (additionalContext: string): HookJSONOutput => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } });
const failText = (site: string) => `Não foi possível passar a verificação humana em ${site}; siga sem esse site ou use Firecrawl/Apify/Chrome do usuário.`;

export function challengeHook(runId: string): HookCallback {
  return async (input, _toolUseId, { signal }) => {
    if (input.hook_event_name !== 'PostToolUse') return {};
    const ch = await findChallenge(urlHint(input.tool_response)).catch(() => null);
    if (!ch) return {};
    // Bloqueio da Akamai não tem o que resolver: não adianta esperar.
    if (ch.kind === 'akamai') return say(`${ch.site} bloqueou o acesso do navegador do servidor (Akamai). Não insista; use Firecrawl/Apify ou o Chrome do usuário.`);
    if (gaveUp.get(runId)?.has(ch.site)) return say(failText(ch.site));

    begin(ch, runId);
    holdRun(runId, true, `Verificação humana pendente em ${ch.site}`);
    const deadline = Date.now() + deps.timeoutMs;
    let solved = false;
    while (!signal.aborted && Date.now() < deadline) {
      await sleep(Math.min(deps.pollMs, Math.max(0, deadline - Date.now())), signal);
      if (signal.aborted) break;
      const still = await findChallenge(null, ch.site).catch(() => ch); // CDP fora do ar: continua esperando
      if (!still) {
        solved = true;
        break;
      }
    }
    end();
    if (signal.aborted) return {};
    if (solved) {
      holdRun(runId, false, 'Verificação resolvida — continuando');
      return say('A verificação foi resolvida pelo usuário; continue.');
    }
    gaveUp.set(runId, new Set([...(gaveUp.get(runId) ?? []), ch.site]));
    holdRun(runId, false, `Verificação em ${ch.site} não resolvida — seguindo sem o site`);
    return say(failText(ch.site));
  };
}

// ---------- registros ----------

registerAgentOptions((_agentId, ctx) =>
  ctx?.runId ? { hooks: { PostToolUse: [{ matcher: 'mcp__playwright__.*', hooks: [challengeHook(ctx.runId)], timeout: Math.ceil(deps.timeoutMs / 1000) + 120 }] } } : {},
);

registerRunPrompt(() =>
  [
    '- Sites protegidos contra robôs (Cloudflare, CAPTCHA), em ordem de preferência:',
    '  1. Para extrair dados (textos, listas, preços, contatos), use os conectores Firecrawl ou Apify, se disponíveis; eles são feitos para isso.',
    '  2. Para sites com login do usuário ou que bloqueiam servidores, use o Chrome real do usuário (mcp__claude-in-chrome__*) quando houver navegador conectado.',
    '  3. Se o navegador do Atria (mcp__playwright__*) cair numa verificação humana, NÃO tente resolver nem burlar o desafio: o Atria avisa o usuário e espera ele resolver. Siga a orientação que vier no retorno da ferramenta.',
  ].join('\n'),
);

addInboxSource({
  prefixes: ['browser-challenge:'],
  items: (): InboxItem[] =>
    current ? [{ id: `browser-challenge:${current.site}`, tag: 'Verificação', label: `Verificação humana pendente em ${current.site}`, tone: 'warn', action: { type: 'view', view: 'browser' } }] : [],
  dismiss: () => false, // some sozinho quando o desafio é resolvido (ou o prazo acaba)
});

export function register(app: FastifyInstance): void {
  app.get('/api/browser/challenge', async () => challengeState());
}
