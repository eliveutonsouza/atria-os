import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { Bootstrap, ViewName, ViewParams } from '@shared/protocol'
import { api } from '../api/client'
import { connectEvents } from '../api/events'
import { sendContextDebounced } from '../lib/actions'
import { ApprovalModal, CommandPalette, HistoryDrawer, Inbox } from '../overlays/Overlays'
import { pttDown, pttUp } from '../voice/live'
import { useYui, type Mode } from '../store/yui'
import { CanvasPanel } from './CanvasPanel'
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

function useRouteSync() {
  const loc = useLocation()
  const nav = useNavigate()
  const mode = useYui((s) => s.mode)
  const view = useYui((s) => s.view)
  const params = useYui((s) => s.viewParams)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const r = parsePath(loc.pathname)
    if (r) useYui.getState().show(r.view, r.params)
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!ready) return
    const want = pathFor(mode, view, params)
    if (want !== loc.pathname) nav(want, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode, view, params])
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
    status: b.status,
    brief: b.greeting.brief,
    msg: b.greeting.msg,
    showLines: b.greeting.showBrief && !!b.greeting.brief,
    pending: b.greeting.showBrief ? { view: 'brief' } : null,
  })
  connectEvents()
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
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    s.set({ palette: !s.palette, inboxOpen: false })
    return
  }
  // Dentro do terminal, Esc e demais teclas pertencem ao programa (Claude/vim/etc.).
  if ((e.target as HTMLElement | null)?.closest?.('.yui-terminal')) return
  if (mod && e.key.toLowerCase() === 'l') {
    e.preventDefault()
    dockInput.el?.focus()
    return
  }
  if (e.key === 'Escape') {
    if (s.palette) return s.set({ palette: false })
    if (s.approvalOpen) return s.set({ approvalOpen: null })
    if (s.inboxOpen || s.histOpen) return s.set({ inboxOpen: false, histOpen: false })
    if (s.mode === 'focus') return s.set({ mode: 'canvas' })
    if (s.mode === 'canvas') return s.close()
  }
}

export function Shell() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const authed = useYui((s) => s.authed)
  const nav = useNavigate()
  useRouteSync()

  useEffect(() => {
    bootstrap().catch(() => {
      /* 401 já marca authed=false */
    })
    const onResize = () => {
      const w = window.innerWidth, h = window.innerHeight
      setSize({ w, h })
      const narrow = w < 820, short = h < 760
      const s = useYui.getState()
      if (narrow !== s.narrow || short !== s.short) s.set({ narrow, short })
    }
    onResize()
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keydown', onTerminalKey, true)
    window.addEventListener('keyup', onPttUp)
    window.addEventListener('blur', onBlur)
    return () => {
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
    <main style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'radial-gradient(120% 90% at 50% 28%, #0f1533 0%, #0a0c1d 45%, #06070d 100%)' }}>
      <OrbLayer />
      <TopBar />
      <CanvasPanel />
      <YuiCenter />
      <YuiLeft />
      <OrbButton w={size.w} h={size.h} />
      <Dock />
      <Inbox />
      <HistoryDrawer />
      <CommandPalette />
      <ApprovalModal />
    </main>
  )
}
