import multipart from '@fastify/multipart';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { COMPANY_CATEGORIES, type CompanyCategory, type CompanyChunk, type CompanyDoc, type CompanyDocPage, type CompanyStats, type CompanyUse } from '../../../shared/protocol.ts';
import { config } from '../config.ts';
import { emit } from '../bus.ts';
import { registerAgentOptions, registerBrain, registerRunPrompt } from '../extensions.ts';
import { checkFile, cleanName, MAX_FILE } from './files.ts';
import { clearDerived, deleteDoc, docDir, enqueue, originalPath, startWorker } from './pipeline.ts';
import { loadProfile, logoExt, profile, sanitizeProfile, saveProfile, setLogo } from './profile.ts';
import { search } from './search.ts';
import { countVectors, DOC_COLS, ensureCollection, getDoc, healthy, migrate, q, setVectorCategory, toDoc, type DocRow } from './store.ts';
import { docNotePath, writeDocNote, writeProfileNote } from './vaultSync.ts';

// Empresa: perfil (contexto fixo dos agentes e da Yui) + base de documentos com OCR e RAG.

const companyDir = () => join(config.dataDir, 'company');
const tmpDir = () => join(companyDir(), 'tmp');
let ready = false;

const isCat = (c: unknown): c is CompanyCategory => typeof c === 'string' && (COMPANY_CATEGORIES as readonly string[]).includes(c);

async function init() {
  if (!config.pgUrl) {
    console.error('empresa: ATRIA_PG_URL não configurado — base de documentos desligada');
    return;
  }
  for (let i = 0; i < 30; i++) {
    try {
      await migrate();
      break;
    } catch (e) {
      if (i === 29) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await ensureCollection().catch((e) => console.error('empresa: qdrant', e.message));
  mkdirSync(tmpDir(), { recursive: true });
  await loadProfile();
  ready = true;
  await startWorker();
}

const notReady = (reply: FastifyReply) => reply.code(503).send({ error: 'A base da empresa ainda está iniciando (Postgres/Qdrant).' });

// ---------- upload ----------

async function receiveFiles(req: FastifyRequest) {
  const created: CompanyDoc[] = [];
  const duplicates: string[] = [];
  const rejected: { name: string; reason: string }[] = [];
  let category: CompanyCategory | null = null;
  for await (const part of req.parts()) {
    if (part.type === 'field') {
      if (part.fieldname === 'category' && isCat(part.value)) category = part.value;
      continue;
    }
    const name = cleanName(part.filename || 'arquivo');
    const tmp = join(tmpDir(), randomUUID());
    const hash = createHash('sha256');
    let head = Buffer.alloc(0);
    let size = 0;
    part.file.on('data', (c: Buffer) => {
      hash.update(c);
      size += c.length;
      if (head.length < 4096) head = Buffer.concat([head, c.subarray(0, 4096 - head.length)]);
    });
    await streamPipeline(part.file, createWriteStream(tmp));
    if (part.file.truncated) {
      rmSync(tmp, { force: true });
      rejected.push({ name, reason: `maior que ${MAX_FILE / 1024 / 1024} MB` });
      continue;
    }
    const chk = checkFile(name, head);
    if (!chk.ok) {
      rmSync(tmp, { force: true });
      rejected.push({ name, reason: chk.reason });
      continue;
    }
    const sha = hash.digest('hex');
    const dup = (await q<{ name: string }>(`SELECT name FROM documents WHERE sha256 = $1`, [sha])).rows[0];
    if (dup) {
      rmSync(tmp, { force: true });
      duplicates.push(`${name} (igual a ${dup.name})`);
      continue;
    }
    const id = randomUUID();
    mkdirSync(docDir(id), { recursive: true });
    renameSync(tmp, join(docDir(id), `original.${chk.ext}`));
    await q(
      `INSERT INTO documents(id, name, ext, mime, size, sha256, category, category_locked) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, name, chk.ext, chk.mime, size, sha, category ?? 'Outros', !!category],
    );
    await enqueue(id);
    const d = await getDoc(id);
    if (d) created.push(d);
  }
  return { created, duplicates, rejected };
}

// ---------- estatísticas ----------

async function stats(): Promise<CompanyStats> {
  const s = (
    await q<{ docs: string; ready: string; processing: string; errors: string; pages: string; ocr: string; chunks: string }>(
      `SELECT COUNT(*) AS docs,
              COUNT(*) FILTER (WHERE state = 'ready') AS ready,
              COUNT(*) FILTER (WHERE state IN ('queued','processing')) AS processing,
              COUNT(*) FILTER (WHERE state = 'error') AS errors,
              COALESCE(SUM(pages) FILTER (WHERE state = 'ready'), 0) AS pages,
              COALESCE(SUM(ocr_pages) FILTER (WHERE state = 'ready'), 0) AS ocr,
              COALESCE(SUM(chunks) FILTER (WHERE state = 'ready'), 0) AS chunks
         FROM documents`,
    )
  ).rows[0];
  const u = (await q<{ n: string; un: string }>(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE NOT answered) AS un FROM queries WHERE at > now() - interval '7 days'`)).rows[0];
  const recent = (await q<{ query: string }>(`SELECT DISTINCT ON (lower(query)) query, at FROM queries WHERE NOT answered AND at > now() - interval '30 days' ORDER BY lower(query), at DESC LIMIT 8`)).rows;
  const h = await healthy();
  return {
    docs: Number(s.docs), ready: Number(s.ready), processing: Number(s.processing), errors: Number(s.errors),
    pages: Number(s.pages), ocrPages: Number(s.ocr), chunks: Number(s.chunks),
    vectors: h.qdrant ? await countVectors().catch(() => 0) : 0,
    queries7d: Number(u.n), unanswered7d: Number(u.un), unansweredRecent: recent.map((r) => r.query),
    services: { ...h, openai: !!config.openaiKey },
  };
}

// ---------- HTTP ----------

export function register(app: FastifyInstance) {
  app.register(multipart, { limits: { fileSize: MAX_FILE, files: 30, fields: 10, parts: 40 } });
  init().catch((e) => console.error('empresa: inicialização', e.message));

  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/company/') && !ready) return notReady(reply);
  });

  app.get('/api/company/profile', () => profile());
  app.put('/api/company/profile', async (req) => {
    const p = await saveProfile(sanitizeProfile(req.body));
    writeProfileNote(p);
    emit({ type: 'company.profile.updated', profile: p });
    return p;
  });
  app.post('/api/company/logo', async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 2 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: 'envie a imagem no campo "file"' });
    const buf = await file.toBuffer().catch(() => null);
    if (!buf || file.file.truncated) return reply.code(413).send({ error: 'logo maior que 2 MB' });
    const chk = checkFile(cleanName(file.filename), buf.subarray(0, 4096));
    if (!chk.ok || !['png', 'jpg', 'jpeg', 'webp'].includes(chk.ext)) return reply.code(400).send({ error: 'use PNG, JPG ou WEBP' });
    mkdirSync(companyDir(), { recursive: true });
    for (const e of ['png', 'jpg', 'jpeg', 'webp']) rmSync(join(companyDir(), `logo.${e}`), { force: true });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(companyDir(), `logo.${chk.ext}`), buf);
    const p = await setLogo(chk.ext);
    emit({ type: 'company.profile.updated', profile: p });
    return reply.code(204).send();
  });
  app.get('/api/company/logo', async (_req, reply) => {
    const ext = await logoExt();
    const f = ext ? join(companyDir(), `logo.${ext}`) : null;
    if (!f || !existsSync(f)) return reply.code(404).send({ error: 'sem logo' });
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.type(ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg').send(readFileSync(f));
  });
  app.delete('/api/company/logo', async (_req, reply) => {
    for (const e of ['png', 'jpg', 'jpeg', 'webp']) rmSync(join(companyDir(), `logo.${e}`), { force: true });
    const p = await setLogo(null);
    emit({ type: 'company.profile.updated', profile: p });
    return reply.code(204).send();
  });

  app.get('/api/company/documents', async (req) => {
    const { q: text, category } = req.query as { q?: string; category?: string };
    const params: unknown[] = [];
    const where: string[] = [];
    if (isCat(category)) {
      params.push(category);
      where.push(`category = $${params.length}`);
    }
    if (text?.trim()) {
      params.push(`%${text.trim().toLowerCase()}%`);
      where.push(`(lower(name) LIKE $${params.length} OR lower(coalesce(summary,'')) LIKE $${params.length} OR lower(coalesce(doc_type,'')) LIKE $${params.length})`);
    }
    const r = await q<DocRow>(`SELECT ${DOC_COLS} FROM documents ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 500`, params);
    return r.rows.map(toDoc);
  });
  app.post('/api/company/documents', async (req, reply) => {
    if (!req.isMultipart()) return reply.code(400).send({ error: 'envie como multipart/form-data' });
    return receiveFiles(req);
  });

  const withDoc = (fn: (d: CompanyDoc, req: FastifyRequest, reply: FastifyReply) => unknown) => async (req: FastifyRequest, reply: FastifyReply) => {
    const d = await getDoc((req.params as { id: string }).id);
    if (!d) return reply.code(404).send({ error: 'documento não encontrado' });
    return fn(d, req, reply);
  };

  app.get('/api/company/documents/:id', withDoc((d) => d));
  app.patch('/api/company/documents/:id', withDoc(async (d, req) => {
    const b = (req.body ?? {}) as { category?: unknown; fields?: unknown; summary?: unknown; tags?: unknown };
    if (isCat(b.category) && b.category !== d.category) {
      await q(`UPDATE documents SET category = $2, category_locked = true, updated_at = now() WHERE id = $1`, [d.id, b.category]);
      await setVectorCategory(d.id, b.category).catch((e) => console.error('empresa: categoria no qdrant', e.message));
    }
    if (Array.isArray(b.fields)) {
      const fields = b.fields.slice(0, 30).map((f) => ({ key: String((f as { key?: unknown }).key ?? '').slice(0, 80), value: String((f as { value?: unknown }).value ?? '').slice(0, 400) })).filter((f) => f.key);
      await q(`UPDATE documents SET fields = $2, updated_at = now() WHERE id = $1`, [d.id, JSON.stringify(fields)]);
    }
    if (typeof b.summary === 'string') await q(`UPDATE documents SET summary = $2, updated_at = now() WHERE id = $1`, [d.id, b.summary.slice(0, 1200)]);
    if (Array.isArray(b.tags)) await q(`UPDATE documents SET tags = $2, updated_at = now() WHERE id = $1`, [d.id, b.tags.slice(0, 12).map((t) => String(t).toLowerCase().slice(0, 40))]);
    const nd = (await getDoc(d.id))!;
    if (nd.state === 'ready') await writeDocNote(nd).catch(() => {});
    emit({ type: 'company.doc.updated', doc: nd });
    return nd;
  }));
  app.delete('/api/company/documents/:id', withDoc(async (d, _req, reply) => {
    await deleteDoc(d.id);
    return reply.code(204).send();
  }));
  app.post('/api/company/documents/bulk-delete', async (req) => {
    const ids = ((req.body as { ids?: unknown })?.ids ?? []) as unknown[];
    let deleted = 0;
    for (const id of ids.slice(0, 200)) if (typeof id === 'string' && (await getDoc(id)) && (await deleteDoc(id))) deleted++;
    return { deleted };
  });
  app.post('/api/company/documents/:id/reprocess', withDoc(async (d) => {
    await clearDerived(d.id);
    await q(`UPDATE documents SET chunks = 0, pages = 0, ocr_pages = 0 WHERE id = $1`, [d.id]);
    await enqueue(d.id);
    return getDoc(d.id);
  }));
  app.post('/api/company/documents/bulk-reprocess', async (req) => {
    const ids = ((req.body as { ids?: unknown })?.ids ?? []) as unknown[];
    let n = 0;
    for (const id of ids.slice(0, 200)) {
      if (typeof id !== 'string' || !(await getDoc(id))) continue;
      await clearDerived(id);
      await enqueue(id);
      n++;
    }
    return { queued: n };
  });
  app.get('/api/company/documents/:id/file', withDoc((d, _req, reply) => {
    const f = originalPath(d.id);
    if (!f) return reply.code(404).send({ error: 'arquivo não encontrado' });
    reply.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.name)}`);
    reply.header('Content-Length', statSync(f).size);
    reply.header('Cache-Control', 'private, no-store');
    return reply.type(d.mime).send(createReadStream(f));
  }));
  app.get('/api/company/documents/:id/text', withDoc(async (d) => ({
    markdown: (await q<{ markdown: string | null }>(`SELECT markdown FROM documents WHERE id = $1`, [d.id])).rows[0]?.markdown ?? '',
  })));
  app.get('/api/company/documents/:id/pages', withDoc(async (d): Promise<CompanyDocPage[]> => {
    const r = await q<{ page: number; ocr: boolean; width: number; height: number; text: string; boxes: CompanyDocPage['boxes'] }>(
      `SELECT page, ocr, width, height, text, boxes FROM document_pages WHERE doc_id = $1 ORDER BY page`, [d.id]);
    return r.rows;
  }));
  app.get('/api/company/documents/:id/chunks', withDoc(async (d): Promise<CompanyChunk[]> => {
    const r = await q<CompanyChunk>(`SELECT id, ord, page, tokens, kind, text FROM chunks WHERE doc_id = $1 ORDER BY ord`, [d.id]);
    return r.rows;
  }));
  app.get('/api/company/documents/:id/uses', withDoc(async (d): Promise<CompanyUse[]> => {
    const r = await q<{ at: Date; who: string; query: string; top_score: number | null }>(
      `SELECT at, who, query, top_score FROM queries WHERE $1 = ANY(doc_ids) ORDER BY at DESC LIMIT 50`, [d.id]);
    return r.rows.map((x) => ({ at: x.at.toISOString(), who: x.who, query: x.query, score: x.top_score }));
  }));
  app.post('/api/company/search', async (req, reply) => {
    const b = (req.body ?? {}) as { query?: unknown; category?: unknown; answer?: unknown };
    if (typeof b.query !== 'string' || !b.query.trim()) return reply.code(400).send({ error: 'query' });
    if (!config.openaiKey) return reply.code(400).send({ error: 'Configure a chave da OpenAI (embeddings) em Configurações.' });
    return search(b.query, { category: isCat(b.category) ? b.category : null, answer: b.answer === true, who: 'Painel' });
  });
  app.get('/api/company/stats', () => stats());
}

// ---------- agentes, Yui e prompt ----------

const fmtHits = (r: Awaited<ReturnType<typeof search>>) =>
  r.noAnswer
    ? 'Nada relevante na base de documentos da empresa para essa pergunta. Diga isso ao usuário e sugira enviar o documento em Empresa › Documentos.'
    : r.hits.map((h) => `[${h.n}] ${h.docName}${h.page ? `, pág. ${h.page}` : ''} (doc ${h.docId}, relevância ${h.score})\n${h.text}`).join('\n\n---\n\n');

registerRunPrompt(() => {
  if (!ready) return null;
  const p = profile();
  const lines = p.agentPreview ? [`- Contexto da empresa do usuário:\n${p.agentPreview.split('\n').map((l) => `  ${l}`).join('\n')}`] : [];
  lines.push('- Base de documentos da empresa (contratos, preços, marca, processos, propostas, financeiro): use a ferramenta mcp__empresa__empresa_consultar antes de afirmar preços, prazos, cláusulas, políticas ou dados de clientes, e cite o documento e a página. mcp__empresa__empresa_documento traz os dados completos de um documento.');
  return lines.join('\n');
});

registerAgentOptions((agentId) => {
  if (!ready) return {};
  const server = createSdkMcpServer({
    name: 'empresa',
    version: '1.0.0',
    tools: [
      tool(
        'empresa_consultar',
        'Busca na base de documentos da empresa do usuário (PDFs, contratos, tabelas de preço, manual da marca, processos, propostas, notas). Devolve trechos numerados com documento e página.',
        { pergunta: z.string().describe('pergunta em linguagem natural'), categoria: z.enum(COMPANY_CATEGORIES).optional() },
        async ({ pergunta, categoria }) => {
          const r = await search(pergunta, { category: categoria ?? null, who: agentId, limit: 6 });
          return { content: [{ type: 'text', text: fmtHits(r) }] };
        },
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        'empresa_documento',
        'Dados completos de um documento da base da empresa (resumo, campos extraídos, entidades e texto), pelo id que aparece em empresa_consultar.',
        { id: z.string() },
        async ({ id }) => {
          const d = await getDoc(id);
          if (!d) return { content: [{ type: 'text', text: 'documento não encontrado' }], isError: true };
          const md = (await q<{ markdown: string | null }>(`SELECT markdown FROM documents WHERE id = $1`, [id])).rows[0]?.markdown ?? '';
          return { content: [{ type: 'text', text: JSON.stringify({ nome: d.name, categoria: d.category, tipo: d.docType, resumo: d.summary, campos: d.fields, entidades: d.entities, paginas: d.pages, texto: md.slice(0, 30000) }) }] };
        },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });
  return { mcpServers: { empresa: server } };
});

registerBrain({
  name: 'company',
  instructions: `- Perguntas sobre a empresa do usuário (preços, serviços, contratos, cláusulas, políticas, marca, clientes, propostas, notas) => empresa_consultar antes de responder; responda curto e diga de qual documento veio.
- "abre a empresa/os documentos/a base" => open_company (tab perfil|documentos|busca).`,
  tools: [
    {
      type: 'function', name: 'empresa_consultar', strict: true,
      description: 'Busca na base de documentos da empresa e devolve a resposta montada com os trechos e as fontes.',
      parameters: { type: 'object', additionalProperties: false, required: ['pergunta'], properties: { pergunta: { type: 'string' } } },
    },
    {
      type: 'function', name: 'open_company', strict: true,
      description: 'Abre a página Empresa no dashboard.',
      parameters: { type: 'object', additionalProperties: false, required: ['tab'], properties: { tab: { type: 'string', enum: ['perfil', 'documentos', 'busca'] } } },
    },
  ],
  run(name, args, ctx) {
    if (name === 'empresa_consultar') {
      if (!ready) return Promise.resolve({ ok: false, error: 'base da empresa indisponível' });
      if (ctx.dryRun) return Promise.resolve({ ok: true, dryRun: true });
      return search(String(args.pergunta), { answer: true, who: 'Yui' }).then((r) => ({
        resposta: r.answer,
        semResposta: r.noAnswer,
        fontes: r.hits.slice(0, 4).map((h) => `${h.docName}${h.page ? ` p.${h.page}` : ''}`),
      }));
    }
    if (name === 'open_company') {
      if (!ctx.dryRun) emit({ type: 'ui.action', action: { type: 'show_view', view: 'company', params: { tab: String(args.tab) } } });
      return Promise.resolve({ ok: true });
    }
    return undefined;
  },
  snapshot: () => {
    const p = profile();
    return p.name ? `Empresa do usuário: ${p.name}${p.segment ? ` (${p.segment})` : ''}.` : '';
  },
});

export { docNotePath };
