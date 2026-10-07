import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.ts';
import { db, kvSet, now } from './db.ts';
import { setRaw } from './settings.ts';

const COOKIE = 'atria_sid';
const TTL_DAYS = 30;

function validSession(token: string | undefined): boolean {
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token) as { expires_at: string } | undefined;
  return !!row && row.expires_at > now();
}

// Para upgrades crus (WebSocket fora do roteamento do Fastify).
export function isAuthedCookieHeader(header: string | undefined): boolean {
  const m = (header ?? '').match(/(?:^|;\s*)atria_sid=([^;]+)/);
  return validSession(m ? decodeURIComponent(m[1]) : undefined);
}

export function isAuthed(req: FastifyRequest): boolean {
  return validSession(req.cookies[COOKIE]);
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAuthed(req)) {
    await reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  kvSet('last_active', now());
}

// Cria sessão e grava o cookie (login e primeiro acesso).
export function startSession(reply: FastifyReply) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + TTL_DAYS * 86400_000);
  db.prepare('INSERT INTO sessions(token, created_at, expires_at) VALUES(?, ?, ?)').run(token, now(), expires.toISOString());
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  reply.setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict', secure: config.secureCookies, expires });
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
      if (!isAuthed(req)) return reply.code(401).send({ error: 'unauthorized' });
      const b = (req.body ?? {}) as { current?: unknown; next?: unknown };
      if (typeof b.current !== 'string' || typeof b.next !== 'string') return reply.code(400).send({ error: 'Informe a senha atual e a nova.' });
      const ok = config.passwordHash ? await verify(config.passwordHash, b.current).catch(() => false) : false;
      if (!ok) return reply.code(403).send({ error: 'Senha atual incorreta.' });
      try {
        await setPassword(b.next);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
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
