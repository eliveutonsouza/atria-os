import type { FastifyInstance } from 'fastify';
import type { SettingsPayload } from '../../shared/protocol.ts';
import { readEnv, setSettingsResolver } from './config.ts';
import { db, kvGet, kvSet, now } from './db.ts';

// Configurações editáveis pelo painel. Precedência: banco > .env > padrão.
// O .env vira só o "bootstrap" da instalação; tudo que o usuário ajusta no painel mora aqui.

db.exec(`CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);

type Kind = 'string' | 'secret' | 'number' | 'boolean' | 'enum';
interface Def {
  kind: Kind;
  env?: string; // variável do .env usada como fallback
  def: string | number | boolean | null;
  min?: number;
  max?: number;
  options?: string[];
  maxLen?: number;
}

// Chaves aceitas pelo painel. `auth.passwordHash` não aparece aqui: só muda por /api/auth/password e /api/setup/password.
export const SETTINGS: Record<string, Def> = {
  'user.name': { kind: 'string', env: 'ATRIA_USER_NAME', def: '', maxLen: 60 },
  'user.email': { kind: 'string', env: 'ATRIA_USER_EMAIL', def: '', maxLen: 120 },
  'user.city': { kind: 'string', env: 'ATRIA_USER_CITY', def: '', maxLen: 80 },
  'openai.key': { kind: 'secret', env: 'OPENAI_API_KEY', def: '' },
  'models.brain': { kind: 'string', env: 'ATRIA_BRAIN_MODEL', def: 'gpt-6-luna', maxLen: 60 },
  'models.planner': { kind: 'string', env: 'ATRIA_PLANNER_MODEL', def: 'gpt-6-sol', maxLen: 60 },
  'models.live': { kind: 'string', env: 'ATRIA_LIVE_MODEL', def: 'gpt-live-1', maxLen: 60 },
  'claude.model': { kind: 'string', env: 'ATRIA_CLAUDE_MODEL', def: '', maxLen: 60 },
  'models.embed': { kind: 'string', env: 'ATRIA_EMBED_MODEL', def: 'text-embedding-3-small', maxLen: 60 },
  'pricing.openai': { kind: 'string', def: '', maxLen: 4000 },
  'runs.concurrency': { kind: 'number', env: 'ATRIA_MAX_CONCURRENT_RUNS', def: 2, min: 1, max: 8 },
  'voice.name': { kind: 'string', env: 'ATRIA_VOICE', def: 'marin', maxLen: 40 },
  'voice.idleMin': { kind: 'number', env: 'ATRIA_LIVE_IDLE_MIN', def: 5, min: 1, max: 60 },
  'voice.pttKey': { kind: 'enum', def: 'Space', options: ['Space', 'Backquote', 'F8', 'AltRight'] },
  'ui.particleDensity': { kind: 'number', def: 1, min: 0.3, max: 2 },
  'ui.reducedMotion': { kind: 'boolean', def: false },
  'approvals.mcpSensitive': { kind: 'boolean', def: false },
  'notify.types': { kind: 'string', def: 'approval,failed,done', maxLen: 120 },
  // Monitoramento remoto (Atria Central): pulso a cada 30 s + URL de saúde (telemetry.ts)
  'monitor.enabled': { kind: 'boolean', env: 'ATRIA_MONITOR_ENABLED', def: false },
  'monitor.url': { kind: 'string', env: 'ATRIA_MONITOR_URL', def: '', maxLen: 200 },
  'monitor.key': { kind: 'secret', env: 'ATRIA_MONITOR_KEY', def: '', maxLen: 200 },
};

/** Endereço do monitor: https, ou http só em localhost/127.0.0.1 (testes). */
export function validMonitorUrl(s: string): boolean {
  try {
    const u = new URL(s);
    if (u.username || u.password) return false;
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname));
  } catch {
    return false;
  }
}

const SECRET_KEYS = new Set(['auth.passwordHash', ...Object.entries(SETTINGS).filter(([, d]) => d.kind === 'secret').map(([k]) => k)]);

export function rawGet(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setRaw(key: string, value: string | null) {
  if (value === null || value === '') db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else
    db.prepare('INSERT INTO settings(key, value, updated_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, value, now());
  mirrorEnv(key);
}

// Valor efetivo (banco > .env > padrão) já convertido.
export function getSetting(key: string): string | number | boolean | null {
  const d = SETTINGS[key];
  const fromEnv = d?.env ? (envMirror.has(d.env) ? envMirror.get(d.env) : readEnv(d.env)) : undefined;
  const raw = rawGet(key) ?? fromEnv ?? null;
  if (!d) return raw;
  if (raw === null || raw === '') return d.def;
  if (d.kind === 'number') return Number.isFinite(Number(raw)) ? Number(raw) : d.def;
  if (d.kind === 'boolean') return raw === 'true' || raw === '1';
  return raw;
}

// Módulos que leem process.env diretamente (planner das missões, workflows) enxergam o valor do painel.
const envMirror = new Map<string, string | undefined>();
function mirrorEnv(key: string) {
  const d = SETTINGS[key];
  if (!d?.env || d.kind === 'secret') return;
  if (!envMirror.has(d.env)) envMirror.set(d.env, readEnv(d.env));
  const v = rawGet(key);
  if (v !== null && v !== '') process.env[d.env] = v;
  else if (envMirror.get(d.env) !== undefined) process.env[d.env] = envMirror.get(d.env);
  else delete process.env[d.env];
}

function payload(): SettingsPayload {
  const values: SettingsPayload['values'] = {};
  const secrets: SettingsPayload['secrets'] = {};
  for (const [k, d] of Object.entries(SETTINGS)) {
    if (d.kind === 'secret') secrets[k] = !!getSetting(k);
    else values[k] = getSetting(k);
  }
  secrets['auth.passwordHash'] = !!(rawGet('auth.passwordHash') || readEnv('ATRIA_PASSWORD_HASH'));
  return { values, secrets };
}

// Hook: módulos que precisam reagir à mudança (ex.: cliente OpenAI) se inscrevem.
type Listener = (keys: string[]) => void;
const listeners: Listener[] = [];
export function onSettingsChange(fn: Listener) {
  listeners.push(fn);
}

// Preços da OpenAI: { "modelo": { "in": 1.25, "out": 10, "perMinute": 0.06 } } com números ≥ 0 (ver pricing.ts).
function validatePricing(s: string) {
  let j: unknown;
  try {
    j = JSON.parse(s);
  } catch {
    throw new Error('preços: JSON inválido');
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('preços: use { "modelo": { "in": 1.25, "out": 10 } }');
  for (const [m, p] of Object.entries(j as Record<string, unknown>)) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error(`preços: ${m} precisa ser um objeto`);
    for (const [f, n] of Object.entries(p as Record<string, unknown>)) if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new Error(`preços: ${m}.${f} precisa ser um número ≥ 0`);
  }
}

function validate(key: string, v: unknown): string | null {
  const d = SETTINGS[key];
  if (!d) throw new Error(`chave desconhecida: ${key}`);
  if (v === null || v === '') return null;
  switch (d.kind) {
    case 'number': {
      const n = Number(v);
      if (!Number.isFinite(n) || (d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max)) throw new Error(`${key}: entre ${d.min} e ${d.max}`);
      return String(n);
    }
    case 'boolean':
      if (typeof v !== 'boolean') throw new Error(`${key}: verdadeiro/falso`);
      return v ? 'true' : 'false';
    case 'enum':
      if (!d.options?.includes(String(v))) throw new Error(`${key}: opção inválida`);
      return String(v);
    default: {
      const s = String(v).trim();
      if (d.maxLen && s.length > d.maxLen) throw new Error(`${key}: até ${d.maxLen} caracteres`);
      if (key === 'user.email' && s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Error('e-mail inválido');
      if (key === 'pricing.openai' && s) validatePricing(s);
      if (key === 'monitor.url' && s && !validMonitorUrl(s)) throw new Error('endereço do monitor: use https://');
      if (key === 'openai.key' && s &&!/^sk-[A-Za-z0-9_-]{20,}$/.test(s)) throw new Error('chave OpenAI inválida (começa com sk-)');
      return s;
    }
  }
}

export async function testOpenAI(key?: string): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const k = key ?? String(getSetting('openai.key') ?? '');
  if (!k) return { ok: false, error: 'sem chave' };
  try {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return { ok: false, error: r.status === 401 ? 'chave recusada pela OpenAI' : `OpenAI respondeu ${r.status}` };
    const j = (await r.json()) as { data: { id: string }[] };
    const want = [String(getSetting('models.live')), String(getSetting('models.brain')), String(getSetting('models.planner'))];
    const have = new Set(j.data.map((m) => m.id));
    return { ok: true, models: want.map((m) => `${m}${have.has(m) ? '' : ' (sem acesso)'}`) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Resolvedor ativo desde o import: rotas de auth/onboarding já enxergam a senha salva no banco.
setSettingsResolver((key) => rawGet(key));
for (const k of Object.keys(SETTINGS)) mirrorEnv(k);

export function register(app: FastifyInstance): void {
  // 2026-10-06: tudo no automático — o "pedir aprovação em conectores" salvo antes volta ao padrão (desligado), uma vez.
  if (!kvGet('approvals_auto_v1')) {
    setRaw('approvals.mcpSensitive', null);
    kvSet('approvals_auto_v1', '1');
  }
  app.get('/api/settings', () => payload());

  app.put('/api/settings', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed: [string, string | null][] = [];
    try {
      for (const [k, v] of Object.entries(body)) {
        if (k === 'auth.passwordHash') continue;
        // segredo vazio no formulário = "não mexer"; para apagar manda null explicitamente
        if (SECRET_KEYS.has(k) && v === '') continue;
        parsed.push([k, validate(k, v)]);
      }
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const newKey = parsed.find(([k, v]) => k === 'openai.key' && v)?.[1];
    if (newKey) {
      const t = await testOpenAI(newKey);
      if (!t.ok) return reply.code(400).send({ error: t.error ?? 'chave OpenAI inválida' });
    }
    for (const [k, v] of parsed) setRaw(k, v);
    const keys = parsed.map(([k]) => k);
    for (const fn of listeners) {
      try {
        fn(keys);
      } catch (e) {
        console.error('settings listener', (e as Error).message);
      }
    }
    return payload();
  });

  app.post('/api/settings/test-openai', async (req) => {
    const key = (req.body as { key?: string } | undefined)?.key;
    return testOpenAI(key || undefined);
  });
}
