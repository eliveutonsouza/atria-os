import { db } from './db.ts';
import { findAgent } from './agents.ts';
import { findProject } from './projects.ts';
import { claudeLimits } from './claudeUsage.ts';
import { registerBrain } from './extensions.ts';
import { rateRun } from './runs.ts';

// Balanço falado (ideia do /insights do Hermes): "Yui, como foi minha semana?". Tudo do SQLite, nunca do LLM.

const DAY = 86400_000;

export function insights(days = 7, nowMs = Date.now()) {
  const d = [1, 7, 14, 30].includes(days) ? days : 7;
  const since = new Date(nowMs - d * DAY).toISOString();
  const runs = db.prepare(`SELECT agent_id, project, state, origin, task, cost_usd, rating FROM runs WHERE created_at >= ?`).all(since) as
    { agent_id: string; project: string | null; state: string; origin: string; task: string; cost_usd: number; rating: number | null }[];
  const count = <K extends string>(key: (r: (typeof runs)[number]) => K) => {
    const m = new Map<K, number>();
    for (const r of runs) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const failed = runs.filter((r) => r.state === 'failed');
  const openai = (db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_usage WHERE at >= ?`).get(since) as { c: number }).c;
  const approvals = db.prepare(`SELECT status, COUNT(*) AS n FROM approvals WHERE created_at >= ? GROUP BY status`).all(since) as { status: string; n: number }[];
  const msgs = (db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE who = 'user' AND at >= ?`).get(since) as { n: number }).n;
  const usd = (v: number) => `US$ ${v.toFixed(2).replace('.', ',')}`;
  return {
    periodo_dias: d,
    pedidos_seus: msgs,
    execucoes: runs.length,
    concluidas: runs.filter((r) => r.state === 'done').length,
    falhas: failed.length,
    automaticas: runs.filter((r) => r.origin === 'routine').length,
    por_agente: count((r) => r.agent_id).slice(0, 5).map(([id, n]) => ({
      agente: findAgent(id)?.name ?? id,
      execucoes: n,
      notas_boas: runs.filter((r) => r.agent_id === id && r.rating === 1).length,
      notas_ruins: runs.filter((r) => r.agent_id === id && r.rating === -1).length,
    })),
    por_projeto: count((r) => r.project ?? '').slice(0, 5).map(([p, n]) => ({ projeto: p ? findProject(p)?.name ?? p : 'Geral', execucoes: n })),
    falhas_recentes: failed.slice(-3).map((r) => r.task),
    custo_claude_equivalente: usd(runs.reduce((a, r) => a + (r.cost_usd ?? 0), 0)),
    custo_openai: usd(openai),
    aprovacoes: Object.fromEntries(approvals.map((a) => [a.status, a.n])),
    limites_claude: (claudeLimits()?.limits ?? []).filter((l) => l.kind === 'five_hour' || l.kind === 'seven_day').map((l) => ({ janela: l.kind === 'five_hour' ? '5 h' : 'semana', uso: l.pct == null ? null : `${Math.round(l.pct)}%`, reinicia: l.resetsAt })),
  };
}

// "Essa ficou ruim" / "gostei do que o Dev fez": nota na última execução concluída (ou na citada).
registerBrain({
  name: 'avaliar-execucao',
  instructions: '- "Essa ficou boa/ruim", "não gostei do que o agente fez", "nota 👍 para o relatório" => avaliar_execucao (sem id = última concluída; confirme qual foi em 1 frase).',
  tools: [
    {
      type: 'function', name: 'avaliar_execucao', strict: true,
      description: 'Dá nota 👍 (boa) ou 👎 (ruim) a uma execução de agente. 👎 faz o agente revisar o que errou.',
      parameters: { type: 'object', additionalProperties: false, properties: { nota: { type: 'string', enum: ['boa', 'ruim', 'limpar'] }, run_id: { type: ['string', 'null'], description: 'null = última execução concluída' } }, required: ['nota', 'run_id'] },
    },
  ],
  run(tool, args, ctx) {
    if (tool !== 'avaliar_execucao') return undefined;
    const id = typeof args.run_id === 'string' && args.run_id ? args.run_id
      : (db.prepare(`SELECT id FROM runs WHERE state IN ('done','failed') ORDER BY finished_at DESC LIMIT 1`).get() as { id: string } | undefined)?.id;
    if (!id) return Promise.resolve({ ok: false, error: 'nenhuma execução concluída para avaliar' });
    const v = args.nota === 'boa' ? 1 : args.nota === 'ruim' ? -1 : 0;
    if (ctx.dryRun) return Promise.resolve({ ok: true });
    const r = rateRun(id, v);
    return Promise.resolve(r ? { ok: true, tarefa: r.task, agente: r.agent, nota: args.nota } : { ok: false, error: 'execução não encontrada' });
  },
});

registerBrain({
  name: 'insights',
  instructions: '- "Como foi minha semana / meu dia?", "o que mais rodou?", "balanço do mês" => get_insights (fale 2–3 frases: volume, o que mais rodou, falhas e custo; não leia listas).',
  tools: [
    {
      type: 'function', name: 'get_insights', strict: true,
      description: 'Balanço do período: pedidos, execuções por agente/projeto, falhas, custo e uso do plano Claude.',
      parameters: { type: 'object', additionalProperties: false, properties: { dias: { type: ['number', 'null'], description: '1, 7, 14 ou 30; null = 7' } }, required: ['dias'] },
    },
  ],
  run(tool, args) {
    if (tool !== 'get_insights') return undefined;
    return Promise.resolve(insights(typeof args.dias === 'number' ? args.dias : 7));
  },
});
