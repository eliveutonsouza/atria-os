// Nome do assistente (padrão "Yui"). O usuário pode trocar nas Configurações.
// Funções puras: sem banco nem rede. O nome entra em prompts, então só aceita letras, números, espaço e . _ ' - (uma linha).

export const DEFAULT_ASSISTANT_NAME = 'Yui';
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._'’-]{0,29}$/u;

export const validAssistantName = (s: string): boolean => NAME_RE.test(s);

/** Texto solto (banco/.env) -> nome válido; vazio ou inválido volta ao padrão. */
export function normalizeAssistantName(raw: unknown): string {
  const s = String(raw ?? '').trim().replace(/ {2,}/g, ' ');
  return validAssistantName(s) ? s : DEFAULT_ASSISTANT_NAME;
}

const WORD = /(?<![\p{L}\p{N}_])(Yui|YUI)(?![\p{L}\p{N}_])/gu;

/** Troca as palavras "Yui" e "YUI" do texto pelo nome atual (textos de ajuda, manifesto etc.). */
export function brand(text: string, name: string): string {
  if (name === DEFAULT_ASSISTANT_NAME) return text;
  return text.replace(WORD, (_m, w: string) => (w === 'YUI' ? name.toUpperCase() : name));
}
