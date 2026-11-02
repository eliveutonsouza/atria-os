import { useSyncExternalStore } from 'react'

// Nome do assistente (padrão "Yui"), escolhido nas Configurações. Vem do servidor antes da tela abrir.
// `ai()` devolve o nome atual em qualquer lugar; ao trocar, a árvore inteira remonta (ver main.tsx).

export const DEFAULT_ASSISTANT_NAME = 'Yui'
let name = DEFAULT_ASSISTANT_NAME
const subs = new Set<() => void>()

export const ai = (): string => name

export function setAssistantName(next: unknown): void {
  const v = typeof next === 'string' && next.trim() ? next.trim() : DEFAULT_ASSISTANT_NAME
  if (v === name) return
  name = v
  subs.forEach((f) => f())
}

export function useAssistantName(): string {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => name,
  )
}

const WORD = /(?<![\p{L}\p{N}_])(Yui|YUI)(?![\p{L}\p{N}_])/gu

/** Troca "Yui"/"YUI" de um texto vindo de fora (ajuda, mensagens salvas) pelo nome atual. */
export function brand(text: string): string {
  if (name === DEFAULT_ASSISTANT_NAME) return text
  return text.replace(WORD, (_m, w: string) => (w === 'YUI' ? name.toUpperCase() : name))
}
