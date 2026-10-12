import { useCallback, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { ApiError } from '../api/client'

// Retorno das ações do painel: avisos que somem sozinhos, confirmação antes de ações perigosas e guarda de
// edição não salva. Nada falha calado, nada roda duas vezes, nada destrutivo sem perguntar.

export type ToastTone = 'ok' | 'err' | 'info'
export interface Toast { id: number; text: string; tone: ToastTone; action?: { label: string; fn: () => void } }

export interface ConfirmOpts {
  title: string
  text?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean // botão vermelho
  undoable?: boolean // ação reversível (lixeira): sem o aviso "não dá para desfazer"
  rows?: { label: string; value: string }[]
}

interface FeedbackStore {
  toasts: Toast[]
  confirm: (ConfirmOpts & { resolve: (ok: boolean) => void }) | null
}

export const useFeedback = create<FeedbackStore>(() => ({ toasts: [], confirm: null }))

let seq = 0
export function toast(text: string, tone: ToastTone = 'info', action?: Toast['action']): void {
  const id = ++seq
  useFeedback.setState((s) => ({ toasts: [...s.toasts.filter((t) => t.text !== text), { id, text, tone, action }].slice(-3) }))
  setTimeout(() => dropToast(id), tone === 'err' || action ? 7000 : 4000)
}
export function dropToast(id: number): void {
  useFeedback.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}
export const toastOk = (text: string) => toast(text, 'ok')

/** Mensagem legível de um erro de API/rede. */
export function errText(e: unknown, fallback = 'Não deu certo.'): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Sua sessão expirou. Entre de novo.'
    if (e.status >= 500 && (!e.message || /internal|bad gateway|unavailable/i.test(e.message))) return 'O servidor teve um problema. Tente de novo em instantes.'
    return e.message || fallback
  }
  if (e instanceof TypeError) return 'O Atria não respondeu. Confira a conexão e tente de novo.'
  return e instanceof Error && e.message ? e.message : fallback
}

/** Mostra o erro como aviso. `prefix` diz o que falhou ("Não consegui cancelar"). */
export function toastErr(e: unknown, prefix?: string): void {
  const msg = errText(e)
  toast(prefix ? `${prefix}: ${msg}` : msg, 'err')
}

/** Pergunta antes de uma ação. Resolve true se a pessoa confirmou. */
export function confirmAction(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    useFeedback.getState().confirm?.resolve(false)
    useFeedback.setState({ confirm: { ...opts, resolve } })
  })
}

/** Roda uma promessa mostrando sucesso/erro; devolve o resultado ou undefined se falhou. */
export async function act<T>(p: Promise<T> | (() => Promise<T>), opts: { ok?: string; error?: string } = {}): Promise<T | undefined> {
  try {
    const r = await (typeof p === 'function' ? p() : p)
    if (opts.ok) toastOk(opts.ok)
    return r
  } catch (e) {
    toastErr(e, opts.error)
    return undefined
  }
}

/**
 * Ação de botão: bloqueia o clique duplo (`busy`), pergunta antes quando `confirm` e mostra sucesso/erro.
 * `run` devolve o resultado, ou undefined se cancelou/falhou.
 */
export function useAction<A extends unknown[], T>(
  fn: (...args: A) => Promise<T> | T,
  opts: { ok?: string; error?: string; confirm?: ConfirmOpts | ((...args: A) => ConfirmOpts | null) } = {},
): { run: (...args: A) => Promise<T | undefined>; busy: boolean } {
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const fnRef = useRef(fn)
  const optsRef = useRef(opts)
  fnRef.current = fn
  optsRef.current = opts
  const mounted = useRef(true)
  useEffect(() => () => void (mounted.current = false), [])
  const run = useCallback(async (...args: A): Promise<T | undefined> => {
    if (running.current) return undefined
    const o = optsRef.current
    const c = typeof o.confirm === 'function' ? o.confirm(...args) : o.confirm
    if (c && !(await confirmAction(c))) return undefined
    running.current = true
    setBusy(true)
    try {
      const r = await fnRef.current(...args)
      if (o.ok) toastOk(o.ok)
      return r
    } catch (e) {
      toastErr(e, o.error)
      return undefined
    } finally {
      running.current = false
      if (mounted.current) setBusy(false)
    }
  }, [])
  return { run, busy }
}

/**
 * Guarda de edição não salva: avisa ao fechar/recarregar a aba e dá `confirmLeave()` para usar antes de
 * trocar de tela dentro do app (true = pode sair).
 */
export function useUnsavedGuard(dirty: boolean, what = 'as mudanças'): () => Promise<boolean> {
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  return useCallback(
    () => (dirtyRef.current
      ? confirmAction({ title: 'Sair sem salvar?', text: `Se sair agora, ${what} se perdem.`, confirmLabel: 'Sair sem salvar', cancelLabel: 'Continuar editando', danger: true, undoable: true })
      : Promise.resolve(true)),
    [what],
  )
}

/** Plural simples: plural(3, 'missão', 'missões') → "3 missões". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
