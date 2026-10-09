import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { InboxItem } from '../../shared/protocol.ts';
import type { NoticeLevel, NoticePayload, SupportTokenPayload } from '../../shared/telemetry.ts';
import { db, kvGet, kvSet, now, uid } from './db.ts';
import { emit } from './bus.ts';
import { getSetting } from './settings.ts';
import { onPasswordChange, sessionKind, startSession } from './auth.ts';
import { sendPush } from './push.ts';
import { addInboxSource, inboxItems } from './runs.ts';
import { registerCommand } from './central.ts';
import { instanceId, monitorConfig, pushEvent, VERSION } from './telemetry.ts';

// Suporte remoto e avisos do Atria Central (contrato em shared/telemetry.ts).
// Suporte: o Central assina um link curto com a chave da instância; /support troca o link por uma sessão
// marcada como 'support' (2 h), sempre visível numa faixa e registrada em support_access. O cliente pode
// desligar em Configurações › Suporte e atualizações e encerrar a qualquer momento.
// Avisos: comando 'notice' grava em support_notices; a faixa do topo mostra o não lido até "Entendi".

db.exec(`
CREATE TABLE IF NOT EXISTS support_access (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  by TEXT,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT,
  ended_by TEXT
);
CREATE TABLE IF NOT EXISTS support_nonces (nonce TEXT PRIMARY KEY, used_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS support_notices (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  level TEXT NOT NULL,
  push INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  read_at TEXT
);
`);

export const SUPPORT_TTL_MS = 2 * 3600_000;
const NONCE_KEEP_MS = 10 * 60_000;

function changed() {
  emit({ type: 'support.updated' });
  emit({ type: 'inbox.updated', inbox: inboxItems() });
}

// ---------- token do link ----------

const b64 = (s: string) => Buffer.from(s, 'base64url');

export type TokenCheck = { ok: true; payload: SupportTokenPayload } | { ok: false; status: number; error: string };

/** Valida o link do Central (formato, assinatura, validade, instância, uso único e permissão do cliente). Queima o nonce se for aceito. */
export function checkSupportToken(t: unknown): TokenCheck {
  const bad = (error: string, status = 401): TokenCheck => ({ ok: false, status, error });
  if (typeof t !== 'string' || t.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t)) return bad('Link de suporte inválido.', 400);
  const key = monitorConfig().key;
  if (!key) return bad('Esta instalação não está ligada a um Atria Central.', 409);
  const [body, sig] = t.split('.');
  const want = createHmac('sha256', key).update(body).digest();
  const got = b64(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return bad('Link de suporte inválido.');
  let p: SupportTokenPayload;
  try {
    p = JSON.parse(b64(body).toString('utf8'));
  } catch {
    return bad('Link de suporte inválido.', 400);
  }
  const nowS = Math.floor(Date.now() / 1000);
  if (typeof p?.exp !== 'number' || p.exp <= nowS) return bad('Link de suporte expirado. Gere outro no Atria Central.');
  if (p.exp > nowS + 120) return bad('Link de suporte com validade longa demais.');
  if (p.iid !== instanceId()) return bad('Link de suporte de outra instância.');
  if (typeof p.n !== 'string' || p.n.length < 8 || p.n.length > 64) return bad('Link de suporte inválido.', 400);
  if (!getSetting('support.remoteAccess')) return bad('O acesso do suporte está desligado nesta instalação. O dono pode ligar em Configurações › Suporte e atualizações.', 403);
  db.prepare('DELETE FROM support_nonces WHERE used_at < ?').run(new Date(Date.now() - NONCE_KEEP_MS).toISOString());
  const used = db.prepare('INSERT OR IGNORE INTO support_nonces(nonce, used_at) VALUES(?, ?)').run(p.n, now());
  if (!used.changes) return bad('Este link de suporte já foi usado. Gere outro no Atria Central.');
  return { ok: true, payload: { iid: p.iid, n: p.n, exp: p.exp, by: typeof p.by === 'string' ? p.by.slice(0, 60) : 'Atria Central' } };
}

// ---------- sessões de suporte ----------

type EndedBy = 'client' | 'support' | 'central' | 'password' | 'expired';
const END_TEXT: Record<EndedBy, string> = {
  client: 'pelo cliente',
  support: 'pela equipe de suporte',
  central: 'pelo Atria Central',
  password: 'pela troca de senha',
  expired: 'expirou',
};

/** Acessos de suporte vencidos viram "expirou" (a sessão em si já não vale mais). */
function sweepExpired() {
  const rows = db.prepare('SELECT id, token FROM support_access WHERE ended_at IS NULL AND expires_at <= ?').all(now()) as { id: string; token: string }[];
  for (const r of rows) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(r.token);
    db.prepare('UPDATE support_access SET ended_at = expires_at, ended_by = ? WHERE id = ?').run('expired', r.id);
    pushEvent({ kind: 'support_end', level: 'info', text: 'Suporte encerrado · expirou', ref: r.id });
  }
  if (rows.length) changed();
}

/** Encerra todos os acessos de suporte ativos. Devolve quantos encerrou. */
export function endSupport(by: EndedBy): number {
  sweepExpired();
  const rows = db.prepare('SELECT id, token FROM support_access WHERE ended_at IS NULL').all() as { id: string; token: string }[];
  for (const r of rows) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(r.token);
    db.prepare('UPDATE support_access SET ended_at = ?, ended_by = ? WHERE id = ?').run(now(), by, r.id);
    pushEvent({ kind: 'support_end', level: 'info', text: `Suporte encerrado · ${END_TEXT[by]}`, ref: r.id });
  }
  if (rows.length) changed();
  return rows.length;
}

export function supportState(): { active: boolean; since: string | null; expiresAt: string | null; by: string | null } {
  sweepExpired();
  const r = db.prepare('SELECT started_at, expires_at, by FROM support_access WHERE ended_at IS NULL ORDER BY started_at DESC, rowid DESC LIMIT 1').get() as { started_at: string; expires_at: string; by: string | null } | undefined;
  return r ? { active: true, since: r.started_at, expiresAt: r.expires_at, by: r.by } : { active: false, since: null, expiresAt: null, by: null };
}

export function supportHistory(limit = 20) {
  sweepExpired();
  return (db.prepare('SELECT id, by, started_at, expires_at, ended_at, ended_by FROM support_access ORDER BY started_at DESC, rowid DESC LIMIT ?').all(limit) as {
    id: string; by: string | null; started_at: string; expires_at: string; ended_at: string | null; ended_by: EndedBy | null;
  }[]).map((r) => ({ id: r.id, by: r.by, startedAt: r.started_at, expiresAt: r.expires_at, endedAt: r.ended_at, endedBy: r.ended_by, active: !r.ended_at }));
}

// ---------- avisos ----------

const LEVELS: NoticeLevel[] = ['info', 'warn', 'crit'];
type NoticeRow = { id: string; title: string; body: string; level: NoticeLevel; push: number; created_at: string; expires_at: string | null; read_at: string | null };
const noticeInfo = (r: NoticeRow) => ({ id: r.id, title: r.title, body: r.body, level: r.level, createdAt: r.created_at, expiresAt: r.expires_at, readAt: r.read_at });

/** Avisos que ainda valem (lidos e não lidos), do mais recente para o mais antigo. */
export function activeNotices() {
  return (db.prepare('SELECT * FROM support_notices WHERE expires_at IS NULL OR expires_at > ? ORDER BY created_at DESC').all(now()) as NoticeRow[]).map(noticeInfo);
}

function parseNotice(p: unknown): NoticePayload | null {
  const n = (p ?? {}) as Partial<NoticePayload>;
  if (typeof n.noticeId !== 'string' || !n.noticeId || n.noticeId.length > 100) return null;
  if (typeof n.title !== 'string' || !n.title.trim() || typeof n.body !== 'string') return null;
  if (!LEVELS.includes(n.level as NoticeLevel)) return null;
  let expiresAt: string | null = null;
  if (n.expiresAt != null) {
    const t = typeof n.expiresAt === 'string' ? Date.parse(n.expiresAt) : NaN;
    if (!Number.isFinite(t)) return null;
    expiresAt = new Date(t).toISOString();
  }
  return { noticeId: n.noticeId, title: n.title.trim().slice(0, 120), body: n.body.trim().slice(0, 1000), level: n.level as NoticeLevel, expiresAt, push: n.push === true };
}

export function saveNotice(n: NoticePayload): boolean {
  const r = db
    .prepare('INSERT INTO support_notices(id, title, body, level, push, created_at, expires_at) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
    .run(n.noticeId, n.title, n.body, n.level, n.push ? 1 : 0, now(), n.expiresAt);
  if (!r.changes) return false;
  changed();
  if (n.level !== 'info' || n.push) {
    void sendPush({ title: n.title, body: n.body.replace(/\s+/g, ' ').slice(0, 180), url: '/', tag: `notice-${n.noticeId}`, priority: n.level === 'crit' ? 'high' : 'normal' }, { force: true }).catch(() => 0);
  }
  return true;
}

export function markNoticeRead(id: string): boolean {
  const r = db.prepare('UPDATE support_notices SET read_at = ? WHERE id = ? AND read_at IS NULL').run(now(), id);
  if (!r.changes) return !!db.prepare('SELECT 1 FROM support_notices WHERE id = ?').get(id);
  pushEvent({ kind: 'notice_read', level: 'info', text: 'Aviso lido', ref: id });
  changed();
  return true;
}

export function cancelNotice(id: string): void {
  if (db.prepare('DELETE FROM support_notices WHERE id = ?').run(id).changes) changed();
}

// ---------- inbox ----------

const TONE = { info: 'cyan', warn: 'warn', crit: 'crit' } as const;
const dismissedSupport = (): string[] => {
  try {
    const v = JSON.parse(kvGet('support_inbox_dismissed') ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export function supportInboxItems(): InboxItem[] {
  const items: InboxItem[] = [];
  const dismissed = new Set(dismissedSupport());
  const active = db.prepare('SELECT id FROM support_access WHERE ended_at IS NULL AND expires_at > ? ORDER BY started_at DESC, rowid DESC LIMIT 1').get(now()) as { id: string } | undefined;
  if (active && !dismissed.has(`support:${active.id}`))
    items.push({ id: `support:${active.id}`, tag: 'Suporte', label: 'Suporte da equipe Atria conectado', tone: 'cyan', action: { type: 'view', view: 'help', params: { tab: 'guia:suporte-e-atualizacoes' } } });
  for (const n of activeNotices()) {
    if (n.readAt) continue;
    items.push({ id: `notice:${n.id}`, tag: 'Aviso', label: n.title, tone: TONE[n.level], action: { type: 'view', view: 'help', params: { tab: 'guia:suporte-e-atualizacoes' } } });
  }
  return items;
}

/** Dispensar no inbox: aviso = lido; suporte = some do inbox (a faixa continua até encerrar). */
export function dismissSupportInbox(id: string): boolean {
  if (id.startsWith('notice:')) return markNoticeRead(id.slice(7));
  if (!id.startsWith('support:')) return false;
  kvSet('support_inbox_dismissed', JSON.stringify([...dismissedSupport().filter((x) => x !== id), id].slice(-100)));
  changed();
  return true;
}

// ---------- página /support (sem script inline: o CSP só aceita script do próprio site) ----------

const PAGE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Atria OS · suporte</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#06070d;color:#e8eaf4;font:15px/1.5 Manrope,system-ui,sans-serif">
<main style="max-width:420px;padding:24px;text-align:center"><div style="width:44px;height:44px;margin:0 auto 18px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff,#67d8f2 45%,#a68cf7)"></div>
<h1 style="font-size:18px;font-weight:600;margin:0 0 8px">Entrando como suporte…</h1>
<p id="msg" role="status" style="margin:0;color:#9aa0bb">Conferindo o link do Atria Central.</p>
<p style="margin:18px 0 0"><a href="/" style="color:#7fdcf5">Ir para o Atria OS</a></p></main>
<script src="/support.js"></script></body></html>`;

const SCRIPT = `(function(){var t=new URLSearchParams(location.search).get('t');history.replaceState(null,'','/support');var m=document.getElementById('msg');
if(!t){m.textContent='Link sem código de acesso. Gere outro no Atria Central.';return;}
fetch('/api/auth/support',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({t:t})})
.then(function(r){if(r.ok){m.textContent='Pronto. Abrindo o Atria OS…';location.replace('/');return;}
return r.json().catch(function(){return{};}).then(function(j){m.textContent=j.error||('Não deu para entrar ('+r.status+').');});})
.catch(function(){m.textContent='Sem conexão com o Atria OS. Tente de novo.';});})();`;

let started = false;
function start() {
  if (started) return;
  started = true;
  onPasswordChange(() => endSupport('password'));
  addInboxSource({ prefixes: ['notice:', 'support:'], items: supportInboxItems, dismiss: dismissSupportInbox });
  registerCommand('support_end', async () => {
    const n = endSupport('central');
    return { status: 'done', text: n ? `${n} acesso(s) encerrado(s)` : 'Nenhum acesso ativo' };
  });
  registerCommand('notice', async (payload) => {
    const n = parseNotice(payload);
    if (!n) return { status: 'failed', text: 'Aviso inválido' };
    saveNotice(n);
    return { status: 'done', text: 'Aviso exibido' };
  });
  registerCommand('notice_cancel', async (payload) => {
    const id = (payload as { noticeId?: unknown } | null)?.noticeId;
    if (typeof id !== 'string' || !id) return { status: 'failed', text: 'Aviso inválido' };
    cancelNotice(id);
    return { status: 'done', text: 'Aviso removido' };
  });
  setInterval(sweepExpired, 60_000).unref();
}

export function register(app: FastifyInstance): void {
  start();

  app.get('/support', (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.type('text/html; charset=utf-8').send(PAGE);
  });
  app.get('/support.js', (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.type('text/javascript; charset=utf-8').send(SCRIPT);
  });

  // Público (/api/auth/*): troca o link assinado por uma sessão de suporte.
  app.post('/api/auth/support', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const c = checkSupportToken((req.body as { t?: unknown } | undefined)?.t);
    if (!c.ok) return reply.code(c.status).send({ error: c.error });
    const id = uid();
    const s = startSession(reply, { kind: 'support', label: c.payload.by, ttlMs: SUPPORT_TTL_MS });
    db.prepare('INSERT INTO support_access(id, token, by, started_at, expires_at) VALUES(?, ?, ?, ?, ?)').run(id, s.token, c.payload.by, now(), s.expiresAt);
    pushEvent({ kind: 'support_login', level: 'warn', text: 'Suporte conectado', ref: id });
    changed();
    void sendPush(
      { title: 'Suporte conectado', body: 'A equipe Atria entrou na sua conta para ajudar. Você pode encerrar o acesso quando quiser.', url: '/app/settings/support', tag: 'support', priority: 'high' },
      { force: true },
    ).catch(() => 0);
    return reply.code(204).send();
  });

  // Público: logado ou não; com sessão, quem é e se há suporte conectado (faixa do topo).
  app.get('/api/auth/status', (req) => {
    const kind = sessionKind(req);
    if (!kind) return { authed: false };
    const st = supportState();
    return { authed: true, session: kind, version: VERSION, support: { active: st.active, since: st.since, expiresAt: st.expiresAt } };
  });

  app.get('/api/support/sessions', () => supportHistory());
  // "Encerrar acesso" (faixa ou Configurações). Vindo da própria sessão de suporte, ela sai também.
  app.delete('/api/support/sessions', (req) => ({ ended: endSupport(sessionKind(req) === 'support' ? 'support' : 'client') }));

  app.get('/api/notices', () => activeNotices());
  app.post('/api/notices/:id/read', (req, reply) => {
    const ok = markNoticeRead((req.params as { id: string }).id);
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'aviso não encontrado' });
  });
}
