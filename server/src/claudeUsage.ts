import { query } from '@anthropic-ai/claude-agent-sdk';
import type { UsageLimit } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { kvGet, kvSet, now } from './db.ts';
import { claudeEnv } from './runs.ts';

// Limites do plano Claude (sessão de 5 h, semana…), conta e modelos disponíveis.
// Duas fontes: os eventos rate_limit_event que chegam durante as execuções dos agentes (runs.ts)
// e uma sonda curta do Claude Code (sem gastar turno: lê e aborta), a cada 10 min ou pelo botão "Atualizar limites".

interface Stored { at: string; limits: UsageLimit[] }

const WINDOWS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'] as const;

export function claudeLimits(): Stored | null {
  const raw = kvGet('claude_limits');
  return raw ? (JSON.parse(raw) as Stored) : null;
}

export function claudeAccount(): { subscriptionType?: string; email?: string; organization?: string; at: string } | null {
  const raw = kvGet('claude_account');
  return raw ? JSON.parse(raw) : null;
}

export function claudeModels(): { value: string; displayName: string; description: string; resolvedModel?: string }[] {
  const raw = kvGet('claude_models');
  return raw ? JSON.parse(raw) : [];
}

function merge(next: UsageLimit[]) {
  const cur = claudeLimits()?.limits ?? [];
  const map = new Map(cur.map((l) => [l.kind, l]));
  // evento sem a porcentagem (só status/reinício) não apaga o que já foi lido
  for (const l of next) {
    const prev = map.get(l.kind);
    const clean = Object.fromEntries(Object.entries(l).filter(([, v]) => v !== null && v !== undefined)) as Partial<UsageLimit>;
    map.set(l.kind, { ...(prev ?? { kind: l.kind, label: l.label, pct: null, resetsAt: null }), ...clean } as UsageLimit);
  }
  const order = (k: string) => (WINDOWS as readonly string[]).indexOf(k) === -1 ? 99 : (WINDOWS as readonly string[]).indexOf(k);
  kvSet('claude_limits', JSON.stringify({ at: now(), limits: [...map.values()].sort((a, b) => order(a.kind) - order(b.kind)) }));
}

/** rate_limit_event de uma execução: { rateLimitType, utilization (0–1 ou 0–100), resetsAt (epoch s), status }. */
export function saveRateLimit(info: unknown) {
  const i = info as { rateLimitType?: string; utilization?: number; resetsAt?: number; status?: string } | undefined;
  if (!i?.rateLimitType) return;
  const pct = typeof i.utilization === 'number' ? (i.utilization <= 1 ? i.utilization * 100 : i.utilization) : null;
  merge([{ kind: i.rateLimitType, label: i.rateLimitType, pct, resetsAt: i.resetsAt ? new Date(i.resetsAt * 1000).toISOString() : null, status: i.status ?? null }]);
}

let probing: Promise<void> | null = null;

/** Lê conta, limites e modelos pelo controle do Claude Code. Sem `force`, no máximo a cada 10 min. */
export function probeClaudeUsage(force = false): Promise<void> {
  const last = kvGet('claude_usage_probe_at');
  if (!force && last && Date.now() - Date.parse(last) < 10 * 60_000) return Promise.resolve();
  probing ??= (async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60_000);
    let release: () => void = () => {};
    // entrada em streaming que nunca manda mensagem: o processo sobe, responde aos controles e não gasta turno
    const input = (async function* () {
      await new Promise<void>((r) => (release = r));
    })() as AsyncIterable<never>;
    try {
      const q = query({ prompt: input, options: { cwd: config.workspaceDir, abortController: ac, env: claudeEnv(), maxTurns: 1, settingSources: ['user'] } });
      const [acct, models, usage] = await Promise.all([
        q.accountInfo().catch(() => null),
        q.supportedModels().catch(() => null),
        q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }).catch(() => null),
      ]);
      if (acct) kvSet('claude_account', JSON.stringify({ ...acct, subscriptionType: usage?.subscription_type ?? acct.subscriptionType, at: now() }));
      if (models?.length) kvSet('claude_models', JSON.stringify(models.map((m) => ({ value: m.value, displayName: m.displayName, description: m.description, resolvedModel: m.resolvedModel }))));
      const rl = usage?.rate_limits;
      if (rl) {
        const out: UsageLimit[] = [];
        for (const k of WINDOWS) {
          const w = rl[k];
          if (w) out.push({ kind: k, label: k, pct: w.utilization, resetsAt: w.resets_at });
        }
        for (const m of rl.model_scoped ?? []) out.push({ kind: `model:${m.display_name}`, label: `Semana · ${m.display_name}`, pct: m.utilization, resetsAt: m.resets_at });
        if (out.length) merge(out);
      }
      kvSet('claude_usage_probe_at', now());
    } catch (e) {
      if (!ac.signal.aborted) console.error('consumo claude', (e as Error).message);
    } finally {
      release();
      ac.abort();
      clearTimeout(timer);
      probing = null;
    }
  })();
  return probing;
}

export function startClaudeUsage() {
  setTimeout(() => void probeClaudeUsage(), 45_000).unref();
  setInterval(() => void probeClaudeUsage(), 10 * 60_000).unref();
}
