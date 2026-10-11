import type { FastifyInstance } from 'fastify';
import type { RunInfo, UsageLimit } from '../../shared/protocol.ts';
import { db, kvGet, kvSet } from './db.ts';
import { getSetting } from './settings.ts';
import { claudeLimits, probeClaudeUsage } from './claudeUsage.ts';
import { addStartGate, isAutomaticRun, kickQueue, runBus, type GateRun } from './runs.ts';
import { sendNotice, publicUrl } from './notify.ts';
import { narrate } from './live.ts';

// Orçamento (ideia do Paperclip, adaptada ao plano por assinatura): o que manda é o % das janelas do plano
// Claude (sessão de 5 h e semana). Acima de budget.stopPct, o que é automático (rotinas e workflows que uma
// rotina disparou) espera na fila até a janela reiniciar; o que o usuário pede na hora sempre passa.
// A OpenAI tem teto diário em US$ (opcional) que segura os workflows automáticos (usam o cérebro).

const WINDOWS = ['five_hour', 'seven_day'] as const;
const WINDOW_LABEL: Record<string, string> = { five_hour: 'janela de 5 h', seven_day: 'semana' };
const STALE_MS = 15 * 60_000;

/** Janela acima do limite que ainda não reiniciou. */
export function overLimit(pct: number, limits: UsageLimit[] = claudeLimits()?.limits ?? [], nowMs = Date.now()): UsageLimit | null {
  let worst: UsageLimit | null = null;
  for (const l of limits) {
    if (!(WINDOWS as readonly string[]).includes(l.kind) || l.pct == null || l.pct < pct) continue;
    if (l.resetsAt && Date.parse(l.resetsAt) <= nowMs) continue; // já reiniciou: o dado é velho
    if (!worst || l.pct > (worst.pct ?? 0)) worst = l;
  }
  return worst;
}

// Leitura velha: no máximo 1 sonda forçada a cada 15 min, mesmo se a sonda falhar (nunca vira laço).
function refreshIfStale(nowMs = Date.now()) {
  const at = claudeLimits()?.at;
  if (at && nowMs - Date.parse(at) < STALE_MS) return;
  const last = kvGet('budget_probe_at');
  if (last && nowMs - Date.parse(last) < STALE_MS) return;
  kvSet('budget_probe_at', new Date(nowMs).toISOString());
  void probeClaudeUsage(true).then(kickQueue);
}

export function openaiToday(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return (db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_usage WHERE at >= ?`).get(d.toISOString()) as { c: number }).c;
}
const openaiCap = () => Number(getSetting('budget.openaiDailyUsd') ?? 0);
export const openaiOverCap = () => openaiCap() > 0 && openaiToday() >= openaiCap();

const hhmm = (iso: string) => {
  const d = new Date(iso);
  const tz = process.env.TZ || undefined;
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  return d.getTime() - Date.now() > 20 * 3600_000 ? `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', timeZone: tz })} ${time}` : time;
};

// Reavalia a fila quando a janela reinicia (um timer só, no reinício mais próximo).
let wake: { at: number; t: NodeJS.Timeout } | null = null;
function wakeAt(iso: string | null) {
  const at = iso ? Date.parse(iso) + 30_000 : Date.now() + STALE_MS;
  if (wake && wake.at <= at) return;
  if (wake) clearTimeout(wake.t);
  wake = { at, t: setTimeout(() => { wake = null; kickQueue(); }, Math.max(5_000, at - Date.now())) };
  wake.t.unref();
}

// Um aviso por janela/limiar (chave guardada no kv para não repetir depois de reiniciar o processo).
function noticeOnce(key: string, text: string, speak: boolean) {
  if (kvGet(`budget_notice:${key}`)) return;
  kvSet(`budget_notice:${key}`, new Date().toISOString());
  narrate(text, { speak, project: null });
  void sendNotice({ title: 'Atria · consumo de IA', text, url: publicUrl('/app'), channels: ['telegram', 'push'], kind: 'notice' });
}

export function gate(r: GateRun): string | null {
  if (!isAutomaticRun(r)) return null;
  refreshIfStale();
  const stop = Number(getSetting('budget.stopPct') ?? 95);
  const over = overLimit(stop);
  if (over) {
    wakeAt(over.resetsAt);
    const when = over.resetsAt ? hhmm(over.resetsAt) : 'em breve';
    noticeOnce(`stop:${over.kind}:${over.resetsAt}`, `Pausei as rotinas automáticas: a ${WINDOW_LABEL[over.kind] ?? over.kind} do Claude está em ${Math.round(over.pct ?? 0)}%. Voltam quando reiniciar, ${when}. O que você pedir continua rodando.`, true);
    return `Aguardando limite do Claude (reinicia ${when})`;
  }
  if (r.workflow_run_id && openaiOverCap()) {
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    wakeAt(tomorrow.toISOString());
    noticeOnce(`openai:${tomorrow.toISOString().slice(0, 10)}`, `A OpenAI passou do teto de hoje (US$ ${openaiCap().toFixed(2)}). Segurei os workflows automáticos até amanhã; a conversa comigo continua.`, false);
    return 'Aguardando teto diário da OpenAI (amanhã)';
  }
  return null;
}

/** Aviso de limiar (budget.warnPct), uma vez por janela. Chamado de tempos em tempos e ao fim das execuções. */
export function checkWarn() {
  const warn = Number(getSetting('budget.warnPct') ?? 80);
  const stop = Number(getSetting('budget.stopPct') ?? 95);
  const l = overLimit(warn);
  if (l && (l.pct ?? 0) < stop) {
    noticeOnce(`warn:${l.kind}:${l.resetsAt}`, `A ${WINDOW_LABEL[l.kind] ?? l.kind} do Claude está em ${Math.round(l.pct ?? 0)}%${l.resetsAt ? `, reinicia ${hhmm(l.resetsAt)}` : ''}. Em ${stop}% eu pauso as rotinas automáticas.`, false);
  }
}

/** Execuções seguradas na fila por limite (para a Yui e para o painel). */
export const heldByBudget = () =>
  (db.prepare(`SELECT COUNT(*) AS n FROM runs WHERE state = 'queued' AND (current_op LIKE 'Aguardando limite%' OR current_op LIKE 'Aguardando teto%')`).get() as { n: number }).n;

addStartGate(gate);
runBus.on('finished', (_run: RunInfo) => checkWarn());
setInterval(() => {
  checkWarn();
  if (heldByBudget()) kickQueue();
}, 5 * 60_000).unref();

// Execução calada (watchdog em runs.ts): avisa a Yui e fora do app.
runBus.on('stalled', (run: RunInfo) => {
  const text = `A tarefa "${run.task}" está sem atividade há um tempo. Se continuar calada, eu paro para liberar a vaga.`;
  narrate(text, { speak: false, project: run.project ?? null });
  void sendNotice({ title: 'Atria · execução parada', text, url: publicUrl('/app'), channels: ['push'], kind: 'notice' });
});

export function register(app: FastifyInstance): void {
  app.get('/api/budget', () => ({
    warnPct: Number(getSetting('budget.warnPct') ?? 80),
    stopPct: Number(getSetting('budget.stopPct') ?? 95),
    over: overLimit(Number(getSetting('budget.stopPct') ?? 95)),
    held: heldByBudget(),
    openaiToday: openaiToday(),
    openaiCap: openaiCap(),
  }));
}
