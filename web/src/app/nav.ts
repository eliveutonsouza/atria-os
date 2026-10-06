import type { AppPage, ViewName, ViewParams } from '@shared/protocol'
import { useYui } from '../store/yui'

// Navegação entre o modo Yui (conversa em tela cheia) e o modo app (dashboard com a Yui minimizada).

export function enterApp(page: AppPage = 'overview', params: Record<string, string> = {}, viewParams?: ViewParams) {
  const s = useYui.getState()
  s.set({
    shellMode: 'app',
    appPage: page,
    appParams: params,
    // Canvas do modo Yui fecha: as views são reaproveitadas dentro das páginas
    mode: 'center',
    viewNonce: 0,
    ...(viewParams ? { viewParams } : {}),
    palette: false,
    inboxOpen: false,
    histOpen: false,
    sidebarOpen: s.sidebarPinned && s.device === 'desktop' ? s.sidebarOpen : false,
  })
}

export function exitApp() {
  useYui.getState().set({ shellMode: 'yui', mode: 'center', viewNonce: 0, sidebarOpen: false })
}

export function toggleApp() {
  if (useYui.getState().shellMode === 'app') exitApp()
  else enterApp(useYui.getState().appPage)
}

// view do modo Yui → página do dashboard (quando existe). null = continua no Canvas da Yui.
export function pageForView(view: ViewName, p: ViewParams): { page: AppPage; params: Record<string, string> } | null {
  const id = (v: string | undefined | null): Record<string, string> => (v ? { id: v } : {})
  switch (view) {
    case 'agents': return { page: 'agents', params: {} }
    case 'agent': return { page: 'agents', params: id(p.agentId) }
    case 'runs': return { page: 'runs', params: id(p.runId) }
    case 'mission': return { page: 'missions', params: id(p.missionId) }
    case 'workflows': return { page: 'workflows', params: {} }
    case 'workflow': return { page: 'workflows', params: { id: p.workflowId ?? 'new' } }
    case 'routines': return { page: 'schedule', params: {} }
    case 'tools': return { page: 'tools', params: id(p.tab) }
    case 'terminal': return { page: 'terminal', params: {} }
    case 'infra': return { page: 'infra', params: {} }
    case 'logs': return { page: 'infra', params: id(p.project) }
    case 'dashboard':
    case 'brief': return { page: 'overview', params: {} }
    case 'project': return { page: 'projects', params: id(p.project) }
    case 'claude': return { page: 'claude', params: {} }
    case 'vault': return { page: 'vault', params: id(p.note) }
    case 'brain': return { page: 'brain', params: id(p.note) }
    case 'company': return { page: 'company', params: id(p.tab) }
    case 'help': return { page: 'help', params: id(p.tab) }
    default: return null
  }
}

// Com a Yui minimizada, `show(view)` (vindo da Yui, de um botão ou do ⌘K) abre a página equivalente;
// o que não tem página (site, relatório, tela sob medida…) volta para a Yui com o Canvas.
let lastNonce = useYui.getState().viewNonce
useYui.subscribe((s) => {
  if (s.viewNonce === lastNonce) return
  lastNonce = s.viewNonce
  if (s.viewNonce === 0) return
  // Vault, Cérebro e Empresa só existem como páginas do dashboard: no modo Yui, abrem o dashboard
  if (s.shellMode !== 'app' && (s.view === 'vault' || s.view === 'brain' || s.view === 'company' || s.view === 'help')) {
    lastNonce = 0
    const t = pageForView(s.view, s.viewParams)
    if (t) enterApp(t.page, t.params)
    return
  }
  if (s.shellMode !== 'app') return
  const target = pageForView(s.view, s.viewParams)
  if (target) {
    lastNonce = 0
    s.set({ appPage: target.page, appParams: target.params, mode: 'center', viewNonce: 0 })
  } else {
    s.set({ shellMode: 'yui', sidebarOpen: false })
  }
})

/** Repassa parâmetros da página para as views reaproveitadas (que leem `viewParams`). */
export function syncViewParams(p: ViewParams) {
  const cur = useYui.getState().viewParams
  const same = Object.keys({ ...cur, ...p }).every((k) => (cur as Record<string, unknown>)[k] === (p as Record<string, unknown>)[k])
  if (!same) useYui.getState().set({ viewParams: p })
}
