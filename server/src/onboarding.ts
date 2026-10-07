import type { FastifyInstance } from 'fastify';
import type { SetupStatus } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db } from './db.ts';
import { hasPassword, setPassword, startSession } from './auth.ts';
import { claudeLoggedIn } from './runs.ts';
import { githubEnabled } from './github.ts';
import { getSetting, onSettingsChange, setRaw } from './settings.ts';
import { refreshOpenAI } from './brain.ts';
import { monitorConfig } from './telemetry.ts';

// Primeiro acesso e "Primeiros passos": numa instalação nova não há senha — quem abre o painel cria o acesso,
// depois conecta Claude, GitHub e OpenAI pelo próprio painel (terminal embutido).

function status(): SetupStatus {
  const claude = claudeLoggedIn() ? 'claude.ai' : config.claudeToken ? 'token' : 'none';
  const openai = !!getSetting('openai.key');
  const push = (db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get('push_subscriptions') as { n: number }).n
    ? (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n
    : 0;
  const m = monitorConfig();
  return { needsPassword: !hasPassword(), claude, github: githubEnabled(), openai, push, monitor: m.enabled && !!m.url && !!m.key, completed: hasPassword() && claude !== 'none' && openai };
}

export function register(app: FastifyInstance): void {
  onSettingsChange((keys) => {
    if (keys.includes('openai.key')) refreshOpenAI();
  });

  // Público (rotas /api/auth/* não exigem sessão): só diz se falta criar o acesso.
  app.get('/api/auth/setup', async () => ({ needsPassword: !hasPassword() }));

  // Cria o acesso — só funciona enquanto não existe senha nenhuma (nem no .env, nem no banco).
  app.post(
    '/api/auth/setup',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      if (hasPassword()) return reply.code(409).send({ error: 'O acesso já foi criado. Entre com a sua senha.' });
      const b = (req.body ?? {}) as { password?: unknown; name?: unknown; email?: unknown };
      if (typeof b.password !== 'string') return reply.code(400).send({ error: 'Defina uma senha.' });
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
      const email = typeof b.email === 'string' ? b.email.trim().slice(0, 120) : '';
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({ error: 'E-mail inválido.' });
      try {
        await setPassword(b.password);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
      if (name) setRaw('user.name', name);
      if (email) setRaw('user.email', email);
      startSession(reply);
      return reply.code(204).send();
    },
  );

  // Autenticado: estado completo dos primeiros passos.
  app.get('/api/setup/status', () => status());
}
