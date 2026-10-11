import { trackDevice } from '../lib/device'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { Bootstrap, ViewName, ViewParams } from '@shared/protocol'
import { api } from '../api/client'
import { connectEvents } from '../api/events'
import { InputFormHost, InputToast } from '../workflow/InputForm'
import { loadInputs } from '../workflow/inputs'
import { sendContextDebounced } from '../lib/actions'
import { ApprovalModal, CommandPalette, HistoryDrawer, Inbox, UpdateToast } from '../overlays/Overlays'
import { LearningModal } from '../overlays/Learning'
import { pttDown, pttUp, toggleLive } from '../voice/live'
import { AppShell } from '../app/AppShell'
import { toggleApp } from '../app/nav'
import type { AppPage } from '@shared/protocol'
import { useYui, type Mode } from '../store/yui'
import { CanvasPanel } from './CanvasPanel'
import { RunsPopover } from './ProjectPicker'
import { SupportBanners } from './SupportBanners'
import { Dock, dockInput, OrbButton, OrbLayer, TopBar, YuiCenter, YuiLeft } from './parts'

// ---------- rotas espelho (§80) ----------
function pathFor(mode: Mode, view: ViewName, p: ViewParams): string {
  if (mode === 'center') return '/'
  switch (view) {
    case 'agents': return '/agents'
    case 'runs': return p.runId ? `/runs/${p.runId}` : '/runs'
    case 'project': return p.project ? `/projects/${p.project}` : '/projects'
    case 'logs': return p.project ? `/logs/${p.project}` : '/logs'
    case 'report': return '/report'
    case 'infra': return '/infra'
    case 'artifact': return '/artifacts'
    case 'terminal': return p.kind === 'shell' ? '/terminal/shell' : '/terminal'
    case 'mission': return p.missionId ? `/missions/${p.missionId}` : '/runs'
    case 'custom': return p.customId ? `/views/${p.customId}` : '/'
    case 'tools': return p.tab ? `/tools/${p.tab}` : '/tools'
    case 'agent': return p.agentId ? `/agents/${p.agentId}` : '/agents'
    case 'workflow': return p.workflowId ? `/workflows/${p.workflowId}` : '/workflows/new'
    case 'workflows': return '/workflows'
    case 'routines': return '/routines'
    case 'claude': return '/claude'
    case 'website': return p.artifactId ? `/website/${p.artifactId}` : p.project ? `/website/p/${p.project}` : '/website'
    case 'brief': return '/brief'
    case 'dashboard': return '/dashboard'
  }
  return '/'
}

function parsePath(path: string): { view: ViewName; params: ViewParams } | null {
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent)
  if (!seg.length) return null
  const [a, b, c] = seg
  switch (a) {
    case 'agents': return b ? { view: 'agent', params: { agentId: b } } : { view: 'agents', params: {} }
    case 'runs': return { view: 'runs', params: b ? { runId: b } : {} }
    case 'projects': return { view: b ? 'project' : 'dashboard', params: b ? { project: b } : {} }
    case 'logs': return { view: 'logs', params: b ? { project: b } : {} }
    case 'report': return { view: 'report', params: {} }
    case 'infra': return { view: 'infra', params: {} }
    case 'artifacts': return { view: 'artifact', params: {} }
    case 'terminal': return { view: 'terminal', params: b === 'shell' ? { kind: 'shell' } : {} }
    case 'missions': return b ? { view: 'mission', params: { missionId: b } } : { view: 'runs', params: {} }
    case 'views': return b ? { view: 'custom', params: { customId: b } } : null
    case 'tools': return { view: 'tools', params: b ? { tab: b } : {} }
    case 'workflows': return b ? { view: 'workflow', params: b === 'new' ? {} : { workflowId: b } } : { view: 'workflows', params: {} }
    case 'routines': return { view: 'routines', params: {} }
    case 'claude': return { view: 'claude', params: {} }
    case 'website': return { view: 'website', params: b === 'p' ? { project: c } : b ? { artifactId: b } : {} }
    case 'brief': return { view: 'brief', params: {} }
    case 'dashboard': return { view: 'dashboard', params: {} }
    case 'chat': return null
  }
  return null
}

// /app/<página>/<id?>/<sub?> = dashboard (Yui minimizada); demais rotas = modo Yui.
// sub: segundo nível de detalhe (/app/workflows/pedido/<id> = formulário de um pedido de informação).
const APP_PAGES = new Set(['overview', 'ops', 'agents', 'runs', 'missions', 'workflows', 'schedule', 'projects', 'browser', 'terminal', 'claude', 'tools', 'inbox', 'infra', 'settings', 'vault', 'brain', 'company', 'help', 'more', 'usage', 'reminders', 'skills', 'artifacts'])
function appPathFor(page: string, p: Record<string, string>) {
  const base = page === 'overview' ? '/app' : `/app/${page}`
  if (!p.id) return base
  return p.sub ? `${base}/${encodeURIComponent(p.id)}/${encodeURIComponent(p.sub)}` : `${base}/${encodeURIComponent(p.id)}`
}
function applyPath(path: string) {
  const s = useYui.getState()
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent)
  if (seg[0] === 'app') {
    const page = seg[1] && APP_PAGES.has(seg[1]) ? seg[1] : 'overview'
    s.set({ shellMode: 'app', appPage: page as AppPage, appParams: seg[2] ? { id: seg[2], ...(seg[3] ? { sub: seg[3] } : {}) } : {} })
    return
  }
  if (s.shellMode === 'app') s.set({ shellMode: 'yui' })
  const r = parsePath(path)
  if (r) s.show(r.view, r.params)
  else if (path === '/' && s.mode !== 'center') s.close()
}

function useRouteSync() {
  const loc = useLocation()
  const nav = useNavigate()
  const mode = useYui((s) => s.mode)
  const view = useYui((s) => s.view)
  const params = useYui((s) => s.viewParams)
  const shellMode = useYui((s) => s.shellMode)
  const appPage = useYui((s) => s.appPage)
  const appParams = useYui((s) => s.appParams)
  const [ready, setReady] = useState(false)
  const lastWanted = useRef<string | null>(null)
  useEffect(() => {
    applyPath(loc.pathname)
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // navegação externa (voltar do navegador, clique em notificação) → aplica no estado
  useEffect(() => {
    if (ready && lastWanted.current !== null && loc.pathname !== lastWanted.current) applyPath(loc.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname])
  useEffect(() => {
    if (!ready) return
    const want = shellMode === 'app' ? appPathFor(appPage, appParams) : pathFor(mode, view, params)
    lastWanted.current = want
    if (want !== loc.pathname) nav(want, { replace: shellMode !== 'app' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode, view, params, shellMode, appPage, appParams])
}

// ---------- bootstrap ----------
async function bootstrap() {
  const b = await api.get<Bootstrap>('/api/bootstrap')
  const s = useYui.getState()
  s.set({
    authed: true,
    userName: b.user.name,
    activeProject: b.activeProject,
    projects: b.projects,
    agentsWorking: b.agentsWorking,
    inbox: b.inbox,
    hist: b.history,
    maxConcurrent: b.maxConcurrent ?? 4,
    unread: b.unread ?? {},
    status: b.status,
    brief: b.greeting.brief,
    msg: b.greeting.msg,
    showLines: b.greeting.showBrief && !!b.greeting.brief,
    pending: b.greeting.showBrief ? { view: 'brief' } : null,
  })
  connectEvents()
  void loadInputs()
  // atalho do app instalado: "Falar com a Yui" já abre a conversa por voz
  const qs = new URLSearchParams(location.search)
  if (qs.get('voice') === '1') {
    history.replaceState({}, '', location.pathname)
    setTimeout(() => toggleLive(), 400)
  }
}

// ---------- push-to-talk (Espaço) ----------
// Segurar Espaço = falar; 3 toques rápidos = conversa contínua. Não rouba o Espaço de quem está digitando:
// só vale fora de campos de texto, ou no campo da Yui quando ele está vazio.
let pttHeld = false
function pttTarget(e: KeyboardEvent): boolean {
  if (e.code !== 'Space' || e.metaKey || e.ctrlKey || e.altKey) return false
  const el = e.target as HTMLElement | null
  if (!el) return true
  if (el === dockInput.el) return !(el as HTMLInputElement).value
  if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName)) return false
  const s = useYui.getState()
  return !s.palette && !s.approvalOpen
}
function onPttDown(e: KeyboardEvent) {
  if (!pttTarget(e)) return
  e.preventDefault()
  if (e.repeat || pttHeld) return
  pttHeld = true
  pttDown()
}
function onPttUp(e: KeyboardEvent) {
  if (e.code !== 'Space' || !pttHeld) return
  e.preventDefault()
  pttHeld = false
  pttUp()
}
function onBlur() {
  if (pttHeld) {
    pttHeld = false
    pttUp()
  }
}

// Ctrl/⌘+` alterna o terminal. Em captura: o xterm consome as teclas antes do listener normal.
function onTerminalKey(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || (e.key !== '`' && e.code !== 'Backquote')) return
  e.preventDefault()
  e.stopPropagation()
  const s = useYui.getState()
  if (s.view === 'terminal' && s.mode !== 'center') s.close()
  else s.show('terminal')
}

// ---------- teclado (cascata do design) ----------
function onKey(e: KeyboardEvent) {
  onPttDown(e)
  const s = useYui.getState()
  const mod = e.metaKey || e.ctrlKey
  // Ctrl/⌘+J: alterna entre conversar com a Yui (tela cheia) e o dashboard
  if (mod && e.key.toLowerCase() === 'j') {
    e.preventDefault()
    toggleApp()
    return
  }
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    s.set({ palette: !s.palette, inboxOpen: false })
    return
  }
  // Ctrl/⌘+P na tela da Yui: trocar de projeto
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'p' && s.shellMode === 'yui') {
    e.preventDefault()
    s.set({ projectsOpen: !s.projectsOpen, runsOpen: false, inboxOpen: false, palette: false })
    return
  }
  // Dentro do terminal, Esc e demais teclas pertencem ao programa (Claude/vim/etc.).
  if ((e.target as HTMLElement | null)?.closest?.('.atria-terminal')) return
  if (mod && e.key.toLowerCase() === 'l') {
    e.preventDefault()
    dockInput.el?.focus()
    return
  }
  if (e.key === 'Escape') {
    if (s.palette) return s.set({ palette: false })
    if (s.approvalOpen) return s.set({ approvalOpen: null })
    if (s.learningOpen) return s.set({ learningOpen: false })
    if (s.inboxOpen || s.histOpen || s.runsOpen || s.projectsOpen) return s.set({ inboxOpen: false, histOpen: false, runsOpen: false, projectsOpen: false })
    if (s.mode === 'focus') return s.set({ mode: 'canvas' })
    if (s.mode === 'canvas') return s.close()
  }
}

export function Shell() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const authed = useYui((s) => s.authed)
  const [bannerH, setBannerH] = useState(0) // faixas de suporte/aviso empurram o app para baixo
  const nav = useNavigate()
  useRouteSync()

  useEffect(() => {
    bootstrap().catch(() => {
      /* 401 já marca authed=false */
    })
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    onResize()
    const untrack = trackDevice()
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keydown', onTerminalKey, true)
    window.addEventListener('keyup', onPttUp)
    window.addEventListener('blur', onBlur)
    return () => {
      untrack()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', onTerminalKey, true)
      window.removeEventListener('keyup', onPttUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(() => {
    if (authed === false) nav('/login', { replace: true })
  }, [authed, nav])

  // contexto de UI para a Yui (§44/§79)
  useEffect(
    () =>
      useYui.subscribe((st, prev) => {
        if (st.view !== prev.view || st.viewParams !== prev.viewParams || st.selEl !== prev.selEl || st.mode !== prev.mode) sendContextDebounced()
      }),
    [],
  )

  return (
    <>
      <SupportBanners onHeight={setBannerH} />
      <main style={{ position: 'fixed', inset: 0, top: bannerH, overflow: 'clip', overscrollBehavior: 'none', background: 'radial-gradient(120% 90% at 50% 28%, #0f1533 0%, #0a0c1d 45%, #06070d 100%)' }}>
        <OrbLayer />
        <TopBar />
        <AppShell />
        <CanvasPanel />
        <YuiCenter />
        <YuiLeft />
        <OrbButton w={size.w} h={size.h} />
        <Dock />
        <Inbox />
        <RunsPopover />
        <HistoryDrawer />
        <CommandPalette />
        <ApprovalModal />
        <LearningModal />
        <InputFormHost />
        <InputToast />
        <UpdateToast />
      </main>
    </>
  )
}
