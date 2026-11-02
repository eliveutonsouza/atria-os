// Personalidade da Yui na voz (ao vivo e Telegram falado). Funções puras: sem banco nem rede.
// No padrão nada é acrescentado aos prompts, então o comportamento de antes não muda.

export const WARMTH = ['atual', 'acolhedora', 'expressiva'] as const;
export const HUMOR = ['atual', 'leve', 'descontraida'] as const;
export const LENGTH = ['curtas', 'naturais'] as const;

export interface Persona {
  warmth: (typeof WARMTH)[number];
  humor: (typeof HUMOR)[number];
  length: (typeof LENGTH)[number];
  pace: number; // 0.8–1.3; 1 = como hoje
  reactions: boolean;
}

export const PERSONA_DEFAULT: Persona = { warmth: 'atual', humor: 'atual', length: 'curtas', pace: 1, reactions: false };

/** Texto original do áudio do Telegram (telegramChat.ts); o padrão tem de continuar idêntico a ele. */
export const TTS_BASE = 'Fale em português do Brasil, calma e calorosa, ritmo natural.';

const pick = <T extends string>(list: readonly T[], v: unknown, def: T): T => (list.includes(v as T) ? (v as T) : def);

/** Valores soltos (banco/.env) -> Persona válida; o que for inválido volta ao padrão. */
export function normalizePersona(raw: Partial<Record<keyof Persona, unknown>>): Persona {
  const pace = Number(raw.pace);
  return {
    warmth: pick(WARMTH, raw.warmth, 'atual'),
    humor: pick(HUMOR, raw.humor, 'atual'),
    length: pick(LENGTH, raw.length, 'curtas'),
    pace: Number.isFinite(pace) && pace >= 0.8 && pace <= 1.3 ? pace : 1,
    reactions: raw.reactions === true || raw.reactions === 'true',
  };
}

export const isDefaultPersona = (p: Persona) =>
  p.warmth === 'atual' && p.humor === 'atual' && p.length === 'curtas' && Math.abs(p.pace - 1) < 0.03 && !p.reactions;

const WARMTH_LIVE = {
  acolhedora:
    'Tom: acolhedora e empática. Antes de resolver, reconheça como o usuário parece estar (frustração, cansaço, alegria) com uma frase curta e sincera. Voz suave e próxima.',
  expressiva:
    'Tom: expressiva e viva. Varie a entonação e mostre emoção real (alegria, preocupação, surpresa) na voz e nas palavras, sem exagero teatral.',
};
const HUMOR_LIVE = {
  leve: 'Humor: use humor leve e raro, só quando o momento for leve. Nunca brinque com erro, falha ou assunto sério.',
  descontraida: 'Humor: fale de forma informal e descontraída, como uma amiga próxima; pode brincar quando o clima permitir. Em assunto sério, fique séria.',
};

function paceLine(pace: number): string {
  if (Math.abs(pace - 1) < 0.03) return '';
  if (pace < 1) return pace <= 0.9 ? 'Ritmo: fale bem mais devagar, com pausas curtas entre as ideias.' : 'Ritmo: fale um pouco mais devagar.';
  return pace >= 1.15 ? 'Ritmo: fale bem mais rápido e direto.' : 'Ritmo: fale um pouco mais rápido.';
}

/** Linhas de ajuste da voz ao vivo. Vazio no padrão. */
function liveLines(p: Persona): string[] {
  const out: string[] = [];
  if (p.warmth !== 'atual') out.push(WARMTH_LIVE[p.warmth]);
  if (p.humor !== 'atual') out.push(HUMOR_LIVE[p.humor]);
  if (p.length === 'naturais') out.push('Tamanho: responda com 2 a 4 frases, em conversa natural, em vez de só o mínimo. Continue sem listas longas.');
  const pace = paceLine(p.pace);
  if (pace) out.push(pace);
  if (p.reactions)
    out.push(
      'Reações: depois que o usuário terminar de falar, pode reagir de forma natural e curta ("hmm", "nossa", "ah", rir junto) ao que ele contou. Enquanto ele fala, continue em silêncio.',
    );
  return out;
}

/** Bloco acrescentado ao prompt da voz ao vivo. String vazia no padrão (prompt idêntico ao de antes). */
export function personaBlock(p: Persona): string {
  const lines = liveLines(p);
  if (!lines.length) return '';
  return `\n\nAjustes de personalidade escolhidos pelo usuário (valem sobre "frases curtas" e o tom acima quando divergirem):\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

/** Instrução do áudio do Telegram (gpt-4o-mini-tts). Igual a TTS_BASE no padrão. */
export function ttsInstructions(p: Persona): string {
  const extra: string[] = [];
  if (p.warmth === 'acolhedora') extra.push('Tom acolhedor e empático, voz suave e próxima.');
  if (p.warmth === 'expressiva') extra.push('Tom expressivo e vivo, com entonação variada e emoção real, sem exagero.');
  if (p.humor === 'leve') extra.push('Leve bom humor quando o texto for leve.');
  if (p.humor === 'descontraida') extra.push('Jeito informal e descontraído, de amiga próxima, quando o texto permitir.');
  const pace = paceLine(p.pace);
  if (pace) extra.push(pace.replace('Ritmo: fale', 'Fale').replace(/\.$/, '.'));
  return extra.length ? `${TTS_BASE} ${extra.join(' ')}` : TTS_BASE;
}
