import type { FastifyInstance } from 'fastify';
import type { ReminderInfo } from '../../shared/protocol.ts';
import { db } from './db.ts';
import { REPETICOES, cancelarLembrete, criarLembrete, editarLembrete, excluirLembrete, getLembrete, type Lembrete, type Repeticao } from './lembretes.ts';

// Lembretes pelo painel (página Lembretes). A Yui usa as mesmas funções pelas tools lembrete_*.

const toInfo = (r: Lembrete): ReminderInfo => ({ id: r.id, text: r.text, dueAt: r.due_at, repeat: r.repeat, status: r.status, createdAt: r.created_at, firedAt: r.fired_at });

const FILTRO: Record<string, string> = {
  pending: `status IN ('pending', 'missed') ORDER BY due_at`,
  done: `status = 'done' ORDER BY COALESCE(fired_at, due_at) DESC LIMIT 200`,
  cancelled: `status = 'cancelled' ORDER BY due_at DESC LIMIT 200`,
  all: `1 = 1 ORDER BY due_at DESC LIMIT 500`,
};

export function listReminders(status = 'pending'): ReminderInfo[] {
  const where = FILTRO[status] ?? FILTRO.pending;
  return (db.prepare(`SELECT * FROM reminders WHERE ${where}`).all() as Lembrete[]).map(toInfo);
}

// undefined = campo ausente (mantém); null = sem repetição.
function parseRepeat(v: unknown): Repeticao | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v === 'string' && (REPETICOES as readonly string[]).includes(v)) return v as Repeticao;
  throw new Error('repetição inválida');
}

const editavel = (r: Lembrete) => r.status === 'pending' || r.status === 'missed';

export function register(app: FastifyInstance): void {
  app.get('/api/reminders', (req) => listReminders((req.query as { status?: string }).status));

  app.post('/api/reminders', (req, reply) => {
    const b = (req.body ?? {}) as { text?: unknown; dueAt?: unknown; repeat?: unknown };
    try {
      if (typeof b.text !== 'string' || typeof b.dueAt !== 'string') throw new Error('informe texto e horário');
      const r = criarLembrete({ texto: b.text, quando: b.dueAt, repetir: parseRepeat(b.repeat) ?? null });
      return reply.code(201).send(toInfo(r));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.put('/api/reminders/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { text?: unknown; dueAt?: unknown; repeat?: unknown };
    const cur = getLembrete(id);
    if (!cur) return reply.code(404).send({ error: 'lembrete não encontrado' });
    if (!editavel(cur)) return reply.code(409).send({ error: 'só lembretes pendentes podem ser editados' });
    try {
      if (b.text !== undefined && typeof b.text !== 'string') throw new Error('texto inválido');
      if (b.dueAt !== undefined && typeof b.dueAt !== 'string') throw new Error('horário inválido');
      const r = editarLembrete(id, { texto: b.text, quando: b.dueAt, repetir: parseRepeat(b.repeat) });
      return r ? toInfo(r) : reply.code(409).send({ error: 'só lembretes pendentes podem ser editados' });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/reminders/:id/cancel', (req, reply) => {
    const cur = getLembrete((req.params as { id: string }).id);
    if (!cur) return reply.code(404).send({ error: 'lembrete não encontrado' });
    return cancelarLembrete(cur.id) ? reply.code(204).send() : reply.code(409).send({ error: 'esse lembrete já saiu da fila' });
  });

  app.delete('/api/reminders/:id', (req, reply) =>
    excluirLembrete((req.params as { id: string }).id) ? reply.code(204).send() : reply.code(404).send({ error: 'lembrete não encontrado' }),
  );
}
