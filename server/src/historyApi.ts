import type { FastifyInstance } from 'fastify';
import type { ChatMessage } from '../../shared/protocol.ts';
import { db } from './db.ts';
import { deleteRun, dismissInboxItem, listRunsPage, purgeRuns } from './runs.ts';

// Históricos: execuções (paginar, excluir, limpar antigas), conversa, aprovações resolvidas e inbox.

const isIso = (s: unknown): s is string => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const clampLimit = (v: unknown, def: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.min(max, Math.floor(n)) : def;
};

export interface ApprovalHistoryItem {
  id: string;
  runId: string;
  title: string;
  status: 'approved' | 'rejected' | 'expired';
  kind: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export function approvalHistory(limit = 50): ApprovalHistoryItem[] {
  const rows = db
    .prepare(`SELECT id, run_id, title, status, kind, created_at, resolved_at FROM approvals WHERE status != 'pending' ORDER BY COALESCE(resolved_at, created_at) DESC LIMIT ?`)
    .all(limit) as { id: string; run_id: string; title: string; status: ApprovalHistoryItem['status']; kind: string | null; created_at: string; resolved_at: string | null }[];
  return rows.map((r) => ({ id: r.id, runId: r.run_id, title: r.title, status: r.status, kind: r.kind, createdAt: r.created_at, resolvedAt: r.resolved_at }));
}

export function messagesPage(before: string | null, limit = 60): ChatMessage[] {
  const rows = (before
    ? db.prepare('SELECT id, who, text, at FROM messages WHERE at < ? ORDER BY at DESC LIMIT ?').all(before, limit)
    : db.prepare('SELECT id, who, text, at FROM messages ORDER BY at DESC LIMIT ?').all(limit)) as ChatMessage[];
  return rows.reverse();
}

export function clearMessages(): number {
  return db.prepare('DELETE FROM messages').run().changes;
}

export function register(app: FastifyInstance): void {
  // GET /api/runs (index.ts) continua igual; a paginação do histórico mora aqui.
  app.get('/api/runs/page', (req, reply) => {
    const q = req.query as { before?: string; limit?: string };
    if (q.before !== undefined && !isIso(q.before)) return reply.code(400).send({ error: 'before precisa ser uma data ISO' });
    const limit = clampLimit(q.limit, 40, 100);
    const page = listRunsPage(q.before ?? null, limit);
    // RunInfo não traz created_at: `next` é o cursor para a próxima página
    return { runs: page.runs, hasMore: page.runs.length === limit, next: page.next };
  });

  app.delete('/api/runs/:id', async (req, reply) => {
    try {
      const ok = await deleteRun((req.params as { id: string }).id);
      return ok ? reply.code(204).send() : reply.code(404).send({ error: 'execução não encontrada' });
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });

  app.post('/api/runs/purge', (req, reply) => {
    const days = Number((req.body as { olderThanDays?: unknown } | undefined)?.olderThanDays);
    if (!Number.isInteger(days) || days < 1) return reply.code(400).send({ error: 'olderThanDays precisa ser um inteiro ≥ 1' });
    return { deleted: purgeRuns(days) };
  });

  app.get('/api/messages', (req, reply) => {
    const q = req.query as { before?: string; limit?: string };
    if (q.before !== undefined && !isIso(q.before)) return reply.code(400).send({ error: 'before precisa ser uma data ISO' });
    const limit = clampLimit(q.limit, 60, 200);
    const messages = messagesPage(q.before ?? null, limit);
    return { messages, hasMore: messages.length === limit };
  });

  app.delete('/api/messages', () => ({ deleted: clearMessages() }));

  app.get('/api/approvals/history', (req) => approvalHistory(clampLimit((req.query as { limit?: string }).limit, 50, 200)));

  app.post('/api/inbox/:id/dismiss', (req, reply) => {
    const ok = dismissInboxItem((req.params as { id: string }).id);
    return ok ? reply.code(204).send() : reply.code(400).send({ error: 'só falhas podem ser dispensadas' });
  });
}
