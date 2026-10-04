import webpush from 'web-push';
import type { FastifyInstance } from 'fastify';
import type { ServerEvent } from '../../shared/protocol.ts';
import { db, kvGet, kvSet, now } from './db.ts';
import { onEmit } from './bus.ts';

// Notificações push (PWA): aprovações, falhas e conclusões chegam no celular/desktop mesmo com o app fechado.
// Só envia quando nenhuma tela do console está visível (presença enviada pelo app a cada 30 s).

db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  keys TEXT NOT NULL,
  device TEXT,
  created_at TEXT NOT NULL
)`);

function vapid(): { publicKey: string; privateKey: string } {
  const raw = kvGet('vapid');
  if (raw) return JSON.parse(raw);
  const keys = webpush.generateVAPIDKeys();
  kvSet('vapid', JSON.stringify(keys));
  return keys;
}

let lastVisible = 0;
const VISIBLE_MS = 45_000;

interface PushMsg {
  title: string;
  body: string;
  url: string;
  tag: string;
  priority?: 'high' | 'normal';
}

export async function sendPush(msg: PushMsg, opts: { force?: boolean } = {}): Promise<number> {
  if (!opts.force && Date.now() - lastVisible < VISIBLE_MS) return 0;
  const subs = db.prepare('SELECT endpoint, keys FROM push_subscriptions').all() as { endpoint: string; keys: string }[];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, JSON.stringify(msg), {
          TTL: 6 * 3600,
          urgency: msg.priority === 'high' ? 'high' : 'normal',
          topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
        });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(s.endpoint);
        else console.error('push', code, (e as Error).message);
      }
    }),
  );
  return sent;
}

// Evita repetir a mesma notificação (ex.: mission.updated chega várias vezes com o mesmo status).
const sentKeys = new Set<string>();
const once = (key: string) => {
  if (sentKeys.has(key)) return false;
  sentKeys.add(key);
  if (sentKeys.size > 2000) sentKeys.clear();
  return true;
};
const short = (s: string | null | undefined, n = 140) => {
  const t = (s ?? '').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

function onEvent(ev: ServerEvent) {
  switch (ev.type) {
    case 'approval.requested':
      if (once(`approval:${ev.approval.id}`))
        void sendPush({ title: 'Aprovação necessária', body: ev.approval.title, url: '/', tag: `approval-${ev.approval.id}`, priority: 'high' });
      break;
    case 'run.updated': {
      const r = ev.run;
      if (r.missionId || r.workflowRunId) break; // missão/workflow avisam no fim do conjunto
      if (r.state === 'failed' && once(`run-failed:${r.id}`))
        void sendPush({ title: `${r.agent} não conseguiu concluir`, body: short(r.result ?? r.task), url: `/runs/${r.id}`, tag: `run-${r.id}`, priority: 'high' });
      if (r.state === 'done' && once(`run-done:${r.id}`))
        void sendPush({ title: `${r.agent} concluiu`, body: short(r.result ?? r.task), url: `/runs/${r.id}`, tag: `run-${r.id}` });
      break;
    }
    case 'mission.updated': {
      const m = ev.mission;
      if (['done', 'failed', 'blocked'].includes(m.status) && once(`mission:${m.id}:${m.status}`)) {
        const title = m.status === 'done' ? `Missão concluída · ${m.title}` : `Missão precisa de atenção · ${m.title}`;
        const last = [...m.steps].reverse().find((s) => s.result);
        void sendPush({ title, body: short(last?.result ?? m.goal), url: `/missions/${m.id}`, tag: `mission-${m.id}`, priority: m.status === 'done' ? 'normal' : 'high' });
      }
      break;
    }
    case 'workflow.run.updated': {
      const w = ev.run;
      if (['done', 'failed'].includes(w.status) && once(`wf:${w.id}:${w.status}`)) {
        const results = Object.values(w.nodes).map((n) => n.result).filter(Boolean);
        void sendPush({
          title: w.status === 'done' ? `Workflow concluído · ${w.workflow}` : `Workflow falhou · ${w.workflow}`,
          body: short(results.at(-1) ?? ''),
          url: `/workflows/${w.workflow}`,
          tag: `wf-${w.id}`,
          priority: w.status === 'done' ? 'normal' : 'high',
        });
      }
      break;
    }
  }
}

export function register(app: FastifyInstance): void {
  const keys = vapid();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:eliveuton.dev@gmail.com', keys.publicKey, keys.privateKey);
  onEmit(onEvent);

  app.get('/api/push/key', () => ({ key: keys.publicKey }));

  app.post('/api/push/subscribe', async (req, reply) => {
    const b = (req.body ?? {}) as { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; device?: string };
    const sub = b.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth || !/^https:\/\//.test(sub.endpoint)) return reply.code(400).send({ error: 'subscription' });
    db.prepare(`INSERT INTO push_subscriptions(endpoint, keys, device, created_at) VALUES(?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET keys = excluded.keys, device = excluded.device`).run(sub.endpoint, JSON.stringify(sub.keys), (b.device ?? '').slice(0, 80), now());
    return reply.code(204).send();
  });

  app.post('/api/push/unsubscribe', async (req, reply) => {
    const endpoint = (req.body as { endpoint?: string } | undefined)?.endpoint;
    if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    return reply.code(204).send();
  });

  app.get('/api/push/devices', () => db.prepare('SELECT device, created_at FROM push_subscriptions ORDER BY created_at DESC').all());

  app.post('/api/push/test', async () => ({
    sent: await sendPush({ title: 'Yui', body: 'Notificações funcionando neste dispositivo. ✓', url: '/', tag: 'test' }, { force: true }),
  }));

  app.post('/api/push/presence', async (_req, reply) => {
    lastVisible = Date.now();
    return reply.code(204).send();
  });
}
