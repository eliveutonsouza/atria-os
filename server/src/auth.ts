import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.ts';
import { db, kvSet, now } from './db.ts';
import { setRaw } from './settings.ts';

const COOKIE = 'atria_sid';
const TTL_DAYS = 30;

export type SessionKind = 'owner' | 'support';

function sessionRow(token: string | undefined): { kind: SessionKind; expires_at: string } | null {
  if (!token) return null;
  const row = db.prepare('SELECT kind, expires_at FROM sessions WHERE token = ?').get(token) as { kind: string | null; expires_at: string } | undefined;
  if (!row || row.expires_at <= now()) return null;
  return { kind: row.kind === 'support' ? 'support' : 'owner', expires_at: row.expires_at };
}

const validSession = (token: string | undefined) => !!sessionRow(token);

// Para upgrades crus (WebSocket fora do roteamento do Fastify).
export function isAuthedCookieHeader(header: string | undefined): boolean {
  const m = (header ?? '').match(/(?:^|;\s*)atria_sid=([^;]+)/);
  return validSession(m ? decodeURIComponent(m[1]) : undefined);
}

export function isAuthed(req: FastifyRequest): boolean {
  return validSession(req.cookies[COOKIE]);
}

/** Quem está logado nesta requisição: o dono ou a equipe de suporte (null = sem sessão). */
export function sessionKind(req: FastifyRequest): SessionKind | null {
  return sessionRow(req.cookies[COOKIE])?.kind ?? null;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAuthed(req)) {
    await reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  // o suporte não conta como uso do dono (telemetria "última atividade")
  if (sessionKind(req) !== 'support') kvSet('last_active', now());
}

// Cria sessão e grava o cookie (login, primeiro acesso e suporte remoto, que dura menos e fica marcado).
export function startSession(reply: FastifyReply, opts: { kind?: SessionKind; label?: string; ttlMs?: number } = {}): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + (opts.ttlMs ?? TTL_DAYS * 86400_000));
  db.prepare('INSERT INTO sessions(token, created_at, expires_at, kind, label) VALUES(?, ?, ?, ?, ?)').run(token, now(), expires.toISOString(), opts.kind ?? 'owner', opts.label ?? null);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  reply.setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict', secure: config.secureCookies, expires });
  return { token, expiresAt: expires.toISOString() };
}

// Troca de senha: o suporte remoto (support.ts) encerra e registra os acessos ativos.
const passwordListeners: (() => void)[] = [];
export function onPasswordChange(fn: () => void) {
  passwordListeners.push(fn);
}

export const hasPassword = () => !!config.passwordHash;

export async function setPassword(plain: string) {
  if (plain.length < 8) throw new Error('A senha precisa de pelo menos 8 caracteres.');
  setRaw('auth.passwordHash', await hash(plain));
}

export function registerAuth(app: FastifyInstance): void {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const password = (req.body as { password?: unknown } | undefined)?.password;
      if (typeof password !== 'string' || !config.passwordHash) return reply.code(401).send({ error: 'invalid' });
      const ok = await verify(config.passwordHash, password).catch(() => false);
      if (!ok) return reply.code(401).send({ error: 'invalid' });
      startSession(reply);
      return reply.code(204).send();
    },
  );

  // Trocar senha (logado). Encerra as outras sessões.
  app.post(
    '/api/auth/password',
    { config: { rateLimit: { max: 6, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const kind = sessionKind(req);
      if (!kind) return reply.code(401).send({ error: 'unauthorized' });
      if (kind === 'support') return reply.code(403).send({ error: 'O suporte não pode trocar a senha. Só o dono da conta.' });
      const b = (req.body ?? {}) as { current?: unknown; next?: unknown };
      if (typeof b.current !== 'string' || typeof b.next !== 'string') return reply.code(400).send({ error: 'Informe a senha atual e a nova.' });
      const ok = config.passwordHash ? await verify(config.passwordHash, b.current).catch(() => false) : false;
      if (!ok) return reply.code(403).send({ error: 'Senha atual incorreta.' });
      try {
        await setPassword(b.next);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
      for (const fn of passwordListeners) fn();
      db.prepare('DELETE FROM sessions WHERE token != ?').run(req.cookies[COOKIE] ?? '');
      return reply.code(204).send();
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    reply.clearCookie(COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}
