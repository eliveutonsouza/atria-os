import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { timingSafeEqual } from 'node:crypto';
import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { Bootstrap, ChatContext } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, kvGet, kvSet, now } from './db.ts';
import { addClient, emit, setYuiState, yuiState } from './bus.ts';
import { isAuthed, registerAuth, requireAuth } from './auth.ts';
import { agentInfos, agentsWorking } from './agents.ts';
import { activeProject, ensureProject, findProject, listProjectConfigs, projectDetail, projectLogs, projectSummaries, setActiveProject } from './projects.ts';
import { cancelRun, claudeLoggedIn, enqueueRun, getRun, inboxItems, listRuns, pendingApprovals, recoverRuns, resolveApproval, runEvents } from './runs.ts';
import { brief, infra, latestReport, overview } from './metrics.ts';
import { getUiContext, recentMessages, setUiContext } from './brain.ts';
import { endLive, handleText, liveActive, setUiContextNote, startLive } from './live.ts';
import { startRoutines } from './routines.ts';
import { initTerminal, registerTerminal } from './terminal.ts';
import { trustDirs } from './trust.ts';
import { captureInit, getInit, startCapabilities } from './capabilities.ts';
import * as missions from './missions.ts';
import * as customViews from './customViews.ts';
import * as toolbox from './toolbox.ts';
import * as agentsAdmin from './agentsAdmin.ts';
import * as workflows from './workflows.ts';
import { sandboxUrl, sbToken } from './sandbox.ts';
import { catalog, githubEnabled, startGithub, syncCatalog } from './github.ts';

// ---------- workspace seed (agentes padrão) ----------
const agentsDir = join(config.workspaceDir, '.claude', 'agents');
if (!existsSync(agentsDir) && existsSync(join(config.seedDir, '.claude', 'agents'))) {
  cpSync(config.seedDir, config.workspaceDir, { recursive: true });
  console.log('workspace semeado com agentes padrão');
}

const app = Fastify({ logger: { level: 'info' }, trustProxy: true, bodyLimit: 1_000_000 });
await app.register(cookie, { secret: config.sessionSecret });
await app.register(rateLimit, { global: false });
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https://api.openai.com'],
      mediaSrc: ["'self'", 'blob:'],
      frameSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

await app.register(websocket);
registerAuth(app);
initTerminal();
registerTerminal(app);
for (const mod of [missions, customViews, toolbox, agentsAdmin, workflows]) mod.register(app);

app.get('/api/health', async () => ({ ok: true }));

// Tudo em /api (exceto auth/health) exige sessão.
app.addHook('preHandler', async (req, reply) => {
  const url = req.url.split('?')[0];
  if (!url.startsWith('/api/') || url.startsWith('/api/auth/') || url === '/api/health') return;
  await requireAuth(req, reply);
});

// ---------- SSE ----------
app.get('/api/events', (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': ok\n\n');
  res.write(`data: ${JSON.stringify({ type: 'yui.state', state: yuiState() })}\n\n`);
  for (const approval of pendingApprovals()) res.write(`data: ${JSON.stringify({ type: 'approval.requested', approval })}\n\n`);
  const off = addClient(res);
  req.raw.on('close', off);
});

// ---------- bootstrap ----------
function greeting(): Bootstrap['greeting'] {
  const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: config.timezone }));
  const hello = h < 12 ? 'Bom dia.' : h < 18 ? 'Boa tarde.' : 'Boa noite.';
  const lastSeen = kvGet('last_seen');
  const away = !lastSeen || Date.now() - new Date(lastSeen).getTime() > 4 * 3600_000;
  const b = brief();
  const hasNews = b.lines.length > 0;
  if (away && hasNews) return { msg: `${hello} Enquanto você esteve fora:`, showBrief: true, brief: b };
  return { msg: `${hello} O que vamos fazer?`, showBrief: false, brief: null };
}

app.get('/api/bootstrap', async () => {
  const g = greeting();
  kvSet('last_seen', now());
  const body: Bootstrap = {
    user: { name: config.userName },
    activeProject: activeProject(),
    projects: await projectSummaries(),
    agentsWorking: agentsWorking(),
    inbox: inboxItems(),
    history: recentMessages(60).map((m, i) => ({ id: `${m.at}-${i}`, who: m.who, text: m.text, at: m.at })),
    greeting: g,
    status: {
      claude: claudeLoggedIn() || !!config.claudeToken,
      openai: !!config.openaiKey,
      live: liveActive(),
      claudeAuth: claudeLoggedIn() ? 'claude.ai' : config.claudeToken ? 'token' : 'none',
      github: githubEnabled(),
      repos: catalog().length,
    },
  };
  return body;
});

// ---------- conversa ----------
app.post('/api/chat', async (req, reply) => {
  const { text, context } = (req.body ?? {}) as { text?: unknown; context?: ChatContext };
  if (typeof text !== 'string' || !text.trim()) return reply.code(400).send({ error: 'text' });
  if (context) setUiContext(context);
  handleText(text.trim().slice(0, 4000)).catch((e) => app.log.error(e));
  return reply.code(202).send();
});

app.post('/api/context', async (req, reply) => {
  const ctx = req.body as ChatContext;
  const prev = getUiContext();
  setUiContext(ctx);
  const proj = ctx.params?.project ? findProject(ctx.params.project) : undefined;
  if (proj && proj.slug !== activeProject()) {
    setActiveProject(proj.slug);
    emit({ type: 'ui.action', action: { type: 'switch_project', project: proj.slug, name: proj.name } });
  }
  if (ctx.view !== prev.view || ctx.params?.project !== prev.params?.project || ctx.selectedElement !== prev.selectedElement || ctx.mode !== prev.mode) {
    setUiContextNote(
      ctx.mode === 'center'
        ? 'Tela: Yui ao centro, sem Canvas aberto.'
        : `Tela: Canvas mostrando "${ctx.view}"${ctx.params?.project ? ` do projeto ${ctx.params.project}` : ''}${ctx.selectedElement ? `; elemento selecionado: ${ctx.selectedElement}` : ''}.`,
    );
  }
  return reply.code(204).send();
});

app.post('/api/live/session', async (req, reply) => {
  const sdp = (req.body as { sdp?: unknown } | undefined)?.sdp;
  if (typeof sdp !== 'string' || !sdp.trim()) return reply.code(400).send({ error: 'sdp' });
  try {
    return await startLive(sdp);
  } catch (e) {
    app.log.error(e);
    return reply.code(502).send({ error: 'Não consegui abrir a sessão de voz.', detail: (e as Error).message });
  }
});

app.post('/api/live/end', async (_req, reply) => {
  endLive('user');
  return reply.code(204).send();
});

// ---------- dados ----------
app.get('/api/overview', () => overview());
app.get('/api/brief', () => brief());
app.get('/api/agents', () => agentInfos());
app.get('/api/infra', () => infra());

app.get('/api/runs', () => {
  const runs = listRuns(40);
  return {
    running: runs.filter((r) => r.state === 'running' || r.state === 'waiting_approval').length,
    queued: runs.filter((r) => r.state === 'queued').length,
    background: (db.prepare(`SELECT COUNT(*) AS n FROM routines WHERE enabled = 1`).get() as { n: number }).n,
    runs,
  };
});
app.get('/api/runs/:id/events', (req, reply) => {
  const { id } = req.params as { id: string };
  if (!getRun(id)) return reply.code(404).send({ error: 'not found' });
  return runEvents(id);
});
app.post('/api/runs', async (req, reply) => {
  const b = (req.body ?? {}) as { agentId?: string; project?: string | null; instruction?: string };
  if (!b.agentId || !b.instruction) return reply.code(400).send({ error: 'agentId e instruction' });
  try {
    const run = enqueueRun({ agentId: b.agentId, project: b.project ?? null, instruction: b.instruction, origin: 'manual' });
    setYuiState('delegating');
    return run;
  } catch (e) {
    return reply.code(400).send({ error: (e as Error).message });
  }
});
app.post('/api/runs/:id/cancel', async (req, reply) => {
  const ok = cancelRun((req.params as { id: string }).id);
  return reply.code(ok ? 204 : 404).send();
});

app.get('/api/projects/:slug', async (req, reply) => {
  const found = findProject((req.params as { slug: string }).slug);
  if (!found) return reply.code(404).send({ error: 'not found' });
  const p = await ensureProject(found).catch(() => found);
  return projectDetail(p);
});
app.get('/api/projects/:slug/logs', async (req, reply) => {
  const p = findProject((req.params as { slug: string }).slug);
  if (!p) return reply.code(404).send({ error: 'not found' });
  return projectLogs(p).catch((e) => ({ project: p.slug, source: p.container ?? '', summary: `Não consegui ler os logs: ${e.message}`, lines: [] }));
});

app.get('/api/reports/latest', async (_req, reply) => latestReport() ?? reply.code(404).send({ error: 'none' }));

app.get('/api/artifacts', async () => {
  const projects = await projectSummaries();
  const out = [];
  for (const s of projects) {
    const p = findProject(s.slug)!;
    if (p.preview && existsSync(join(p.dir, p.preview))) {
      out.push({ id: p.slug, kind: 'website', title: `${p.name} — preview`, project: p.slug, createdAt: statSync(join(p.dir, p.preview)).mtime.toISOString(), url: sandboxUrl(p.slug) });
    }
  }
  const r = latestReport();
  if (r) out.push({ id: r.id, kind: 'report', title: r.title, project: null, createdAt: r.generatedAt, url: null });
  return out;
});

app.get('/api/repos', () =>
  catalog().map((r) => ({
    slug: r.slug, nameWithOwner: r.name_with_owner, description: r.description, language: r.language,
    pushedAt: r.pushed_at, archived: !!r.archived, cloned: !!findProject(r.slug)?.cloned,
  })),
);
app.post('/api/repos/sync', async () => {
  await startGithub();
  return { count: await syncCatalog() };
});

app.get('/api/capabilities', () => getInit() ?? JSON.parse(kvGet('claude_capabilities') ?? '{}'));
app.post('/api/capabilities/refresh', async () => (await captureInit()) ?? { error: 'falhou' });
app.get('/api/approvals', () => pendingApprovals());
app.post('/api/approvals/:id', async (req, reply) => {
  const approve = (req.body as { approve?: unknown } | undefined)?.approve;
  if (typeof approve !== 'boolean') return reply.code(400).send({ error: 'approve' });
  const ok = resolveApproval((req.params as { id: string }).id, approve);
  return reply.code(ok ? 204 : 404).send();
});

// ---------- sandbox de previews ----------
// Iframe com sandbox (origem opaca) não envia cookie SameSite=Strict nos sub-recursos,
// então o acesso é por token HMAC no caminho em vez de sessão.

const SELECT_SCRIPT = `<script>(function(){function sel(el){var s=el.closest('section,header,footer,nav,main,[id],[data-yui]')||el;if(s.dataset&&s.dataset.yui)return s.dataset.yui;if(s.id)return '#'+s.id;var t=s.tagName.toLowerCase();var c=(s.className&&typeof s.className==='string')?'.'+s.className.trim().split(/\\s+/).slice(0,2).join('.'):'';var i=Array.prototype.indexOf.call(s.parentNode?s.parentNode.children:[],s);return t+c+':nth-child('+(i+1)+')';}
var last;document.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();var s=sel(e.target);if(last)last.style.outline=last.__o||'';var el=e.target.closest('section,header,footer,nav,main,[id],[data-yui]')||e.target;el.__o=el.style.outline;el.style.outline='2px solid #67d8f2';el.style.outlineOffset='-4px';last=el;parent.postMessage({type:'yui.select',selector:s,text:(el.innerText||'').slice(0,160)},'*');},true);})();</script>`;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain',
};

app.get('/sandbox/:token/:slug/*', async (req, reply) => {
  const { token, slug } = req.params as { token: string; slug: string; '*': string };
  const expected = sbToken(slug);
  if (token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return reply.code(404).send();
  const p = findProject(slug);
  if (!p?.preview) return reply.code(404).send();
  const root = resolve(p.dir, p.preview);
  let file = resolve(root, normalize((req.params as Record<string, string>)['*'] || 'index.html'));
  if (!file.startsWith(root)) return reply.code(404).send();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) file = join(root, 'index.html');
  if (!existsSync(file)) return reply.code(404).send();
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  reply.header('Content-Security-Policy', "sandbox allow-scripts allow-forms; frame-ancestors 'self'");
  reply.header('X-Frame-Options', 'SAMEORIGIN');
  reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
  reply.header('Cache-Control', 'no-store');
  reply.type(type);
  if (type.startsWith('text/html')) {
    const html = readFileSync(file, 'utf8');
    return html.includes('</body>') ? html.replace('</body>', `${SELECT_SCRIPT}</body>`) : html + SELECT_SCRIPT;
  }
  return readFileSync(file);
});

// ---------- SPA ----------
if (existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist, wildcard: false, index: false });
  const indexHtml = () => readFileSync(join(config.webDist, 'index.html'), 'utf8');
  app.get('/assets/*', (req, reply) => reply.sendFile(req.url.slice(1).split('?')[0]));
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/sandbox/')) return reply.code(404).send({ error: 'not found' });
    const path = req.url.split('?')[0];
    const f = join(config.webDist, path);
    if (path !== '/' && f.startsWith(config.webDist) && existsSync(f) && statSync(f).isFile()) return reply.sendFile(path.slice(1));
    if (!isAuthed(req) && path !== '/login') return reply.redirect('/login');
    reply.type('text/html').send(indexHtml());
  });
}

recoverRuns();
startRoutines();
startGithub().catch((e) => console.error('github', e));
startCapabilities();
trustDirs(listProjectConfigs().filter((p) => p.cloned).map((p) => p.dir));
emit({ type: 'agents.updated', agentsWorking: agentsWorking() });
await app.listen({ port: config.port, host: config.host });
