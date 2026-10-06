import type { ChatContext, RunInfo } from '@shared/protocol'
import { api } from '../api/client'
import { useYui } from '../store/yui'

export function currentContext(): ChatContext {
  const s = useYui.getState()
  return {
    view: s.mode === 'center' ? null : s.view,
    params: s.viewParams,
    selectedElement: s.selEl,
    mode: s.mode,
  }
}

const CLOSE_RE = /^\s*(volta|voltar|fecha|fechar|sair)\b/
const FOCUS_RE = /tela cheia|maximiz/

export function submitText(raw: string) {
  const text = raw.trim()
  if (!text) return
  const s = useYui.getState()
  s.pushHist('user', text)
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  // respostas locais imediatas (o servidor também recebe e pode complementar)
  if (CLOSE_RE.test(t) && s.mode !== 'center') s.close()
  else if (FOCUS_RE.test(t) && s.mode !== 'center') s.setFocus(true)
  s.set({ yst: 'thinking', showLines: false })
  api.post('/api/chat', { text, context: currentContext() }).catch(() => {
    useYui.getState().say('Perdi a conexão com o servidor. Tente de novo em instantes.', { state: 'warning' })
  })
}

let ctxTimer: ReturnType<typeof setTimeout> | undefined
let lastCtx = ''
export function sendContextDebounced() {
  clearTimeout(ctxTimer)
  ctxTimer = setTimeout(() => {
    const ctx = currentContext()
    const key = JSON.stringify(ctx)
    if (key === lastCtx) return
    lastCtx = key
    api.post('/api/context', ctx).catch(() => {})
  }, 400)
}

export async function resolveApproval(id: string, approve: boolean) {
  const s = useYui.getState()
  s.set({ approvalOpen: null })
  try {
    await api.post(`/api/approvals/${id}`, { approve })
  } catch {
    s.say('Não consegui registrar a decisão. Tente de novo.', { state: 'warning' })
  }
}

export async function startRun(agentId: string, project: string | null, instruction: string) {
  const s = useYui.getState()
  s.set({ yst: 'delegating' })
  try {
    const run = await api.post<RunInfo>('/api/runs', { agentId, project, instruction })
    if (run) {
      useYui.getState().upsertRun(run)
      useYui.getState().show('runs', { runId: run.id })
    }
  } catch {
    s.say('Não consegui acordar o agente agora.', { state: 'warning' })
  }
}

/** Tira a missão do estado local e fecha o que estiver aberto nela (também usado pelo evento mission.deleted). */
export function dropMission(id: string) {
  const s = useYui.getState()
  const rest = { ...s.missions }
  delete rest[id]
  s.set({ missions: rest })
  if (s.appPage === 'missions' && s.appParams.id === id) s.set({ appParams: {} })
  if (s.view === 'mission' && s.viewParams.missionId === id) s.show('mission', {})
}
