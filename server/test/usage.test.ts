import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Consumo de IA: registro das chamadas à OpenAI (custo pela tabela) e agregação do relatório.
// Banco e workspace temporários: o env precisa estar pronto antes de importar os módulos.
const root = mkdtempSync(join(tmpdir(), 'yui-usage-'));
process.env.YUI_DATA_DIR = join(root, 'data');
process.env.YUI_WORKSPACE_DIR = join(root, 'ws');
process.env.YUI_SEED_DIR = join(root, 'seed');
mkdirSync(process.env.YUI_DATA_DIR, { recursive: true });

const { db } = await import('../src/db.ts');
const { trackOpenAI, usageReport, usageSummary } = await import('../src/usage.ts');
const { brainExtensions } = await import('../src/extensions.ts');

const rows = () => db.prepare('SELECT * FROM ai_usage ORDER BY rowid').all() as { feature: string; model: string; input_tokens: number; output_tokens: number; cached_tokens: number; audio_seconds: number; cost_usd: number | null }[];
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const addRun = (id: string, agent: string, tin: number, tout: number, cost: number, ctx: number | null, finishedMinAgo: number) =>
  db
    .prepare(`INSERT INTO runs(id, agent_id, instruction, task, state, created_at, finished_at, tokens_in, tokens_out, cost_usd, context_tokens, context_window) VALUES(?, ?, 'x', ?, 'done', ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, agent, `tarefa ${id}`, ago(finishedMinAgo + 1), ago(finishedMinAgo), tin, tout, cost, ctx, ctx ? 200_000 : null);

test('trackOpenAI: gpt-4o-mini usa a tabela de preços (com cache)', () => {
  trackOpenAI('cerebro', 'gpt-4o-mini', { input_tokens: 1_000_000, output_tokens: 1_000_000, input_tokens_details: { cached_tokens: 200_000 } });
  const r = rows().at(-1)!;
  assert.equal(r.feature, 'cerebro');
  assert.equal(r.cached_tokens, 200_000);
  // 800k × 0,15 + 200k × 0,075 + 1M × 0,6 (por milhão)
  assert.ok(Math.abs((r.cost_usd ?? 0) - (0.12 + 0.015 + 0.6)) < 1e-9, String(r.cost_usd));
});

test('trackOpenAI: modelo desconhecido grava custo null; uso vazio não grava', () => {
  const before = rows().length;
  trackOpenAI('planejador', 'modelo-misterioso', { prompt_tokens: 500, completion_tokens: 100 });
  trackOpenAI('planejador', 'gpt-4o-mini', { input_tokens: 0, output_tokens: 0 });
  trackOpenAI('planejador', 'gpt-4o-mini', null);
  assert.equal(rows().length, before + 1);
  const r = rows().at(-1)!;
  assert.equal(r.model, 'modelo-misterioso');
  assert.equal(r.input_tokens, 500);
  assert.equal(r.cost_usd, null);
});

test('trackOpenAI: sessão de voz medida em segundos', () => {
  trackOpenAI('voz', 'gpt-live-1', null, { seconds: 90 });
  const r = rows().at(-1)!;
  assert.equal(r.feature, 'voz');
  assert.equal(r.audio_seconds, 90);
  // gpt-live-1 é cobrado por minuto (US$ 0,05)
  assert.ok(Math.abs((r.cost_usd ?? 0) - 0.075) < 1e-9, String(r.cost_usd));
  assert.equal(r.input_tokens, 0);
});

test('usageReport agrega OpenAI, runs do Claude e último contexto', () => {
  addRun('u1', 'frontend', 1000, 500, 1.5, 50_000, 30);
  addRun('u2', 'frontend', 2000, 1000, 2.5, 112_000, 10);
  addRun('u3', 'backend', 300, 200, 0.25, null, 5);
  const rep = usageReport(7);
  assert.equal(rep.days, 7);
  assert.equal(rep.daily.length, 7);

  assert.equal(rep.claude.runs, 3);
  assert.equal(rep.claude.tokens, 5000);
  assert.ok(Math.abs(rep.claude.cost - 4.25) < 1e-9);
  assert.deepEqual(rep.claude.byAgent.map((a) => [a.agentId, a.runs, a.tokens]), [['frontend', 2, 4500], ['backend', 1, 500]]);
  // contexto vem do run mais recente que tem context_tokens (u3 não tem)
  assert.equal(rep.claude.lastContext?.used, 112_000);
  assert.equal(rep.claude.lastContext?.window, 200_000);
  assert.equal(rep.claude.lastContext?.task, 'tarefa u2');
  assert.deepEqual(rep.claude.limits, []);

  assert.ok(Math.abs(rep.openai.today - 0.81) < 1e-9, String(rep.openai.today));
  assert.equal(rep.openai.d7, rep.openai.today);
  assert.equal(rep.openai.voiceSeconds, 90);
  assert.deepEqual(rep.openai.unpriced, ['modelo-misterioso']);
  const brain = rep.openai.byFeature.find((f) => f.feature === 'cerebro')!;
  assert.equal(brain.label, 'Cérebro da Yui');
  assert.equal(brain.tokens, 2_000_000);
  assert.equal(rep.openai.byFeature.find((f) => f.model === 'modelo-misterioso')?.cost, null);

  // soma dos dias = total (perto da meia-noite UTC os runs podem cair em ontem)
  assert.ok(Math.abs(rep.daily.reduce((a, d) => a + d.claude, 0) - 4.25) < 1e-9);
  assert.ok(Math.abs(rep.daily.reduce((a, d) => a + d.openai, 0) - 0.81) < 1e-9);
  assert.equal(usageReport(1).daily.length, 1);
});

test('tool consumo_ia da Yui devolve o resumo', async () => {
  const ext = brainExtensions().find((e) => e.name === 'consumo');
  assert.ok(ext);
  assert.equal(ext.run('outra_tool', {}, { dryRun: false }), undefined);
  const out = (await ext.run('consumo_ia', { dias: null }, { dryRun: false })) as ReturnType<typeof usageSummary>;
  assert.equal(out.periodo_dias, 7);
  assert.match(out.openai.hoje, /^US\$ 0,81$/);
  assert.equal(out.claude.custo_equivalente, 'US$ 4,25');
  assert.match(String(out.claude.limites), /ainda não lidos/);
  assert.deepEqual(out.openai.sem_preco, ['modelo-misterioso']);
});
