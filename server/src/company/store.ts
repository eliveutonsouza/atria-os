import pg from 'pg';
import type { CompanyCategory, CompanyDoc, CompanyDocStage, CompanyDocState } from '../../../shared/protocol.ts';
import { config } from '../config.ts';

// PostgreSQL da base da Empresa (documentos, páginas, trechos, campos, fila, uso) + Qdrant (vetores).

export const pool = new pg.Pool({ connectionString: config.pgUrl || undefined, max: 6, idleTimeoutMillis: 30_000 });
pool.on('error', (e) => console.error('postgres', e.message));

export const q = <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) => pool.query<T>(sql, params);

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS company_profile (
     id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     data JSONB NOT NULL DEFAULT '{}'::jsonb,
     logo_ext TEXT,
     logo_version INT NOT NULL DEFAULT 0,
     updated_at TIMESTAMPTZ
   );
   CREATE TABLE IF NOT EXISTS documents (
     id UUID PRIMARY KEY,
     name TEXT NOT NULL,
     ext TEXT NOT NULL,
     mime TEXT NOT NULL,
     size BIGINT NOT NULL,
     sha256 TEXT NOT NULL UNIQUE,
     category TEXT NOT NULL DEFAULT 'Outros',
     category_locked BOOLEAN NOT NULL DEFAULT false,
     state TEXT NOT NULL DEFAULT 'queued',
     stage SMALLINT NOT NULL DEFAULT 0,
     error TEXT,
     pages INT NOT NULL DEFAULT 0,
     ocr_pages INT NOT NULL DEFAULT 0,
     chunks INT NOT NULL DEFAULT 0,
     doc_type TEXT,
     summary TEXT,
     fields JSONB NOT NULL DEFAULT '[]'::jsonb,
     entities JSONB NOT NULL DEFAULT '[]'::jsonb,
     tags TEXT[] NOT NULL DEFAULT '{}',
     timings JSONB NOT NULL DEFAULT '[]'::jsonb,
     markdown TEXT,
     vault_note TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE TABLE IF NOT EXISTS document_pages (
     doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     page INT NOT NULL,
     ocr BOOLEAN NOT NULL DEFAULT false,
     width REAL NOT NULL DEFAULT 0,
     height REAL NOT NULL DEFAULT 0,
     text TEXT NOT NULL DEFAULT '',
     boxes JSONB NOT NULL DEFAULT '[]'::jsonb,
     PRIMARY KEY (doc_id, page)
   );
   CREATE TABLE IF NOT EXISTS chunks (
     id UUID PRIMARY KEY,
     doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     ord INT NOT NULL,
     page INT,
     tokens INT NOT NULL,
     kind TEXT NOT NULL,
     text TEXT NOT NULL,
     tsv tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', text)) STORED
   );
   CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_id, ord);
   CREATE INDEX IF NOT EXISTS chunks_tsv ON chunks USING GIN (tsv);
   CREATE TABLE IF NOT EXISTS jobs (
     id BIGSERIAL PRIMARY KEY,
     doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     state TEXT NOT NULL DEFAULT 'queued',
     attempts INT NOT NULL DEFAULT 0,
     run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
     error TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(state, run_after);
   CREATE TABLE IF NOT EXISTS queries (
     id BIGSERIAL PRIMARY KEY,
     at TIMESTAMPTZ NOT NULL DEFAULT now(),
     who TEXT NOT NULL,
     query TEXT NOT NULL,
     doc_ids UUID[] NOT NULL DEFAULT '{}',
     top_score REAL,
     answered BOOLEAN NOT NULL DEFAULT true
   );
   CREATE INDEX IF NOT EXISTS queries_at ON queries(at DESC);`,
];

export async function migrate() {
  await q(`CREATE TABLE IF NOT EXISTS schema_version (v INT NOT NULL)`);
  const cur = (await q<{ v: number }>(`SELECT COALESCE(MAX(v), 0) AS v FROM schema_version`)).rows[0].v;
  for (let i = cur; i < MIGRATIONS.length; i++) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(MIGRATIONS[i]);
      await c.query('INSERT INTO schema_version(v) VALUES($1)', [i + 1]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}

export type DocRow = {
  id: string; name: string; ext: string; mime: string; size: string; sha256: string; category: string; category_locked: boolean;
  state: CompanyDocState; stage: number; error: string | null; pages: number; ocr_pages: number; chunks: number;
  doc_type: string | null; summary: string | null; fields: { key: string; value: string }[]; entities: { type: string; value: string }[];
  tags: string[]; timings: CompanyDoc['timings']; vault_note: string | null; created_at: Date; updated_at: Date;
};

export const DOC_COLS = `id, name, ext, mime, size, sha256, category, category_locked, state, stage, error, pages, ocr_pages, chunks, doc_type, summary, fields, entities, tags, timings, vault_note, created_at, updated_at`;

export function toDoc(r: DocRow): CompanyDoc {
  return {
    id: r.id,
    name: r.name,
    ext: r.ext.toUpperCase(),
    mime: r.mime,
    size: Number(r.size),
    category: r.category as CompanyCategory,
    state: r.state,
    stage: Math.max(0, Math.min(5, r.stage)) as CompanyDocStage,
    error: r.error,
    pages: r.pages,
    ocrPages: r.ocr_pages,
    chunks: r.chunks,
    docType: r.doc_type,
    summary: r.summary,
    fields: r.fields ?? [],
    entities: r.entities ?? [],
    tags: r.tags ?? [],
    timings: r.timings ?? [],
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function getDoc(id: string): Promise<CompanyDoc | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await q<DocRow>(`SELECT ${DOC_COLS} FROM documents WHERE id = $1`, [id]);
  return r.rows[0] ? toDoc(r.rows[0]) : null;
}

// ---------- Qdrant (REST) ----------

export const COLLECTION = 'empresa';
const DIM = 1536;

async function qd(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${config.qdrantUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(config.qdrantKey ? { 'api-key': config.qdrantKey } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`qdrant ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export async function ensureCollection() {
  const r = await fetch(`${config.qdrantUrl}/collections/${COLLECTION}`, { headers: config.qdrantKey ? { 'api-key': config.qdrantKey } : {}, signal: AbortSignal.timeout(10_000) });
  if (r.status === 200) return;
  await qd(`/collections/${COLLECTION}`, { method: 'PUT', body: { vectors: { size: DIM, distance: 'Cosine' } } });
  for (const field of ['doc_id', 'category']) {
    await qd(`/collections/${COLLECTION}/index`, { method: 'PUT', body: { field_name: field, field_schema: 'keyword' } });
  }
}

export async function upsertVectors(points: { id: string; vector: number[]; payload: Record<string, unknown> }[]) {
  for (let i = 0; i < points.length; i += 128) {
    await qd(`/collections/${COLLECTION}/points?wait=true`, { method: 'PUT', body: { points: points.slice(i, i + 128) } });
  }
}

export async function deleteVectors(docId: string) {
  await qd(`/collections/${COLLECTION}/points/delete?wait=true`, { method: 'POST', body: { filter: { must: [{ key: 'doc_id', match: { value: docId } }] } } });
}

export async function countVectors(docId?: string): Promise<number> {
  const r = await qd(`/collections/${COLLECTION}/points/count`, { method: 'POST', body: { exact: true, ...(docId ? { filter: { must: [{ key: 'doc_id', match: { value: docId } }] } } : {}) } });
  return r?.result?.count ?? 0;
}

export async function searchVectors(vector: number[], limit: number, category?: string): Promise<{ id: string; score: number }[]> {
  const r = await qd(`/collections/${COLLECTION}/points/search`, {
    method: 'POST',
    body: { vector, limit, with_payload: false, ...(category ? { filter: { must: [{ key: 'category', match: { value: category } }] } } : {}) },
  });
  return (r?.result ?? []).map((p: { id: string; score: number }) => ({ id: String(p.id), score: p.score }));
}

export async function setVectorCategory(docId: string, category: string) {
  await qd(`/collections/${COLLECTION}/points/payload?wait=true`, { method: 'POST', body: { payload: { category }, filter: { must: [{ key: 'doc_id', match: { value: docId } }] } } });
}

export async function healthy() {
  const ok = (p: Promise<unknown>) => p.then(() => true).catch(() => false);
  const [postgres, qdrant, docling] = await Promise.all([
    ok(q('SELECT 1')),
    ok(fetch(`${config.qdrantUrl}/healthz`, { signal: AbortSignal.timeout(3000) }).then((r) => { if (!r.ok) throw new Error(); })),
    ok(fetch(`${config.doclingUrl}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => { if (!r.ok) throw new Error(); })),
  ]);
  return { postgres, qdrant, docling };
}
