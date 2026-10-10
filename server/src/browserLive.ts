import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type { BrowserClientMsg, BrowserServerMsg, BrowserTab, RunInfo } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { onEmit } from './bus.ts';

// Navegador ao vivo: o mesmo Chromium que os agentes usam pelo Playwright MCP (sidecar atria-browser)
// é transmitido por CDP screencast para a página Navegador. Um screencast compartilhado, fan-out para
// todos os clientes; controle (mouse/teclado/URL) só para quem ligou "Assumir controle".

interface Client {
  ws: WebSocket;
  controlling: boolean;
}

interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
}

const clients = new Set<Client>();
const activity: Extract<BrowserServerMsg, { type: 'activity' }>[] = [];
let tabs: BrowserTab[] = [];
let activeId: string | null = null;
let userPicked = false; // usuário escolheu a aba → não seguir abas novas automaticamente
let lastFrame: Extract<BrowserServerMsg, { type: 'frame' }> | null = null;

// ---------- conexão CDP com a aba ativa ----------
let page: WebSocket | null = null;
let pageId: string | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let connected = false;
let attaching: Promise<void> | null = null;

const cdpHttp = () => config.browserCdp.replace(/\/$/, '');
const cdpWs = (id: string) => `${cdpHttp().replace(/^http/, 'ws')}/devtools/page/${id}`;

function send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!page || page.readyState !== WebSocket.OPEN) return reject(new Error('cdp fechado'));
    const id = ++seq;
    pending.set(id, { resolve, reject });
    page.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`cdp timeout ${method}`));
    }, 10_000).unref();
  });
}

function broadcast(msg: BrowserServerMsg) {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
}

function status() {
  for (const c of clients) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: 'status', connected, controlling: c.controlling } satisfies BrowserServerMsg));
  }
}

function detach() {
  const p = page;
  page = null;
  pageId = null;
  connected = false;
  for (const { reject } of pending.values()) reject(new Error('cdp fechado'));
  pending.clear();
  try {
    p?.close();
  } catch {
    /* já fechado */
  }
}

function attach(id: string): Promise<void> {
  if (pageId === id && page?.readyState === WebSocket.OPEN) return Promise.resolve();
  if (attaching) return attaching;
  attaching = doAttach(id).finally(() => {
    attaching = null;
  });
  return attaching;
}

async function doAttach(id: string) {
  detach();
  pageId = id;
  const ws = new WebSocket(cdpWs(id), { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
  page = ws;
  ws.on('message', (raw) => {
    let msg: { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Page.screencastFrame' && msg.params) {
      const { data, sessionId, metadata } = msg.params as { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number } };
      send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      lastFrame = { type: 'frame', targetId: id, data, width: Math.round(metadata.deviceWidth), height: Math.round(metadata.deviceHeight) };
      broadcast(lastFrame);
    } else if (msg.method === 'Page.frameNavigated' || msg.method === 'Page.loadEventFired') {
      void refreshTabs();
    }
  });
  ws.on('close', () => {
    if (page === ws) {
      detach();
      status();
    }
  });
  ws.on('error', () => {
    /* tratado no close */
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  connected = true;
  await send('Page.enable');
  await send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
  // headless só manda frame quando algo muda: envia um retrato inicial
  const shot = (await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 }).catch(() => null)) as { data?: string } | null;
  const metrics = (await send('Page.getLayoutMetrics').catch(() => null)) as { cssVisualViewport?: { clientWidth: number; clientHeight: number } } | null;
  if (shot?.data) {
    lastFrame = {
      type: 'frame',
      targetId: id,
      data: shot.data,
      width: Math.round(metrics?.cssVisualViewport?.clientWidth ?? 1440),
      height: Math.round(metrics?.cssVisualViewport?.clientHeight ?? 900),
    };
    broadcast(lastFrame);
  }
  status();
}

async function stopScreencast() {
  await send('Page.stopScreencast').catch(() => {});
  detach();
}

// ---------- abas ----------
async function listTargets(): Promise<CdpTarget[]> {
  const r = await fetch(`${cdpHttp()}/json/list`, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`cdp ${r.status}`);
  const all = (await r.json()) as CdpTarget[];
  return all.filter((t) => t.type === 'page' && !t.url.startsWith('chrome://') && !t.url.startsWith('devtools://'));
}

let known = new Set<string>();
async function refreshTabs() {
  let list: CdpTarget[];
  try {
    list = await listTargets();
  } catch {
    if (connected) {
      detach();
      status();
    }
    return;
  }
  // aba nova aberta (normalmente por um agente) → segue, a não ser que o usuário tenha escolhido
  const fresh = list.filter((t) => !known.has(t.id));
  known = new Set(list.map((t) => t.id));
  if (!activeId || !list.some((t) => t.id === activeId)) {
    activeId = list[0]?.id ?? null;
    userPicked = false;
  } else if (fresh.length && !userPicked) {
    activeId = fresh[fresh.length - 1].id;
  }
  const next: BrowserTab[] = list.map((t) => ({ id: t.id, title: t.title || t.url, url: t.url, active: t.id === activeId }));
  if (JSON.stringify(next) !== JSON.stringify(tabs)) {
    tabs = next;
    broadcast({ type: 'tabs', tabs });
  }
  if (clients.size && activeId && activeId !== pageId) await attach(activeId).catch(() => detach());
}

let poller: NodeJS.Timeout | null = null;
function ensurePolling() {
  if (poller) return;
  poller = setInterval(() => {
    if (!clients.size) {
      clearInterval(poller!);
      poller = null;
      void stopScreencast();
      return;
    }
    void refreshTabs().then(() => {
      // reconexão: browser reiniciou ou a conexão caiu
      if (!connected && activeId) void attach(activeId).catch(() => detach());
    });
  }, 2000);
}

// ---------- atividade dos agentes no navegador ----------
const BROWSER_OP = /^(Navegando|Clicando|Tirando screenshot|Preenchendo|Navegador)/;
onEmit((ev) => {
  if (ev.type !== 'run.updated') return;
  const r: RunInfo = ev.run;
  if (r.state !== 'running' || !r.currentOp || !BROWSER_OP.test(r.currentOp)) return;
  const last = activity[activity.length - 1];
  if (last && last.runId === r.id && last.action === r.currentOp) return;
  const msg = { type: 'activity' as const, runId: r.id, agent: r.agent, action: r.currentOp, at: new Date().toISOString() };
  activity.push(msg);
  if (activity.length > 40) activity.shift();
  broadcast(msg);
});

// ---------- entrada do usuário ----------
const VK: Record<string, number> = { Backspace: 8, Tab: 9, Enter: 13, Escape: 27, ' ': 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34 };
// Código de tecla pela posição física (KeyboardEvent.code), independente do layout (ABNT2, US…).
// Sinais NÃO podem usar o código do caractere: '.' (46) viraria Delete, ',' PrintScreen, '-' Insert, '(' seta…
const VK_CODE: Record<string, number> = {
  Period: 190, Comma: 188, Minus: 189, Equal: 187, Slash: 191, Semicolon: 186, Quote: 222, BracketLeft: 219, BracketRight: 221,
  Backslash: 220, Backquote: 192, IntlRo: 193, IntlBackslash: 226, NumpadDecimal: 110, NumpadComma: 194, NumpadAdd: 107,
  NumpadSubtract: 109, NumpadMultiply: 106, NumpadDivide: 111, NumpadEnter: 13, Space: 32,
};
export function virtualKey(key: string, code?: string): number {
  if (VK[key] !== undefined) return VK[key];
  if (/^[a-z]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
  if (code) {
    if (VK_CODE[code] !== undefined) return VK_CODE[code];
    const m = /^(?:Key([A-Z])|Digit([0-9])|Numpad([0-9]))$/.exec(code);
    if (m) return m[1] ? m[1].charCodeAt(0) : m[2] ? m[2].charCodeAt(0) : 96 + Number(m[3]);
    const f = /^F([0-9]{1,2})$/.exec(code);
    if (f) return 111 + Number(f[1]);
  }
  return 0; // caractere sem tecla conhecida (ç, á, @…): o texto entra pelo campo text
}

async function handle(c: Client, msg: BrowserClientMsg) {
  switch (msg.type) {
    case 'select':
      if (tabs.some((t) => t.id === msg.targetId)) {
        activeId = msg.targetId;
        userPicked = true;
        tabs = tabs.map((t) => ({ ...t, active: t.id === activeId }));
        broadcast({ type: 'tabs', tabs });
        await attach(activeId);
      }
      return;
    case 'control':
      c.controlling = msg.on;
      status();
      return;
  }
  if (!c.controlling) return; // abaixo: só com "Assumir controle"
  switch (msg.type) {
    case 'navigate': {
      let url = msg.url.trim();
      if (!/^[a-z]+:/i.test(url)) url = `https://${url}`;
      if (!/^https?:\/\//i.test(url)) return;
      await send('Page.navigate', { url });
      return;
    }
    case 'nav':
      if (msg.action === 'reload') await send('Page.reload');
      else {
        const h = (await send('Page.getNavigationHistory')) as { currentIndex: number; entries: { id: number }[] };
        const to = h.entries[h.currentIndex + (msg.action === 'back' ? -1 : 1)];
        if (to) await send('Page.navigateToHistoryEntry', { entryId: to.id });
      }
      return;
    case 'mouse':
      await send('Input.dispatchMouseEvent', {
        type: msg.event,
        x: msg.x,
        y: msg.y,
        button: msg.button ?? (msg.event === 'mouseMoved' ? 'none' : 'left'),
        clickCount: msg.clickCount ?? (msg.event === 'mousePressed' || msg.event === 'mouseReleased' ? 1 : 0),
        deltaX: msg.deltaX ?? 0,
        deltaY: msg.deltaY ?? 0,
      });
      return;
    case 'key':
      await send('Input.dispatchKeyEvent', {
        type: msg.event,
        key: msg.key,
        code: msg.code,
        text: msg.event === 'keyDown' || msg.event === 'char' ? msg.text : undefined,
        windowsVirtualKeyCode: virtualKey(msg.key, msg.code),
        modifiers: msg.modifiers ?? 0,
      });
      return;
    case 'viewport':
      return; // viewport fixo 1440×900 no sidecar
  }
}

export function register(app: FastifyInstance): void {
  app.get('/api/browser/live', { websocket: true }, (socket, req) => {
    const origin = req.headers.origin;
    if (origin && config.domain !== 'localhost' && origin !== `https://${config.domain}`) {
      socket.close(4403, 'origin');
      return;
    }
    const c: Client = { ws: socket as unknown as WebSocket, controlling: false };
    clients.add(c);
    socket.send(JSON.stringify({ type: 'status', connected, controlling: false } satisfies BrowserServerMsg));
    if (tabs.length) socket.send(JSON.stringify({ type: 'tabs', tabs } satisfies BrowserServerMsg));
    for (const a of activity.slice(-15)) socket.send(JSON.stringify(a));
    if (lastFrame) socket.send(JSON.stringify(lastFrame));
    ensurePolling();
    void refreshTabs().then(() => {
      if (!connected && activeId) void attach(activeId).catch(() => detach());
    });
    socket.on('message', (raw: Buffer) => {
      let msg: BrowserClientMsg;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }
      handle(c, msg).catch((e) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'status', connected, controlling: c.controlling, error: (e as Error).message } satisfies BrowserServerMsg));
      });
    });
    socket.on('close', () => clients.delete(c));
  });

  // Estado rápido para cards/badges sem abrir WebSocket.
  app.get('/api/browser/status', async () => {
    const list = await listTargets().catch(() => null);
    return { reachable: !!list, tabs: list?.map((t) => ({ id: t.id, title: t.title, url: t.url })) ?? [], recent: activity.slice(-5) };
  });
}
