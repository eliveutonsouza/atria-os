import { trackOpenAI } from './usage.ts';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppPage, HelpAnswer, HelpDoc, HelpIndex, HelpResults, HelpTaskType } from '../../shared/protocol.ts';
import { config, readEnv } from './config.ts';
import { db, kvGet, kvSet, now } from './db.ts';
import { emit } from './bus.ts';
import { openai } from './brain.ts';
import { registerBrain, registerRunPrompt } from './extensions.ts';
import { readNote, upsertNote } from './vault.ts';
import { Bm25, faqPassages, guideMeta, list, parseDia, parseDoc, parseFaq, passagesOf, recipeMeta, runType, str, type ParsedDoc } from './helpDocs.ts';

// Ajuda: guias operacionais (docs/ajuda), "Pergunte" (busca + resposta citada) e Resultados
// (números reais do banco + estimativa de horas economizadas com minutos ajustáveis).

const helpDir = () => readEnv('ATRIA_HELP_DIR') || new URL('../../docs/ajuda', import.meta.url).pathname;

db.exec(`
CREATE TABLE IF NOT EXISTS help_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, doc TEXT NOT NULL, util INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS help_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, pergunta TEXT NOT NULL, answered INTEGER NOT NULL, top TEXT, at TEXT NOT NULL);
`);

let guides: ParsedDoc[] = [];
let recipes: ParsedDoc[] = [];
let index: HelpIndex = { guias: [], receitas: [], faq: [], dia: [], version: '' };
let bm = new Bm25([]);

function readDir(sub: string, kind: 'guia' | 'receita'): ParsedDoc[] {
  const dir = join(helpDir(), sub);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseDoc(kind, f.replace(/\.md$/, ''), readFileSync(join(dir, f), 'utf8')));
}

export function loadHelp() {
  guides = readDir('guias', 'guia');
  recipes = readDir('receitas', 'receita');
  const read = (f: string) => (existsSync(join(helpDir(), f)) ? readFileSync(join(helpDir(), f), 'utf8') : '');
  const GROUPS = ['Começar', 'Acompanhar', 'Organizar', 'Conhecimento', 'Ferramentas', 'Sistema'];
  const gi = (g: string) => (GROUPS.indexOf(g) < 0 ? 99 : GROUPS.indexOf(g));
  index = {
    guias: guides.map(guideMeta).sort((a, b) => gi(a.grupo) - gi(b.grupo) || a.ordem - b.ordem || a.titulo.localeCompare(b.titulo, 'pt-BR')),
    receitas: recipes.map(recipeMeta).sort((a, b) => a.categoria.localeCompare(b.categoria, 'pt-BR') || a.titulo.localeCompare(b.titulo, 'pt-BR')),
    faq: parseFaq(read('faq.md')),
    dia: parseDia(read('dia.md')),
    version: new Date().toISOString(),
  };
  bm = new Bm25([...guides.flatMap(passagesOf), ...recipes.flatMap(passagesOf), ...faqPassages(index.faq)]);
}

export const helpIndex = () => index;

// Espelho no vault (Ajuda/…), para agentes e Yui acharem a documentação com rg/vault_search.
function mirrorToVault() {
  const note = (d: ParsedDoc) => {
    const m = d.meta;
    const parts = [
      '---',
      `tipo: ajuda`,
      `tags: [ajuda${d.kind === 'receita' ? ', receita' : ''}]`,
      '---',
      `# ${d.titulo}`,
      '',
      '> Gerado a partir de docs/ajuda — edições aqui são sobrescritas. Veja na tela Ajuda.',
      '',
      str(m.resumo) || str(m.resultado),
      m.usar_quando ? `\n**Use quando:** ${str(m.usar_quando)}` : '',
      m.nao_usar_quando ? `**Não use quando:** ${str(m.nao_usar_quando)}` : '',
      list(m.frases).length ? `\n## Diga para a Yui\n${list(m.frases).map((f) => `- ${f}`).join('\n')}` : '',
      '',
      d.markdown,
      list(m.dicas).length ? `\n## Dicas\n${list(m.dicas).map((f) => `- ${f}`).join('\n')}` : '',
      list(m.erros).length ? `\n## Erros comuns\n${list(m.erros).map((f) => `- ${f}`).join('\n')}` : '',
      list(m.relacionados).length ? `\nRelacionados: ${list(m.relacionados).map((r) => `[[${guides.find((g) => g.id === r)?.titulo ?? r}]]`).join(', ')}` : '',
      '',
    ];
    return parts.filter((p) => p !== '').join('\n');
  };
  // só grava o que mudou (evita reindexar e commitar o vault a cada boot)
  const put = (path: string, text: string) => {
    try {
      if (readNote(path).text === text) return;
    } catch {
      /* nota nova */
    }
    upsertNote(path, text);
  };
  const safe = (t: string) => t.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').trim();
  for (const g of guides) put(`Ajuda/Guias/${safe(g.titulo)}.md`, note(g));
  for (const r of recipes) put(`Ajuda/Receitas/${safe(r.titulo)}.md`, note(r));
  if (index.faq.length) {
    const cats = [...new Set(index.faq.map((f) => f.categoria))];
    put(
      'Ajuda/Perguntas frequentes.md',
      `---\ntipo: ajuda\ntags: [ajuda]\n---\n# Perguntas frequentes\n\n${cats.map((c) => `## ${c}\n${index.faq.filter((f) => f.categoria === c).map((f) => `### ${f.pergunta}\n${f.resposta}`).join('\n\n')}`).join('\n\n')}\n`,
    );
  }
}

// ---------- Pergunte ----------

export async function ask(pergunta: string, who = 'Painel'): Promise<HelpAnswer> {
  const q = pergunta.trim().slice(0, 600);
  const hits = bm.search(q, 5);
  const best = hits[0]?.score ?? 0;
  const seen = new Set<string>();
  const fontes = hits
    .filter((h) => {
      const k = `${h.p.source.kind}:${h.p.source.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 3)
    .map((h) => h.p.source);
  const semFonte = best < 1.2;
  let resposta: string | null = null;
  let semResposta = semFonte;
  if (!semFonte && config.openaiKey) {
    try {
      const res = await openai.responses.create({
        model: config.brainModel,
        instructions:
          'Você é a ajuda do Atria OS. Responda em português, em 2 a 4 frases curtas e práticas, usando SÓ os trechos dados. ' +
          'Diga onde clicar ou o que pedir à Yui. Cite a fonte no fim de cada informação como [Guia: Título], [Receita: Título] ou [FAQ]. ' +
          'Se os trechos não respondem, comece exatamente com "Não encontrei isso nos guias." e sugira o guia mais próximo.',
        input: `Pergunta: ${q}\n\nTrechos:\n${hits.map((h) => `(${h.p.source.kind === 'guia' ? 'Guia' : h.p.source.kind === 'receita' ? 'Receita' : 'FAQ'}: ${h.p.source.titulo} — ${h.p.section})\n${h.p.text.slice(0, 1800)}`).join('\n\n')}`,
      });
      trackOpenAI('ajuda', res.model, res.usage);
      resposta = res.output_text.trim() || null;
      if (resposta?.startsWith('Não encontrei isso nos guias')) semResposta = true;
    } catch (e) {
      console.error('ajuda: resposta', (e as Error).message);
    }
  }
  if (!resposta && !semFonte) {
    // sem OpenAI: devolve o trecho mais relevante
    resposta = `${hits[0].p.text.split('\n').slice(1).join(' ').slice(0, 400)} [${hits[0].p.source.kind === 'guia' ? 'Guia' : hits[0].p.source.kind === 'receita' ? 'Receita' : 'FAQ'}: ${hits[0].p.source.titulo}]`;
  }
  db.prepare('INSERT INTO help_questions(pergunta, answered, top, at) VALUES(?, ?, ?, ?)').run(q, semResposta ? 0 : 1, fontes[0]?.id ?? null, now());
  const abrir = (fontes.find((f) => f.pagina)?.pagina ?? null) as AppPage | null;
  void who;
  return { pergunta: q, resposta, semResposta, fontes, abrir };
}

// ---------- Resultados ----------

const LABEL: Record<HelpTaskType, string> = {
  codigo: 'Código (backend, frontend, QA, DevOps, segurança)',
  pesquisa: 'Pesquisa e leads',
  textos: 'Textos, design e relatórios',
  assistente: 'Tarefas do assistente (agenda, e-mail, outros)',
  workflow: 'Passos de workflow',
  rotina: 'Rotinas agendadas',
  consulta: 'Respostas da base da empresa',
  documento: 'Documentos lidos (OCR + extração)',
};
const DEFAULT_MIN: Record<HelpTaskType, number> = { codigo: 45, pesquisa: 30, textos: 30, assistente: 10, workflow: 20, rotina: 5, consulta: 5, documento: 10 };
const TYPES = Object.keys(LABEL) as HelpTaskType[];

export function minutes(): Record<HelpTaskType, number> {
  try {
    return { ...DEFAULT_MIN, ...(JSON.parse(kvGet('help_minutes') ?? '{}') as Partial<Record<HelpTaskType, number>>) };
  } catch {
    return { ...DEFAULT_MIN };
  }
}

const DAYS = { week: 7, month: 30, '90d': 90 } as const;

async function companyCounts(from: string, weeks: string[]): Promise<{ queries: string[]; docs: string[] }> {
  // Postgres da Empresa é opcional (pode não existir numa instalação sem a base)
  try {
    const { q } = await import('./company/store.ts');
    const qs = (await q<{ at: Date }>(`SELECT at FROM queries WHERE at >= $1 AND answered AND who <> 'Painel'`, [from])).rows.map((r) => r.at.toISOString());
    const ds = (await q<{ created_at: Date }>(`SELECT created_at FROM documents WHERE state = 'ready' AND created_at >= $1`, [from])).rows.map((r) => r.created_at.toISOString());
    void weeks;
    return { queries: qs, docs: ds };
  } catch {
    return { queries: [], docs: [] };
  }
}

export async function results(period: HelpResults['period'] = 'month'): Promise<HelpResults> {
  const to = new Date();
  const from = new Date(to.getTime() - DAYS[period] * 86400_000);
  const fromIso = from.toISOString();
  const runs = db
    .prepare(`SELECT agent_id, origin, state, finished_at, cost_usd FROM runs WHERE finished_at >= ? AND state IN ('done','failed')`)
    .all(fromIso) as { agent_id: string; origin: string; state: string; finished_at: string; cost_usd: number }[];
  const done = runs.filter((r) => r.state === 'done');
  const failed = runs.length - done.length;
  const wf = (db.prepare(`SELECT COUNT(*) AS n FROM workflow_runs WHERE status = 'done' AND finished_at >= ?`).get(fromIso) as { n: number }).n;
  const ap = db
    .prepare(`SELECT created_at, resolved_at FROM approvals WHERE status IN ('approved','rejected') AND resolved_at >= ?`)
    .all(fromIso) as { created_at: string; resolved_at: string }[];
  const apAvg = ap.length ? ap.reduce((s, a) => s + (new Date(a.resolved_at).getTime() - new Date(a.created_at).getTime()), 0) / ap.length / 60000 : null;
  const company = await companyCounts(fromIso, []);

  const events: { tipo: HelpTaskType; at: string }[] = [
    ...done.map((r) => ({ tipo: runType(r.agent_id, r.origin), at: r.finished_at })),
    ...company.queries.map((at) => ({ tipo: 'consulta' as const, at })),
    ...company.docs.map((at) => ({ tipo: 'documento' as const, at })),
  ];
  const mins = minutes();
  const rows = TYPES.map((tipo) => {
    const count = events.filter((e) => e.tipo === tipo).length;
    return { tipo, label: LABEL[tipo], count, minutes: mins[tipo], hours: Math.round(((count * mins[tipo]) / 60) * 10) / 10 };
  });
  const hours = Math.round(rows.reduce((s, r) => s + (r.count * r.minutes) / 60, 0) * 10) / 10;

  // semanas (segunda a domingo) que tocam o período
  const weeks: HelpResults['weeks'] = [];
  const start = new Date(from);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  for (let w = new Date(start); w < to; w = new Date(w.getTime() + 7 * 86400_000)) {
    const end = new Date(w.getTime() + 7 * 86400_000);
    const byTipo: Partial<Record<HelpTaskType, number>> = {};
    for (const e of events) {
      const t = new Date(e.at);
      if (t >= w && t < end) byTipo[e.tipo] = (byTipo[e.tipo] ?? 0) + mins[e.tipo] / 60;
    }
    for (const k of Object.keys(byTipo) as HelpTaskType[]) byTipo[k] = Math.round(byTipo[k]! * 10) / 10;
    weeks.push({ label: `${String(w.getUTCDate()).padStart(2, '0')}/${String(w.getUTCMonth() + 1).padStart(2, '0')}`, from: w.toISOString(), hours: Math.round(Object.values(byTipo).reduce((s, x) => s + (x ?? 0), 0) * 10) / 10, byTipo });
  }

  return {
    period,
    from: fromIso,
    to: to.toISOString(),
    hours,
    kpis: {
      runsDone: done.length,
      successRate: runs.length ? Math.round((done.length / (done.length + failed)) * 100) / 100 : null,
      workflowsDone: wf,
      approvals: ap.length,
      approvalAvgMin: apAvg === null ? null : Math.round(apAvg * 10) / 10,
      docsReady: company.docs.length,
      queries: company.queries.length,
      costUsd: Math.round(runs.reduce((s, r) => s + (r.cost_usd ?? 0), 0) * 100) / 100,
    },
    rows,
    weeks,
  };
}

// ---------- HTTP ----------

export function register(app: FastifyInstance) {
  loadHelp();
  try {
    mirrorToVault();
  } catch (e) {
    console.error('ajuda: espelho no vault', (e as Error).message);
  }

  app.get('/api/help', () => index);
  app.get('/api/help/doc/:kind/:id', (req, reply) => {
    const { kind, id } = req.params as { kind: string; id: string };
    const d = (kind === 'guia' ? guides : kind === 'receita' ? recipes : []).find((x) => x.id === id);
    if (!d) return reply.code(404).send({ error: 'não encontrado' });
    const out: HelpDoc = { kind: d.kind, id: d.id, titulo: d.titulo, meta: d.meta, markdown: d.markdown, pagina: d.pagina };
    return out;
  });
  app.post('/api/help/ask', async (req, reply) => {
    const p = (req.body as { pergunta?: unknown })?.pergunta;
    if (typeof p !== 'string' || !p.trim()) return reply.code(400).send({ error: 'pergunta' });
    return ask(p);
  });
  app.post('/api/help/feedback', (req, reply) => {
    const b = (req.body ?? {}) as { kind?: unknown; id?: unknown; util?: unknown };
    if (typeof b.id !== 'string' || typeof b.util !== 'boolean') return reply.code(400).send({ error: 'id e util' });
    db.prepare('INSERT INTO help_feedback(kind, doc, util, at) VALUES(?, ?, ?, ?)').run(String(b.kind ?? 'guia'), b.id.slice(0, 80), b.util ? 1 : 0, now());
    return reply.code(204).send();
  });
  app.get('/api/help/unanswered', () =>
    db.prepare(`SELECT pergunta, MAX(at) AS at FROM help_questions WHERE answered = 0 GROUP BY lower(pergunta) ORDER BY at DESC LIMIT 15`).all(),
  );
  app.get('/api/help/results', (req) => {
    const p = (req.query as { period?: string }).period;
    return results(p === 'week' || p === '90d' ? p : 'month');
  });
  app.put('/api/help/results/minutes', (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const cur = minutes();
    for (const t of TYPES) if (b[t] !== undefined && Number.isFinite(Number(b[t]))) cur[t] = Math.max(0, Math.min(600, Math.round(Number(b[t]))));
    kvSet('help_minutes', JSON.stringify(cur));
    return results('month');
  });
}

// ---------- Yui e agentes ----------

registerRunPrompt(() => '- Guia de uso do Atria OS (o que cada tela faz e como usar): /workspace/.atria/vault/Ajuda.');

registerBrain({
  name: 'help',
  instructions: `- Dúvida sobre COMO USAR o Atria OS ("como eu faço…", "o que é…", "para que serve…", "onde vejo…") => ajuda_consultar e responda curto citando o guia; ofereça abrir a tela.
- "abre a ajuda/os guias/os resultados/o tempo economizado" => open_help.`,
  tools: [
    {
      type: 'function', name: 'ajuda_consultar', strict: true,
      description: 'Consulta os guias de uso do Atria OS e devolve a resposta com a fonte e a tela relacionada.',
      parameters: { type: 'object', additionalProperties: false, required: ['pergunta'], properties: { pergunta: { type: 'string' } } },
    },
    {
      type: 'function', name: 'open_help', strict: true,
      description: 'Abre a página Ajuda numa aba (inicio, guias, receitas, resultados, faq) ou num guia específico.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['tab', 'guia'],
        properties: { tab: { type: 'string', enum: ['inicio', 'guias', 'receitas', 'resultados', 'faq'] }, guia: { type: ['string', 'null'], description: 'id do guia (ex.: workflows, empresa)' } },
      },
    },
  ],
  run(name, args, ctx) {
    if (name === 'ajuda_consultar') {
      if (ctx.dryRun) return Promise.resolve({ ok: true, dryRun: true });
      return ask(String(args.pergunta), 'Yui').then((a) => ({ resposta: a.resposta, semResposta: a.semResposta, fontes: a.fontes.map((f) => f.titulo), tela: a.abrir }));
    }
    if (name === 'open_help') {
      const g = typeof args.guia === 'string' && guides.some((x) => x.id === args.guia) ? `guia:${args.guia}` : String(args.tab);
      if (!ctx.dryRun) emit({ type: 'ui.action', action: { type: 'show_view', view: 'help', params: { tab: g } } });
      return Promise.resolve({ ok: true });
    }
    return undefined;
  },
});
