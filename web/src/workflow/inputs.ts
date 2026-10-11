import type { InboxItem, WorkflowInputRequest } from '@shared/protocol'
import { api } from '../api/client'
import { useYui } from '../store/yui'

// Pedidos de informação dos workflows (passo "Pedir informação"): estado ao vivo, abrir o formulário e enviar.

export const isOpenRequest = (r: WorkflowInputRequest) => r.status === 'pending' || r.status === 'processing'

// pedidos novos que chegaram pelo SSE nesta sessão (viram o aviso "Responder" no canto)
let fresh: string | null = null
const freshListeners = new Set<() => void>()
export function freshRequest(): string | null {
  return fresh
}
export function onFreshRequest(fn: () => void): () => void {
  freshListeners.add(fn)
  return () => freshListeners.delete(fn)
}
export function dismissFresh() {
  fresh = null
  for (const fn of freshListeners) fn()
}

export function onInputUpdated(r: WorkflowInputRequest) {
  const s = useYui.getState()
  const known = s.workflowInputs[r.id]
  s.set({ workflowInputs: { ...s.workflowInputs, [r.id]: r } })
  if (!known && r.status === 'pending' && s.inputOpen !== r.id) {
    fresh = r.id
    for (const fn of freshListeners) fn()
  }
  if (fresh === r.id && r.status !== 'pending') dismissFresh()
}

export async function loadInputs(): Promise<void> {
  try {
    const list = await api.get<WorkflowInputRequest[]>('/api/workflow-inputs')
    const s = useYui.getState()
    s.set({ workflowInputs: { ...s.workflowInputs, ...Object.fromEntries(list.map((r) => [r.id, r])) } })
  } catch {
    /* servidor sem a rota (versão antiga) ou offline */
  }
}

export async function fetchInput(id: string): Promise<WorkflowInputRequest | null> {
  try {
    const r = await api.get<WorkflowInputRequest>(`/api/workflow-inputs/${encodeURIComponent(id)}`)
    const s = useYui.getState()
    s.set({ workflowInputs: { ...s.workflowInputs, [r.id]: r } })
    return r
  } catch {
    return null
  }
}

/** Abre o formulário do pedido (modal no desktop, folha no celular) sobre a tela atual. */
export function openInputRequest(id: string) {
  if (fresh === id) dismissFresh()
  useYui.getState().set({ inputOpen: id, inboxOpen: false })
}

/** Pedido aberto (pendente ou processando) de uma execução de workflow, se houver. */
export function requestForRun(runId: string | null | undefined): WorkflowInputRequest | null {
  if (!runId) return null
  const all = Object.values(useYui.getState().workflowInputs).filter((r) => r.runId === runId)
  return all.find((r) => r.status === 'pending') ?? all.find((r) => r.status === 'processing') ?? null
}

export async function remindInput(id: string): Promise<void> {
  await api.post(`/api/workflow-inputs/${encodeURIComponent(id)}/remind`)
}

export class InputSendError extends Error {
  missing: string[]
  constructor(message: string, missing: string[] = []) {
    super(message)
    this.missing = missing
  }
}

// Envio multipart com progresso (mesmo padrão de company/api.ts: fetch não informa progresso de envio).
// answers = valores não-arquivo; arquivos vão com o fieldname = key do campo.
export function submitInput(id: string, answers: Record<string, unknown>, files: Record<string, File[]>, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    fd.append('answers', JSON.stringify(answers))
    for (const [key, list] of Object.entries(files)) for (const f of list) fd.append(key, f, f.name)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/workflow-inputs/${encodeURIComponent(id)}`)
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status === 401) {
        useYui.getState().set({ authed: false })
        return reject(new InputSendError('sessão expirada'))
      }
      let body: { error?: string; missing?: string[] } | null = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* corpo vazio */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else if (xhr.status === 409) reject(new InputSendError(body?.error ?? 'este pedido já foi respondido'))
      else reject(new InputSendError(body?.error ?? `falha no envio (${xhr.status})`, body?.missing ?? []))
    }
    xhr.onerror = () => reject(new InputSendError('falha de rede no envio'))
    xhr.send(fd)
  })
}

/** Data local de hoje (AAAA-MM-DD) e hora agora (HH:MM). */
export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function nowTime(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const FIELD_KIND_LABEL: Record<WorkflowInputRequest['fields'][number]['kind'], string> = {
  text: 'Texto',
  longtext: 'Texto longo',
  date: 'Data',
  time: 'Hora',
  number: 'Número',
  boolean: 'Sim/não',
  choice: 'Escolha',
  audio: 'Áudio',
  images: 'Imagens',
  files: 'Arquivos',
}

/** Abre um item do Inbox do tipo view; pedidos de informação abrem a execução com o formulário por cima. */
export function openInboxView(ib: InboxItem) {
  if (ib.action.type !== 'view') return
  const s = useYui.getState()
  // cartão diário do aprendizado abre o modal de escolha (overlays/Learning.tsx), não uma tela
  if (ib.id.startsWith('learn:')) return s.set({ learningOpen: true, inboxOpen: false })
  const p = ib.action.params ?? {}
  s.show(ib.action.view, p)
  const byId = /^input:(.+)$/.exec(ib.id)?.[1]
  const req = (byId && s.workflowInputs[byId]) || (ib.action.view === 'workflow' ? requestForRun(p.workflowRunId) : null)
  if (req && isOpenRequest(req)) openInputRequest(req.id)
  else if (byId) void fetchInput(byId).then((r) => r && isOpenRequest(r) && openInputRequest(r.id))
}
