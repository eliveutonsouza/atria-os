import type { FastifyInstance } from 'fastify';
import { db } from './db.ts';
import { findProject } from './projects.ts';
import { registerBrain } from './extensions.ts';

// Busca no histórico (ideia do session_search do Hermes): índice FTS5 do SQLite sobre a conversa (messages.text)
// e as execuções (runs.task + runs.result), sincronizado por triggers. Se o SQLite não tiver FTS5, cai para LIKE.

export interface HistoryHit {
  kind: 'conversa' | 'execucao';
  id: string;
  at: string;
  who: string; // "Você" | "Yui" | nome do agente
  project: string | null;
  snippet: string;
}

function setupFts(): boolean {
  try {
    const had = db.prepare(`SELECT name FROM sqlite_master WHERE name IN ('messages_fts', 'runs_fts')`).all() as { name: string }[];
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE OF text ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
        INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
      CREATE VIRTUAL TABLE IF NOT EXISTS runs_fts USING fts5(task, result, content='runs', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS runs_fts_ai AFTER INSERT ON runs BEGIN
        INSERT INTO runs_fts(rowid, task, result) VALUES (new.rowid, new.task, COALESCE(new.result, ''));
      END;
      CREATE TRIGGER IF NOT EXISTS runs_fts_ad AFTER DELETE ON runs BEGIN
        INSERT INTO runs_fts(runs_fts, rowid, task, result) VALUES ('delete', old.rowid, old.task, COALESCE(old.result, ''));
      END;
      CREATE TRIGGER IF NOT EXISTS runs_fts_au AFTER UPDATE OF task, result ON runs BEGIN
        INSERT INTO runs_fts(runs_fts, rowid, task, result) VALUES ('delete', old.rowid, old.task, COALESCE(old.result, ''));
        INSERT INTO runs_fts(rowid, task, result) VALUES (new.rowid, new.task, COALESCE(new.result, ''));
      END;
    `);
    // índices novos: indexa o que já existia
    if (!had.some((t) => t.name === 'messages_fts')) db.exec(`INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')`);
    if (!had.some((t) => t.name === 'runs_fts')) db.exec(`INSERT INTO runs_fts(runs_fts) VALUES ('rebuild')`);
    return true;
  } catch (e) {
    console.error('busca: FTS5 indisponível, usando LIKE', (e as Error).message);
    return false;
  }
}
export const ftsEnabled = setupFts();

// Palavras do usuário viram termos com prefixo, todos obrigatórios: "domínio stoq" -> "dominio"* "stoq"*
export function ftsQuery(q: string): string | null {
  const words = q
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu);
  return words?.length ? words.slice(0, 8).map((w) => `"${w}"*`).join(' ') : null;
}

const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function searchHistory(q: string, opts: { project?: string | null; limit?: number } = {}): HistoryHit[] {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 15));
  const projFilter = opts.project !== undefined;
  const hits: HistoryHit[] = [];
  const fq = ftsQuery(q);
  if (!fq) return [];
  if (ftsEnabled) {
    const msgs = db.prepare(`
      SELECT m.id, m.who, m.at, m.project, snippet(messages_fts, 0, '«', '»', '…', 24) AS snip
      FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
      WHERE messages_fts MATCH ? ${projFilter ? 'AND m.project IS ?' : ''}
      ORDER BY m.at DESC LIMIT ?`).all(...[fq, ...(projFilter ? [opts.project ?? null] : []), limit]) as { id: string; who: string; at: string; project: string | null; snip: string }[];
    for (const m of msgs) hits.push({ kind: 'conversa', id: m.id, at: m.at, who: m.who === 'yui' ? 'Yui' : 'Você', project: m.project, snippet: m.snip });
    const rs = db.prepare(`
      SELECT r.id, r.agent_id, r.created_at AS at, r.project, r.task, snippet(runs_fts, 1, '«', '»', '…', 24) AS snip
      FROM runs_fts JOIN runs r ON r.rowid = runs_fts.rowid
      WHERE runs_fts MATCH ? ${projFilter ? 'AND r.project IS ?' : ''}
      ORDER BY r.created_at DESC LIMIT ?`).all(...[fq, ...(projFilter ? [opts.project ?? null] : []), limit]) as { id: string; agent_id: string; at: string; project: string | null; task: string; snip: string }[];
    for (const r of rs) hits.push({ kind: 'execucao', id: r.id, at: r.at, who: r.agent_id, project: r.project, snippet: `${clip(r.task, 90)} — ${r.snip || ''}`.replace(/ — $/, '') });
  } else {
    const like = `%${q.trim().slice(0, 100)}%`;
    const msgs = db.prepare(`SELECT id, who, at, project, text FROM messages WHERE text LIKE ? ${projFilter ? 'AND project IS ?' : ''} ORDER BY at DESC LIMIT ?`)
      .all(...[like, ...(projFilter ? [opts.project ?? null] : []), limit]) as { id: string; who: string; at: string; project: string | null; text: string }[];
    for (const m of msgs) hits.push({ kind: 'conversa', id: m.id, at: m.at, who: m.who === 'yui' ? 'Yui' : 'Você', project: m.project, snippet: clip(m.text) });
    const rs = db.prepare(`SELECT id, agent_id, created_at AS at, project, task, result FROM runs WHERE (task LIKE ? OR result LIKE ?) ${projFilter ? 'AND project IS ?' : ''} ORDER BY created_at DESC LIMIT ?`)
      .all(...[like, like, ...(projFilter ? [opts.project ?? null] : []), limit]) as { id: string; agent_id: string; at: string; project: string | null; task: string; result: string | null }[];
    for (const r of rs) hits.push({ kind: 'execucao', id: r.id, at: r.at, who: r.agent_id, project: r.project, snippet: clip(`${r.task} — ${r.result ?? ''}`) });
  }
  return hits.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

registerBrain({
  name: 'busca-historico',
  instructions: '- "O que eu te pedi sobre X?", "quando falamos de Y?", "o que o agente fez sobre Z semana passada?" => buscar_historico (responda com data e o essencial em 1–3 frases; não leia o trecho inteiro).',
  tools: [
    {
      type: 'function', name: 'buscar_historico', strict: true,
      description: 'Busca na conversa antiga com a Yui e nos resultados das execuções dos agentes (mais recentes primeiro).',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          termos: { type: 'string', description: 'palavras-chave do assunto (sem artigos)' },
          projeto: { type: ['string', 'null'], description: 'slug/nome para filtrar; null = todos os projetos' },
        },
        required: ['termos', 'projeto'],
      },
    },
  ],
  run(tool, args) {
    if (tool !== 'buscar_historico') return undefined;
    const p = typeof args.projeto === 'string' && args.projeto ? findProject(args.projeto) : undefined;
    const hits = searchHistory(String(args.termos ?? ''), { ...(p ? { project: p.slug } : {}), limit: 10 });
    return Promise.resolve(hits.length ? { resultados: hits.map((h) => ({ tipo: h.kind, quando: h.at, quem: h.who, projeto: h.project ?? 'Geral', trecho: h.snippet })) } : { resultados: [], nota: 'nada encontrado com esses termos' });
  },
});

export function register(app: FastifyInstance): void {
  app.get('/api/history/search', (req, reply) => {
    const q = req.query as { q?: string; project?: string; limit?: string };
    if (!q.q || q.q.trim().length < 2) return reply.code(400).send({ error: 'q precisa de ao menos 2 letras' });
    const limit = Number(q.limit) || 30;
    return searchHistory(q.q, { ...(q.project !== undefined ? { project: q.project || null } : {}), limit });
  });
}
