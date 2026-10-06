import { trackOpenAI } from '../usage.ts';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { COMPANY_CATEGORIES, type CompanyDoc, type CompanyDocStage } from '../../../shared/protocol.ts';
import { config } from '../config.ts';
import { emit } from '../bus.ts';
import { openai } from '../brain.ts';
import { chunkItems, pagesFrom, readingOrder, type DoclingJson } from './chunk.ts';
import { doclingFormat } from './files.ts';
import { deleteVectors, getDoc, q, upsertVectors } from './store.ts';
import { removeDocNote, writeDocNote } from './vaultSync.ts';

// Fila de processamento (tabela jobs, um documento por vez — o Docling é pesado):
// 1 Docling (parser + OCR) → 2 extração estruturada → 3 embeddings → 4 Qdrant → 5 pronto.

export const filesDir = () => join(config.dataDir, 'company', 'files');
export const docDir = (id: string) => join(filesDir(), id);
export function originalPath(id: string): string | null {
  const d = docDir(id);
  if (!existsSync(d)) return null;
  const f = readdirSync(d).find((x) => x.startsWith('original.'));
  return f ? join(d, f) : null;
}

const LABEL: Record<number, string> = { 0: 'Recebido', 1: 'Lido pelo Docling', 2: 'Dados extraídos', 3: 'Embeddings', 4: 'Indexado no Qdrant' };
const MAX_ATTEMPTS = 3;

class Permanent extends Error {}

async function publish(id: string) {
  const d = await getDoc(id);
  if (d) emit({ type: 'company.doc.updated', doc: d });
  return d;
}

async function setStage(id: string, stage: CompanyDocStage, extra: Record<string, unknown> = {}) {
  const keys = Object.keys(extra);
  const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  await q(`UPDATE documents SET stage = $2, updated_at = now()${sets ? `, ${sets}` : ''} WHERE id = $1`, [id, stage, ...keys.map((k) => extra[k])]);
  await publish(id);
}

async function addTiming(id: string, stage: CompanyDocStage, ms: number, detail?: string) {
  await q(`UPDATE documents SET timings = timings || $2::jsonb WHERE id = $1`, [id, JSON.stringify([{ stage, label: LABEL[stage] ?? '', ms: Math.round(ms), ...(detail ? { detail } : {}) }])]);
}

// ---------- 1. Docling ----------

async function convert(id: string, doc: CompanyDoc) {
  const file = originalPath(id);
  if (!file) throw new Permanent('arquivo original não encontrado');
  const ext = doc.ext.toLowerCase();
  const from = doclingFormat(ext);
  if (!from) throw new Permanent(`tipo .${ext} não suportado`);
  const fd = new FormData();
  // .txt vai como markdown (o Docling não tem leitor de texto puro)
  const sendName = ext === 'txt' ? `${doc.name.replace(/\.txt$/i, '')}.md` : doc.name;
  fd.append('files', new Blob([readFileSync(file)]), sendName);
  for (const f of ['md', 'json']) fd.append('to_formats', f);
  fd.append('from_formats', from);
  fd.append('ocr_lang', 'pt');
  fd.append('ocr_lang', 'en');
  fd.append('image_export_mode', 'placeholder');
  fd.append('include_images', 'false');
  fd.append('do_pdf_heading_hierarchy', 'true');
  fd.append('abort_on_error', 'false');
  const res = await fetch(`${config.doclingUrl}/v1/convert/file`, { method: 'POST', body: fd, signal: AbortSignal.timeout(20 * 60_000) });
  const text = await res.text();
  if (!res.ok) {
    if (res.status >= 500 || res.status === 429) throw new Error(`Docling ${res.status}: ${text.slice(0, 200)}`);
    throw new Permanent(`Docling recusou o arquivo (${res.status}): ${text.slice(0, 200)}`);
  }
  const out = JSON.parse(text) as {
    status: string;
    errors?: { error_message?: string }[];
    document?: { md_content?: string; json_content?: DoclingJson };
    confidence?: { ocr_score?: number | null };
  };
  const md = out.document?.md_content ?? '';
  const json = out.document?.json_content;
  if (out.status === 'failure' || !json) {
    const msg = out.errors?.map((e) => e.error_message).filter(Boolean).join('; ') || 'falha na leitura';
    throw new Permanent(/password|encrypt/i.test(msg) ? 'PDF protegido por senha — envie uma versão sem senha' : `não consegui ler o arquivo: ${msg.slice(0, 200)}`);
  }
  if (!md.trim()) throw new Permanent('nenhum texto encontrado no arquivo (nem com OCR)');
  const items = readingOrder(json);
  const usedOcr = out.confidence?.ocr_score != null || from === 'image';
  const pageNos = Object.values(json.pages ?? {}).map((p) => p.page_no);
  const pages = pagesFrom(json, items, new Set(usedOcr ? pageNos : []));
  return { md, items, pages, ocrPages: usedOcr ? pageNos.length : 0 };
}

// ---------- 2. extração estruturada ----------

const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['doc_type', 'summary', 'category', 'fields', 'entities', 'tags'],
  properties: {
    doc_type: { type: 'string', description: 'Tipo do documento em poucas palavras (ex.: Tabela de preços, Contrato de prestação de serviços, Manual da marca, Nota fiscal, Proposta comercial).' },
    summary: { type: 'string', description: 'Resumo fiel em 1 a 3 frases em português.' },
    category: { type: 'string', enum: [...COMPANY_CATEGORIES] },
    fields: {
      type: 'array', maxItems: 14,
      description: 'Campos-chave do documento (vigência, valores, prazos, partes, condições de pagamento, número…). Só o que está escrito.',
      items: { type: 'object', additionalProperties: false, required: ['key', 'value'], properties: { key: { type: 'string' }, value: { type: 'string' } } },
    },
    entities: {
      type: 'array', maxItems: 30,
      items: {
        type: 'object', additionalProperties: false, required: ['type', 'value'],
        properties: { type: { type: 'string', enum: ['cliente', 'fornecedor', 'pessoa', 'serviço', 'produto', 'preço', 'data', 'prazo', 'local', 'documento'] }, value: { type: 'string' } },
      },
    },
    tags: { type: 'array', maxItems: 8, items: { type: 'string' } },
  },
} as const;

async function extract(doc: CompanyDoc, md: string) {
  const res = await openai.responses.create({
    model: config.brainModel,
    instructions:
      'Você cataloga documentos de uma empresa para uma base de conhecimento. Extraia só o que está no texto, sem inventar. ' +
      'Valores com a moeda e a grafia do documento. Datas no formato do documento. Tags curtas, minúsculas, sem #. ' +
      'Categorias: Comercial (preços, propostas, apresentações, catálogo), Contratos, Marca (identidade, tom, manual), Processos (procedimentos, políticas, SLA, checklists), Financeiro (notas, recibos, custos, impostos), Clientes (material de um cliente específico), Outros.',
    input: `Arquivo: ${doc.name}\n\n${md.slice(0, 16000)}`,
    text: { format: { type: 'json_schema', name: 'company_doc', schema: EXTRACT_SCHEMA as unknown as Record<string, unknown>, strict: true } },
  });
  trackOpenAI('empresa', res.model, res.usage);
  const r = JSON.parse(res.output_text) as {
    doc_type: string; summary: string; category: string; fields: { key: string; value: string }[]; entities: { type: string; value: string }[]; tags: string[];
  };
  return {
    ...r,
    tags: [...new Set(r.tags.map((t) => t.toLowerCase().replace(/^#/, '').replace(/\s+/g, '-')).filter(Boolean))],
    category: (COMPANY_CATEGORIES as readonly string[]).includes(r.category) ? r.category : 'Outros',
  };
}

// ---------- 3. embeddings ----------

export async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const r = await openai.embeddings.create({ model: config.embedModel, input: texts.slice(i, i + 64).map((t) => t.slice(0, 24000)) });
    trackOpenAI('empresa-embeddings', r.model, r.usage);
    out.push(...r.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }
  return out;
}

// ---------- processamento de um documento ----------

async function processDoc(id: string) {
  const doc = await getDoc(id);
  if (!doc) return;
  await q(`UPDATE documents SET state = 'processing', error = NULL, timings = '[]'::jsonb, updated_at = now() WHERE id = $1`, [id]);
  await clearDerived(id);
  await addTiming(id, 0, 0, `${doc.ext} · ${(doc.size / 1024).toFixed(0)} KB`);

  let t = Date.now();
  await setStage(id, 1);
  const conv = await convert(id, doc);
  const tables = conv.items.filter((i) => i.kind === 'table').length;
  await addTiming(id, 1, Date.now() - t, `${conv.pages.length} ${conv.pages.length === 1 ? 'página' : 'páginas'} · ${tables} ${tables === 1 ? 'tabela' : 'tabelas'} · ${conv.ocrPages ? `OCR em ${conv.ocrPages}` : 'sem OCR'}`);
  for (const p of conv.pages) {
    await q(`INSERT INTO document_pages(doc_id, page, ocr, width, height, text, boxes) VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, p.page, p.ocr, p.width, p.height, p.text, JSON.stringify(p.boxes)]);
  }
  await q(`UPDATE documents SET pages = $2, ocr_pages = $3, markdown = $4 WHERE id = $1`, [id, conv.pages.length || 1, conv.ocrPages, conv.md]);

  t = Date.now();
  await setStage(id, 2);
  const ex = await extract(doc, conv.md);
  const locked = (await q<{ category_locked: boolean }>(`SELECT category_locked FROM documents WHERE id = $1`, [id])).rows[0]?.category_locked;
  await q(
    `UPDATE documents SET doc_type = $2, summary = $3, fields = $4, entities = $5, tags = $6${locked ? '' : ', category = $7'} WHERE id = $1`,
    [id, ex.doc_type, ex.summary, JSON.stringify(ex.fields), JSON.stringify(ex.entities), ex.tags, ...(locked ? [] : [ex.category])],
  );
  await addTiming(id, 2, Date.now() - t, `${ex.fields.length} campos · ${ex.entities.length} entidades`);

  t = Date.now();
  await setStage(id, 3);
  const drafts = chunkItems(conv.items);
  const chunks = drafts.map((c) => ({ ...c, id: randomUUID() }));
  const current = (await getDoc(id))!;
  const vectors = await embed(chunks.map((c) => `Documento: ${current.name} (${current.category}${current.docType ? `, ${current.docType}` : ''})\n\n${c.text}`));
  for (const c of chunks) {
    await q(`INSERT INTO chunks(id, doc_id, ord, page, tokens, kind, text) VALUES($1,$2,$3,$4,$5,$6,$7)`, [c.id, id, c.ord, c.page, c.tokens, c.kind, c.text]);
  }
  await addTiming(id, 3, Date.now() - t, `${chunks.length} trechos · ${config.embedModel}`);

  t = Date.now();
  await setStage(id, 4);
  await upsertVectors(chunks.map((c, i) => ({ id: c.id, vector: vectors[i], payload: { doc_id: id, chunk_id: c.id, category: current.category, page: c.page } })));
  await addTiming(id, 4, Date.now() - t, 'coleção empresa');

  await q(`UPDATE documents SET state = 'ready', stage = 5, chunks = $2, updated_at = now() WHERE id = $1`, [id, chunks.length]);
  const ready = await publish(id);
  if (ready) await writeDocNote(ready).catch((e) => console.error('empresa: nota do vault', e.message));
}

// Apaga o que foi derivado do arquivo (páginas, trechos, vetores) — reprocessar e excluir.
export async function clearDerived(id: string) {
  await deleteVectors(id).catch((e) => console.error('empresa: apagar vetores', e.message));
  await q(`DELETE FROM chunks WHERE doc_id = $1`, [id]);
  await q(`DELETE FROM document_pages WHERE doc_id = $1`, [id]);
}

// Exclusão completa: Qdrant → Postgres (cascata) → arquivo → nota do vault.
export async function deleteDoc(id: string) {
  const doc = await getDoc(id);
  if (!doc) return false;
  await deleteVectors(id);
  const note = (await q<{ vault_note: string | null }>(`SELECT vault_note FROM documents WHERE id = $1`, [id])).rows[0]?.vault_note;
  await q(`DELETE FROM documents WHERE id = $1`, [id]);
  try {
    rmSync(docDir(id), { recursive: true, force: true });
  } catch (e) {
    console.error('empresa: apagar arquivo', (e as Error).message);
  }
  if (note) removeDocNote(note);
  emit({ type: 'company.doc.deleted', id });
  return true;
}

export async function enqueue(id: string) {
  await q(`DELETE FROM jobs WHERE doc_id = $1 AND state <> 'running'`, [id]);
  await q(`INSERT INTO jobs(doc_id) VALUES($1)`, [id]);
  await q(`UPDATE documents SET state = 'queued', stage = 0, error = NULL, updated_at = now() WHERE id = $1`, [id]);
  await publish(id);
  kick();
}

// ---------- worker ----------

let busy = false;
let timer: NodeJS.Timeout | null = null;

export function kick() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void loop(), 50);
}

async function loop() {
  timer = null;
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const job = (
        await q<{ id: string; doc_id: string; attempts: number }>(
          `UPDATE jobs SET state = 'running', attempts = attempts + 1, updated_at = now()
           WHERE id = (SELECT id FROM jobs WHERE state = 'queued' AND run_after <= now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
           RETURNING id, doc_id, attempts`,
        )
      ).rows[0];
      if (!job) break;
      try {
        await processDoc(job.doc_id);
        await q(`DELETE FROM jobs WHERE id = $1`, [job.id]);
      } catch (e) {
        const msg = (e as Error).message;
        const retry = !(e instanceof Permanent) && job.attempts < MAX_ATTEMPTS;
        console.error(`empresa: documento ${job.doc_id} falhou (tentativa ${job.attempts})`, msg);
        if (retry) {
          await q(`UPDATE jobs SET state = 'queued', error = $2, run_after = now() + ($3 || ' seconds')::interval WHERE id = $1`, [job.id, msg, String(30 * job.attempts ** 2)]);
          await q(`UPDATE documents SET state = 'queued', error = $2, updated_at = now() WHERE id = $1`, [job.doc_id, `nova tentativa em breve: ${msg.slice(0, 160)}`]);
        } else {
          await q(`DELETE FROM jobs WHERE id = $1`, [job.id]);
          await q(`UPDATE documents SET state = 'error', error = $2, updated_at = now() WHERE id = $1`, [job.doc_id, msg.slice(0, 400)]);
        }
        await publish(job.doc_id);
      }
    }
  } catch (e) {
    console.error('empresa: fila', (e as Error).message);
  } finally {
    busy = false;
  }
  // tentativas agendadas para depois
  timer = setTimeout(() => void loop(), 15_000);
  timer.unref();
}

export async function startWorker() {
  await q(`UPDATE jobs SET state = 'queued' WHERE state = 'running'`);
  kick();
}
