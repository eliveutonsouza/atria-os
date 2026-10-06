import { trackOpenAI } from '../usage.ts';
import type { CompanyCategory, CompanySearchHit, CompanySearchResult } from '../../../shared/protocol.ts';
import { config } from '../config.ts';
import { openai } from '../brain.ts';
import { rrf, tsQueryTerms } from './chunk.ts';
import { embed } from './pipeline.ts';
import { q, searchVectors } from './store.ts';

// RAG: busca híbrida (vetores no Qdrant + texto no Postgres, fundidos por RRF) e resposta citada.

const CAND = 20;
const NOT_FOUND = 'Não encontrei isso nos documentos da empresa.';

export async function search(
  query: string,
  opts: { category?: CompanyCategory | null; limit?: number; answer?: boolean; who?: string } = {},
): Promise<CompanySearchResult> {
  const t0 = Date.now();
  const text = query.trim().slice(0, 1000);
  const limit = Math.max(1, Math.min(12, opts.limit ?? 6));
  const cat = opts.category || null;
  const terms = tsQueryTerms(text);

  const [vec, kw] = await Promise.all([
    embed([text]).then(([v]) => searchVectors(v, CAND, cat ?? undefined)),
    terms
      ? q<{ id: string; r: number }>(
          `SELECT c.id, ts_rank_cd(c.tsv, to_tsquery('portuguese', $1)) AS r
             FROM chunks c JOIN documents d ON d.id = c.doc_id
            WHERE d.state = 'ready' AND c.tsv @@ to_tsquery('portuguese', $1) ${cat ? 'AND d.category = $3' : ''}
            ORDER BY r DESC LIMIT $2`,
          cat ? [terms, CAND, cat] : [terms, CAND],
        ).then((r) => r.rows)
      : Promise.resolve([] as { id: string; r: number }[]),
  ]);

  const vecScore = new Map(vec.map((v) => [v.id, v.score]));
  const maxKw = Math.max(0, ...kw.map((k) => k.r));
  const kwScore = new Map(kw.map((k) => [k.id, maxKw ? k.r / maxKw : 0]));
  const fused = rrf([vec.map((v) => v.id), kw.map((k) => k.id)]);
  const best = 2 / 61;
  const top = [...fused].sort((a, b) => b[1] - a[1]).slice(0, limit * 2);

  const rows = top.length
    ? (
        await q<{ id: string; doc_id: string; page: number | null; text: string; name: string; category: string }>(
          `SELECT c.id, c.doc_id, c.page, c.text, d.name, d.category FROM chunks c JOIN documents d ON d.id = c.doc_id WHERE c.id = ANY($1::uuid[]) AND d.state = 'ready'`,
          [top.map(([id]) => id)],
        )
      ).rows
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hits: CompanySearchHit[] = [];
  for (const [id, s] of top) {
    const r = byId.get(id);
    if (!r) continue;
    hits.push({
      n: hits.length + 1,
      chunkId: id,
      docId: r.doc_id,
      docName: r.name,
      category: r.category as CompanyCategory,
      page: r.page,
      text: r.text,
      vector: vecScore.has(id) ? Math.round(vecScore.get(id)! * 100) / 100 : null,
      keyword: kwScore.has(id) ? Math.round(kwScore.get(id)! * 100) / 100 : null,
      score: Math.round(Math.min(1, s / best) * 100) / 100,
    });
    if (hits.length >= limit) break;
  }

  // text-embedding-3-small dá ~0,45+ para trecho que responde; sem palavra em comum e vetor fraco = não sabe
  const topVec = Math.max(0, ...hits.map((h) => h.vector ?? 0));
  let noAnswer = !hits.length || (topVec < 0.42 && !hits.some((h) => h.keyword));

  let answer: string | null = null;
  if (opts.answer && hits.length && !noAnswer && config.openaiKey) {
    try {
      const res = await openai.responses.create({
        model: config.brainModel,
        instructions:
          'Responda em português, em 1 a 4 frases, usando SÓ os trechos numerados. Cite a fonte com [n] logo após cada informação. ' +
          `Se os trechos não respondem, responda exatamente: "${NOT_FOUND}" e diga em uma frase o que faltou. Não invente valores.`,
        input: `Pergunta: ${text}\n\nTrechos:\n${hits.map((h) => `[${h.n}] (${h.docName}${h.page ? `, pág. ${h.page}` : ''})\n${h.text.slice(0, 2400)}`).join('\n\n')}`,
      });
      trackOpenAI('empresa', res.model, res.usage);
      answer = res.output_text.trim() || null;
      if (answer?.startsWith(NOT_FOUND)) noAnswer = true;
    } catch (e) {
      console.error('empresa: resposta', (e as Error).message);
    }
  }

  await q(`INSERT INTO queries(who, query, doc_ids, top_score, answered) VALUES($1, $2, $3::uuid[], $4, $5)`, [
    opts.who ?? 'Painel',
    text,
    [...new Set(hits.map((h) => h.docId))],
    hits[0]?.score ?? null,
    !noAnswer,
  ]).catch((e) => console.error('empresa: log da consulta', e.message));

  return { query: text, answer, hits, ms: Date.now() - t0, noAnswer };
}
