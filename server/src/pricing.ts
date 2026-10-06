import { getSetting } from './settings.ts';

// Preço da OpenAI em US$ por 1 milhão de tokens. Tabela padrão por prefixo de modelo (o mais longo vence);
// Configurações › Modelos › "Preços" (pricing.openai, JSON { "prefixo": { "in": 1.25, "out": 10, ... } }) sobrescreve.
// Modelo sem preço conhecido grava custo null: o painel mostra os tokens e avisa.

export interface Price {
  in: number; // entrada (texto)
  out: number; // saída (texto)
  cachedIn?: number; // entrada em cache
  audioIn?: number; // voz: áudio de entrada
  audioOut?: number; // voz: áudio de saída
  perMinute?: number; // voz cobrada por minuto de sessão
}

const DEFAULTS: Record<string, Price> = {
  'gpt-4o-mini': { in: 0.15, out: 0.6, cachedIn: 0.075 },
  'gpt-4o': { in: 2.5, out: 10, cachedIn: 1.25 },
  'gpt-4.1-nano': { in: 0.1, out: 0.4, cachedIn: 0.025 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6, cachedIn: 0.1 },
  'gpt-4.1': { in: 2, out: 8, cachedIn: 0.5 },
  'gpt-5-nano': { in: 0.05, out: 0.4, cachedIn: 0.005 },
  'gpt-5-mini': { in: 0.25, out: 2, cachedIn: 0.025 },
  'gpt-5': { in: 1.25, out: 10, cachedIn: 0.125 },
  'gpt-realtime': { in: 4, out: 16, cachedIn: 0.4, audioIn: 32, audioOut: 64 },
  'text-embedding-3-small': { in: 0.02, out: 0 },
  'text-embedding-3-large': { in: 0.13, out: 0 },
};

function overrides(): Record<string, Price> {
  const raw = getSetting('pricing.openai');
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, Price>;
  } catch {
    return {};
  }
}

export function priceFor(model: string): Price | null {
  const table = { ...DEFAULTS, ...overrides() };
  const key = Object.keys(table)
    .filter((k) => model === k || model.startsWith(`${k}-`) || model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? table[key] : null;
}

export interface TokenCounts {
  input: number;
  output: number;
  cached?: number;
  audioIn?: number;
  audioOut?: number;
}

/** Custo em US$, ou null se o modelo não tem preço. Áudio sai do total de entrada/saída quando informado. */
export function costFor(model: string, t: TokenCounts): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const cached = t.cached ?? 0;
  const aIn = t.audioIn ?? 0;
  const aOut = t.audioOut ?? 0;
  const textIn = Math.max(0, t.input - cached - aIn);
  const textOut = Math.max(0, t.output - aOut);
  const usd =
    textIn * p.in + cached * (p.cachedIn ?? p.in) + textOut * p.out + aIn * (p.audioIn ?? p.in) + aOut * (p.audioOut ?? p.out);
  return usd / 1_000_000;
}

export const pricingDefaults = () => DEFAULTS;

/** Custo de uma sessão medida em segundos (voz), quando o modelo tem preço por minuto. */
export function costForSeconds(model: string, seconds: number): number | null {
  const p = priceFor(model);
  return p?.perMinute ? (seconds / 60) * p.perMinute : null;
}
