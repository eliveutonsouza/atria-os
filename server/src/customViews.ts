import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CustomViewInfo, CustomViewSpec, RunInfo, ViewName, ViewParams } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, now, uid } from './db.ts';
import { emit, setYuiState } from './bus.ts';
import { getRun, runBus } from './runs.ts';
import { findProject } from './projects.ts';
import { latestReport } from './metrics.ts';
import { registerBrain, registerRunPrompt } from './extensions.ts';
import { sbToken } from './sandbox.ts';

// Telas sob medida: qualquer coisa não mapeada vira uma tela de blocos nativos (KPIs, gráfico, tabela, lista…)
// ou uma página HTML isolada. Vem do cérebro (show_custom) ou de um agente (run com display=blocks|html).

db.exec(`
CREATE TABLE IF NOT EXISTS custom_views (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

const viewsDir = () => join(config.workspaceDir, '.yui', 'views');

// ---------- schema ----------

const tone = z.enum(['ok', 'warn', 'crit', 'cyan', 'lav', 'muted']).optional().catch(undefined);
const str = z.union([z.string(), z.number()]).transform(String);
const safeSrc = z.string().refine((s) => /^(https?:\/\/|\/sandbox|data:image\/)/.test(s), 'src precisa ser http(s), data:image ou /sandbox');

export const BlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('kpis'), items: z.array(z.object({ label: str, value: str, tone })).min(1).max(8) }),
  z.object({
    type: z.literal('chart'),
    chart: z.enum(['bar', 'line', 'area', 'pie']),
    title: z.string().optional(),
    labels: z.array(str).max(200),
    series: z.array(z.object({ name: str, values: z.array(z.coerce.number()) })).min(1).max(6),
  }),
  z.object({
    type: z.literal('table'),
    title: z.string().optional(),
    columns: z.array(str).min(1).max(12),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).max(500),
  }),
  z.object({
    type: z.literal('list'),
    title: z.string().optional(),
    items: z.array(z.object({ title: str, subtitle: z.string().optional(), meta: z.string().optional(), tone, href: z.string().url().optional().catch(undefined) })).max(200),
  }),
  z.object({ type: z.literal('markdown'), text: z.string().max(20000) }),
  z.object({ type: z.literal('timeline'), title: z.string().optional(), items: z.array(z.object({ t: str, label: str, tone })).max(200) }),
  z.object({ type: z.literal('image'), src: safeSrc, alt: z.string().optional() }),
  z.object({ type: z.literal('html'), url: z.string().startsWith('/sandbox'), height: z.number().optional() }),
  z.object({ type: z.literal('link'), label: z.string(), href: z.string().url() }),
]);

export const SpecSchema = z.object({
  title: z.string().min(1).max(120),
  eyebrow: z.string().max(60).optional(),
  blocks: z.array(BlockSchema).min(1).max(20),
});

// ---------- persistência ----------

type Row = { id: string; title: string; spec_json: string; source: string; created_at: string };
const toInfo = (r: Row): CustomViewInfo => ({ id: r.id, title: r.title, spec: JSON.parse(r.spec_json), source: r.source, createdAt: r.created_at });

export function getCustom(id: string): CustomViewInfo | null {
  const r = db.prepare('SELECT * FROM custom_views WHERE id = ?').get(id) as Row | undefined;
  return r ? toInfo(r) : null;
}

export function saveCustom(spec: CustomViewSpec, source: string, id: string = uid()): CustomViewInfo {
  db.prepare('INSERT OR REPLACE INTO custom_views(id, title, spec_json, source, created_at) VALUES(?, ?, ?, ?, ?)').run(id, spec.title, JSON.stringify(spec), source, now());
  const info = getCustom(id)!;
  emit({ type: 'custom.created', view: info });
  return info;
}

function showCustom(id: string) {
  emit({ type: 'ui.action', action: { type: 'show_view', view: 'custom', params: { customId: id } } });
  setYuiState('showing');
}

const viewUrl = (id: string) => `/sandbox-view/${sbToken(`view:${id}`)}/${id}/`;

// ---------- prompt dos agentes com display ----------

const BLOCKS_DOC = `Blocos aceitos (JSON):
{"type":"kpis","items":[{"label":"Leads","value":"27","tone":"cyan"}]}            tone: ok|warn|crit|cyan|lav|muted
{"type":"chart","chart":"bar|line|area|pie","title":"…","labels":["seg","ter"],"series":[{"name":"Vendas","values":[3,5]}]}
{"type":"table","title":"…","columns":["Empresa","Score"],"rows":[["Clínica A",92]]}
{"type":"list","title":"…","items":[{"title":"…","subtitle":"…","meta":"…","tone":"ok","href":"https://…"}]}
{"type":"markdown","text":"texto em markdown simples (títulos, listas, **negrito**, links)"}
{"type":"timeline","items":[{"t":"09:00","label":"…","tone":"ok"}]}
{"type":"image","src":"https://…"}   {"type":"link","label":"…","href":"https://…"}`;

registerRunPrompt((ctx) => {
  if (ctx.display === 'blocks') {
    return `- MOSTRAR RESULTADO: além da resposta final, grave em /workspace/.yui/views/${ctx.runId}.json uma tela para o usuário no formato
{"title":"…","eyebrow":"…","blocks":[…]} (1 a 12 blocos, dados reais que você obteve; nada inventado).
${BLOCKS_DOC}`;
  }
  if (ctx.display === 'html') {
    return `- MOSTRAR RESULTADO: crie uma página HTML autocontida (CSS/JS inline, sem CDN externo) em /workspace/.yui/views/${ctx.runId}/index.html,
visual escuro elegante (fundo #0a0c1d, texto #e8eaf4, acentos #67d8f2 e #a68cf7, fonte Manrope). Ela será exibida num iframe isolado.`;
  }
  return null;
});

// Ao terminar um run com display, publica a tela. Sem arquivo válido, cai para um resumo em markdown.
function publishFromRun(run: RunInfo) {
  const jsonFile = join(viewsDir(), `${run.id}.json`);
  const htmlFile = join(viewsDir(), run.id, 'index.html');
  let spec: CustomViewSpec | null = null;
  if (run.display === 'html' && existsSync(htmlFile)) {
    spec = { title: run.task.split(' · ')[0], eyebrow: run.agent, blocks: [{ type: 'html', url: viewUrl(run.id) }] };
  } else if (existsSync(jsonFile)) {
    try {
      const parsed = SpecSchema.safeParse(JSON.parse(readFileSync(jsonFile, 'utf8')));
      if (parsed.success) spec = { ...parsed.data, eyebrow: parsed.data.eyebrow ?? run.agent } as CustomViewSpec;
      else console.error(`custom view ${run.id} inválida`, parsed.error.issues.slice(0, 3));
    } catch (e) {
      console.error(`custom view ${run.id}`, (e as Error).message);
    }
  }
  spec ??= { title: run.task.split(' · ')[0], eyebrow: run.agent, blocks: [{ type: 'markdown', text: run.result ?? 'Sem resultado.' }] };
  saveCustom(spec, run.id, run.id);
  showCustom(run.id);
}

// O que abrir para "ver o resultado" de uma execução.
export function resultView(runId: string): { view: ViewName; params: ViewParams } {
  const run = getRun(runId);
  if (!run) return { view: 'runs', params: {} };
  if (getCustom(runId)) return { view: 'custom', params: { customId: runId } };
  if (run.missionId) return { view: 'mission', params: { missionId: run.missionId } };
  const p = run.project ? findProject(run.project) : undefined;
  if (p?.cloned && p.preview && existsSync(join(p.dir, p.preview)) && run.finishedAt && statSync(join(p.dir, p.preview)).mtimeMs >= new Date(run.startedAt ?? run.finishedAt).getTime()) {
    return { view: 'website', params: { project: p.slug } };
  }
  const rep = latestReport();
  if (rep && run.startedAt && new Date(rep.generatedAt).getTime() >= new Date(run.startedAt).getTime() - 60_000) return { view: 'report', params: {} };
  return { view: 'runs', params: { runId } };
}

runBus.on('finished', (run: RunInfo) => {
  if (run.state !== 'done') return;
  if (run.display) {
    publishFromRun(run);
    return;
  }
  if (run.missionId || run.workflowRunId) return; // missões/workflows mostram o próprio resultado
  const rv = resultView(run.id);
  if (rv.view === 'website' || rv.view === 'report') emit({ type: 'ui.action', action: { type: 'show_view', view: rv.view, params: rv.params } });
  else emit({ type: 'ui.action', action: { type: 'suggest_view', view: 'runs', params: { runId: run.id }, label: 'Ver resultado' } });
});

// ---------- cérebro ----------

const blockJsonSchema = {
  type: 'object',
  description: 'Um bloco. type define os campos: kpis{items[{label,value,tone}]}, chart{chart:bar|line|area|pie,title,labels[],series[{name,values[]}]}, table{title,columns[],rows[][]}, list{title,items[{title,subtitle,meta,tone,href}]}, markdown{text}, timeline{title,items[{t,label,tone}]}, image{src}, link{label,href}. tone: ok|warn|crit|cyan|lav|muted',
  properties: { type: { type: 'string', enum: ['kpis', 'chart', 'table', 'list', 'markdown', 'timeline', 'image', 'link'] } },
  required: ['type'],
  additionalProperties: true,
};

registerBrain({
  name: 'customViews',
  instructions: `- Gráfico, tabela, comparativo ou qualquer visualização de dados que você já tem (ou consegue com get_overview/get_runs/get_project/get_infra) => primeiro consulte, depois show_custom com blocos montados a partir dos dados reais. Nunca invente números.
- Dados que só os agentes alcançam (e-mails, agenda, Drive, Linear, Vercel, Supabase, web, leads) e que o usuário quer VER => delegate_task com display "blocks" (ou "html" para algo muito específico/visual); a tela abre sozinha quando o agente terminar.
- "o que o agente fez?", "mostra o resultado" => get_run_result.`,
  tools: [
    {
      type: 'function', name: 'show_custom', strict: false,
      description: 'Monta e abre no Canvas uma tela sob medida com blocos nativos (KPIs, gráfico, tabela, lista, markdown, linha do tempo, imagem, link).',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string' }, eyebrow: { type: 'string' }, blocks: { type: 'array', items: blockJsonSchema, minItems: 1 } },
        required: ['title', 'blocks'],
      },
    },
    {
      type: 'function', name: 'get_run_result', strict: true,
      description: 'Resultado completo de uma execução de agente (run_id null = última concluída) e, se show, abre o que ela produziu.',
      parameters: { type: 'object', additionalProperties: false, required: ['run_id', 'show'], properties: { run_id: { type: ['string', 'null'] }, show: { type: 'boolean' } } },
    },
  ],
  run(tool, args) {
    if (tool === 'show_custom') {
      const parsed = SpecSchema.safeParse(args);
      if (!parsed.success) {
        return Promise.resolve({ ok: false, error: 'blocos inválidos — corrija e chame de novo', detalhes: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
      }
      const info = saveCustom(parsed.data as CustomViewSpec, 'yui');
      showCustom(info.id);
      return Promise.resolve({ ok: true, id: info.id });
    }
    if (tool === 'get_run_result') {
      const id = (args.run_id as string | null) ?? (db.prepare(`SELECT id FROM runs WHERE state IN ('done','failed') ORDER BY finished_at DESC LIMIT 1`).get() as { id: string } | undefined)?.id;
      const run = id ? getRun(id) : null;
      if (!run) return Promise.resolve({ ok: false, error: 'execução não encontrada' });
      if (args.show) {
        const rv = resultView(run.id);
        emit({ type: 'ui.action', action: { type: 'show_view', view: rv.view, params: rv.params } });
      }
      return Promise.resolve({ agente: run.agent, tarefa: run.task, estado: run.state, resultado: run.result, projeto: run.project });
    }
    return undefined;
  },
});

// ---------- rotas ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2',
};

export function register(app: FastifyInstance): void {
  app.get('/api/custom', () =>
    (db.prepare('SELECT * FROM custom_views ORDER BY created_at DESC LIMIT 50').all() as Row[]).map((r) => ({ id: r.id, title: r.title, source: r.source, createdAt: r.created_at })),
  );
  app.get('/api/custom/:id', (req, reply) => getCustom((req.params as { id: string }).id) ?? reply.code(404).send({ error: 'not found' }));
  app.get('/api/runs/:id/result-view', (req) => resultView((req.params as { id: string }).id));

  // Páginas HTML geradas por agentes: iframe sandbox, acesso por token HMAC (origem opaca não leva cookie).
  app.get('/sandbox-view/:token/:id/*', (req, reply) => {
    const { token, id } = req.params as { token: string; id: string };
    const expected = sbToken(`view:${id}`);
    if (token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return reply.code(404).send();
    const root = resolve(viewsDir(), id);
    let file = resolve(root, normalize((req.params as Record<string, string>)['*'] || 'index.html'));
    if (!file.startsWith(root)) return reply.code(404).send();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) return reply.code(404).send();
    reply.header('Content-Security-Policy', "sandbox allow-scripts; frame-ancestors 'self'");
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    reply.header('Cache-Control', 'no-store');
    reply.type(MIME[extname(file)] ?? 'application/octet-stream');
    return readFileSync(file);
  });
}
