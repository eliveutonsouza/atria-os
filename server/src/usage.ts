import type { FastifyInstance } from 'fastify';
import type { UsageReport } from '../../shared/protocol.ts';
import { db, now, uid } from './db.ts';
import { costFor, costForSeconds } from './pricing.ts';
import { claudeLimits, probeClaudeUsage, claudeAccount } from './claudeUsage.ts';
import { getInit } from './capabilities.ts';
import { findAgent } from './agents.ts';
import { registerBrain } from './extensions.ts';

// Consumo de IA: cada chamada à OpenAI vira uma linha aqui (tokens + custo pela tabela de preços);
// o Claude Code vem da tabela runs (custo/tokens por execução) e dos limites do plano (claudeUsage.ts).

db.exec(`
CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  provider TEXT NOT NULL,
  feature TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  audio_seconds REAL NOT NULL DEFAULT 0,
  cost_usd REAL
);
CREATE INDEX IF NOT EXISTS ai_usage_at ON ai_usage(at);
`);

export type Feature = 'cerebro' | 'voz' | 'planejador' | 'workflow-decisao' | 'workflow-aprovacao' | 'workflow-gerar' | 'ajuda' | 'empresa' | 'empresa-embeddings';

export const FEATURE_LABEL: Record<string, string> = {
  cerebro: 'Cérebro da Yui',
  voz: 'Voz (GPT-Live)',
  planejador: 'Planejador de missões',
  'workflow-gerar': 'Criar workflows',
  'workflow-decisao': 'Decisões de workflow',
  'workflow-aprovacao': 'Aprovações de workflow',
  ajuda: 'Ajuda',
  empresa: 'Empresa (extração e busca)',
  'empresa-embeddings': 'Empresa (embeddings)',
};

type AnyUsage = {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number; audio_tokens?: number };
  output_tokens_details?: { audio_tokens?: number };
  input_token_details?: { cached_tokens?: number; audio_tokens?: number };
  output_token_details?: { audio_tokens?: number };
} | null | undefined;

/** Registra o uso de uma chamada à OpenAI (Responses, embeddings ou evento response.done da voz). Nunca lança. */
export function trackOpenAI(feature: Feature, model: string, raw: unknown, extra: { seconds?: number } = {}) {
  const usage = raw as AnyUsage;
  try {
    const input = usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
    const output = usage?.output_tokens ?? usage?.completion_tokens ?? 0;
    const inD = usage?.input_tokens_details ?? usage?.input_token_details;
    const outD = usage?.output_tokens_details ?? usage?.output_token_details;
    const cached = inD?.cached_tokens ?? 0;
    if (!input && !output && !extra.seconds) return;
    const cost = input || output ? costFor(model, { input, output, cached, audioIn: inD?.audio_tokens, audioOut: outD?.audio_tokens }) : costForSeconds(model, extra.seconds ?? 0);
    db.prepare(
      'INSERT INTO ai_usage(id, at, provider, feature, model, input_tokens, output_tokens, cached_tokens, audio_seconds, cost_usd) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(uid(), now(), 'openai', feature, model, input, output, cached, extra.seconds ?? 0, cost);
  } catch (e) {
    console.error('consumo openai', (e as Error).message);
  }
}

const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

const LIMIT_LABEL: Record<string, string> = {
  five_hour: 'Sessão atual (5 h)',
  seven_day: 'Semana · todos os modelos',
  seven_day_opus: 'Semana · Opus',
  seven_day_sonnet: 'Semana · Sonnet',
  seven_day_oauth_apps: 'Semana · apps conectados',
  overage: 'Uso extra',
};

export function usageReport(days = 7): UsageReport {
  const from = since(days);
  const sum = (sql: string, ...p: unknown[]) => ((db.prepare(sql).get(...p) as { v: number | null }).v ?? 0);

  // Claude Code (execuções dos agentes)
  const runs = db
    .prepare(`SELECT agent_id, COUNT(*) AS n, SUM(tokens_in + tokens_out) AS tok, SUM(cost_usd) AS cost FROM runs WHERE created_at >= ? GROUP BY agent_id ORDER BY cost DESC`)
    .all(from) as { agent_id: string; n: number; tok: number | null; cost: number | null }[];
  const last = db
    .prepare(`SELECT agent_id, task, context_tokens, context_window, finished_at FROM runs WHERE context_tokens IS NOT NULL ORDER BY finished_at DESC LIMIT 1`)
    .get() as { agent_id: string; task: string; context_tokens: number; context_window: number | null; finished_at: string } | undefined;
  const lim = claudeLimits();
  const acct = claudeAccount();

  // OpenAI
  const byFeature = db
    .prepare(`SELECT feature, model, SUM(input_tokens + output_tokens) AS tok, SUM(audio_seconds) AS secs, SUM(cost_usd) AS cost, COUNT(cost_usd) AS priced, COUNT(*) AS n FROM ai_usage WHERE at >= ? GROUP BY feature, model ORDER BY cost DESC, tok DESC`)
    .all(from) as { feature: string; model: string; tok: number; secs: number; cost: number | null; priced: number; n: number }[];
  const byModel = db
    .prepare(`SELECT model, SUM(input_tokens + output_tokens) AS tok, SUM(cost_usd) AS cost, COUNT(cost_usd) AS priced FROM ai_usage WHERE at >= ? GROUP BY model ORDER BY tok DESC`)
    .all(from) as { model: string; tok: number; cost: number | null; priced: number }[];

  // dia a dia (custo): Claude pelos runs, OpenAI pelo ai_usage
  const daily: UsageReport['daily'] = [];
  const dayOf = (iso: string) => iso.slice(0, 10);
  const cDays = new Map((db.prepare(`SELECT substr(created_at, 1, 10) AS d, SUM(cost_usd) AS c FROM runs WHERE created_at >= ? GROUP BY d`).all(from) as { d: string; c: number }[]).map((r) => [r.d, r.c]));
  const oDays = new Map((db.prepare(`SELECT substr(at, 1, 10) AS d, SUM(cost_usd) AS c FROM ai_usage WHERE at >= ? GROUP BY d`).all(from) as { d: string; c: number | null }[]).map((r) => [r.d, r.c ?? 0]));
  for (let i = days - 1; i >= 0; i--) {
    const d = dayOf(new Date(Date.now() - i * 86_400_000).toISOString());
    daily.push({ date: d, claude: cDays.get(d) ?? 0, openai: oDays.get(d) ?? 0 });
  }

  return {
    days,
    claude: {
      plan: acct?.subscriptionType ?? null,
      model: getInit()?.model ?? null,
      limits: (lim?.limits ?? []).map((l) => ({ ...l, label: LIMIT_LABEL[l.kind] ?? l.label ?? l.kind })),
      limitsAt: lim?.at ?? null,
      lastContext: last
        ? { agent: findAgent(last.agent_id)?.name ?? last.agent_id, task: last.task, used: last.context_tokens, window: last.context_window ?? 200_000, at: last.finished_at }
        : null,
      runs: runs.reduce((a, r) => a + r.n, 0),
      tokens: runs.reduce((a, r) => a + (r.tok ?? 0), 0),
      cost: runs.reduce((a, r) => a + (r.cost ?? 0), 0),
      byAgent: runs.map((r) => ({ agentId: r.agent_id, agent: findAgent(r.agent_id)?.name ?? r.agent_id, runs: r.n, tokens: r.tok ?? 0, cost: r.cost ?? 0 })),
    },
    openai: {
      today: sum(`SELECT SUM(cost_usd) AS v FROM ai_usage WHERE at >= ?`, startOfToday()),
      d7: sum(`SELECT SUM(cost_usd) AS v FROM ai_usage WHERE at >= ?`, since(7)),
      d30: sum(`SELECT SUM(cost_usd) AS v FROM ai_usage WHERE at >= ?`, since(30)),
      tokens: byFeature.reduce((a, r) => a + (r.tok ?? 0), 0),
      voiceSeconds: byFeature.filter((r) => r.feature === 'voz').reduce((a, r) => a + (r.secs ?? 0), 0),
      byFeature: byFeature.map((r) => ({ feature: r.feature, label: FEATURE_LABEL[r.feature] ?? r.feature, model: r.model, tokens: r.tok ?? 0, seconds: r.secs ?? 0, cost: r.priced ? r.cost : null })),
      byModel: byModel.map((r) => ({ model: r.model, tokens: r.tok ?? 0, cost: r.priced ? r.cost : null })),
      unpriced: byModel.filter((r) => !r.priced && r.tok > 0).map((r) => r.model),
    },
    daily,
  };
}

// Resumo enxuto para a Yui responder por voz: limites com % e reset, OpenAI hoje/7d, Claude no período.
const usd = (v: number) => `US$ ${v.toFixed(2).replace('.', ',')}`;
export function usageSummary(days = 7) {
  const r = usageReport([1, 7, 30].includes(days) ? days : 7);
  return {
    periodo_dias: r.days,
    claude: {
      plano: r.claude.plan,
      limites: r.claude.limits.length
        ? r.claude.limits.map((l) => ({ limite: l.label, uso: l.pct == null ? null : `${Math.round(l.pct)}%`, reinicia: l.resetsAt }))
        : 'ainda não lidos (botão Atualizar limites em Consumo de IA)',
      limites_lidos_em: r.claude.limitsAt,
      execucoes: r.claude.runs,
      custo_equivalente: usd(r.claude.cost),
      contexto_ultima_execucao: r.claude.lastContext ? `${Math.round((r.claude.lastContext.used / r.claude.lastContext.window) * 100)}% (${r.claude.lastContext.agent})` : null,
    },
    openai: {
      hoje: usd(r.openai.today),
      sete_dias: usd(r.openai.d7),
      trinta_dias: usd(r.openai.d30),
      sem_preco: r.openai.unpriced.length ? r.openai.unpriced : undefined,
    },
  };
}

registerBrain({
  name: 'consumo',
  instructions: '- "Quanto gastei de IA?", "quanto falta do limite do Claude?" => consumo_ia (responda em 1–2 frases; datas de reinício no fuso local).',
  tools: [
    {
      type: 'function', name: 'consumo_ia', strict: true,
      description: 'Consumo de IA: limites do plano Claude (uso % e quando reinicia), custo do Claude Code e da OpenAI (hoje, 7 e 30 dias).',
      parameters: { type: 'object', additionalProperties: false, properties: { dias: { type: ['number', 'null'], description: 'período do custo do Claude: 1, 7 ou 30; null = 7' } }, required: ['dias'] },
    },
  ],
  run(tool, args) {
    if (tool !== 'consumo_ia') return undefined;
    try {
      return Promise.resolve(usageSummary(typeof args.dias === 'number' ? args.dias : 7));
    } catch (e) {
      return Promise.resolve({ ok: false, error: (e as Error).message });
    }
  },
});

export function register(app: FastifyInstance): void {
  app.get('/api/usage', (req) => {
    const d = Number((req.query as { days?: string }).days);
    return usageReport([1, 7, 30].includes(d) ? d : 7);
  });
  app.post('/api/usage/refresh', async () => {
    await probeClaudeUsage(true);
    return usageReport(7);
  });
}
