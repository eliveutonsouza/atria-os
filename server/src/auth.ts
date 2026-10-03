import { randomBytes } from 'node:crypto';
import { verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.ts';
import { db, kvSet, now } from './db.ts';

const COOKIE = 'yui_sid';
const TTL_DAYS = 30;

function validSession(token: string | undefined): boolean {
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token) as { expires_at: string } | undefined;
  return !!row && row.expires_at > now();
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

export function registerAuth(app: FastifyInstance): void {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const password = (req.body as { password?: unknown } | undefined)?.password;
      if (typeof password !== 'string' || !config.passwordHash) return reply.code(401).send({ error: 'invalid' });
      const ok = await verify(config.passwordHash, password).catch(() => false);
      if (!ok) return reply.code(401).send({ error: 'invalid' });
      const token = randomBytes(32).toString('base64url');
      const expires = new Date(Date.now() + TTL_DAYS * 86400_000);
      db.prepare('INSERT INTO sessions(token, created_at, expires_at) VALUES(?, ?, ?)').run(token, now(), expires.toISOString());
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
      reply.setCookie(COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: config.secureCookies,
        expires,
      });
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
