import { create } from 'zustand'
import type { AppPage, ApprovalInfo, Brief, ChatMessage, CustomViewInfo, InboxItem, MissionInfo, ProjectSummary, RunInfo, ViewName, ViewParams, WorkflowInputRequest, WorkflowRunInfo, YuiState } from '@shared/protocol'

export type Mode = 'center' | 'canvas' | 'focus'

export interface Pending {
  view: ViewName | 'approval'
  params?: ViewParams
  label?: string
  approvalId?: string
}

export interface HeaderAction {
  label: string
  fn: () => void
  primary?: boolean // celular: fica visível ao lado do título (as demais vão para o menu ⋯)
  danger?: boolean // destrutiva: vermelha e por último no menu ⋯
}

export type Device = 'phone' | 'tablet' | 'desktop'

export interface ViewHeader {
  eyebrow: string
  title: string
  actions: HeaderAction[]
  back?: () => void // celular: ‹ Voltar do detalhe para a lista
}

export interface YuiStore {
  authed: boolean | null
  userName: string
  mode: Mode
  view: ViewName
  viewParams: ViewParams
  viewNonce: number
  header: ViewHeader
  yst: YuiState
  msg: string
  showLines: boolean
  brief: Brief | null
  pending: Pending | null
  hist: ChatMessage[]
  activeProject: string | null
  unread: Record<string, number> // mensagens novas da Yui por projeto ('' = Geral) enquanto você está em outro
  projectsOpen: boolean
  runsOpen: boolean
  maxConcurrent: number
  projects: ProjectSummary[]
  agentsWorking: number
  inbox: InboxItem[]
  approvals: Record<string, ApprovalInfo>
  approvalOpen: string | null
  learningOpen: boolean // cartão "Yui aprendeu" (overlays/Learning.tsx)
  selEl: string | null
  listening: boolean
  liveMuted: boolean
  // off = sem voz; ptt = segurar espaço para falar; continuous = microfone sempre aberto
  voiceMode: 'off' | 'ptt' | 'continuous'
  missions: Record<string, MissionInfo>
  canInstall: boolean
  // v3: modo dashboard ('app') com a Yui minimizada no canto; 'yui' = conversa em tela cheia
  shellMode: 'yui' | 'app'
  appPage: AppPage
  appParams: Record<string, string>
  sidebarOpen: boolean
  sidebarPinned: boolean
  updateReady: boolean
  pushEnabled: boolean
  workflowRuns: Record<string, WorkflowRunInfo>
  // pedidos de informação dos workflows (passo "Pedir informação") e o formulário aberto
  workflowInputs: Record<string, WorkflowInputRequest>
  inputOpen: string | null
  customViews: Record<string, CustomViewInfo>
  liveConnecting: boolean
  liveTranscript: string
  narrow: boolean // = device === 'phone'
  short: boolean
  device: Device
  coarse: boolean
  keyboardOpen: boolean
  palette: boolean
  inboxOpen: boolean
  histOpen: boolean
  tech: boolean
  expandedRun: string | null
  runs: Record<string, RunInfo>
  status: { claude: boolean; openai: boolean; live: boolean }
  loadedAt: number

  set: (p: Partial<YuiStore>) => void
  show: (view: ViewName, params?: ViewParams) => void
  close: () => void
  setFocus: (on: boolean) => void
  say: (text: string, opts?: { state?: YuiState; hist?: boolean }) => void
  pushHist: (who: 'user' | 'yui', text: string) => void
  baseState: () => YuiState
  setHeader: (h: ViewHeader) => void
  upsertRun: (r: RunInfo) => void
}

let showTimer: ReturnType<typeof setTimeout> | undefined
let msgSeq = 0

export const useYui = create<YuiStore>((set, get) => ({
  authed: null,
  userName: '',
  mode: 'center',
  view: 'brief',
  viewParams: {},
  viewNonce: 0,
  header: { eyebrow: '', title: '', actions: [] },
  yst: 'idle',
  msg: '',
  showLines: false,
  brief: null,
  pending: null,
  hist: [],
  activeProject: null,
  unread: {},
  projectsOpen: false,
  runsOpen: false,
  maxConcurrent: 4,
  projects: [],
  agentsWorking: 0,
  inbox: [],
  approvals: {},
  approvalOpen: null,
  learningOpen: false,
  selEl: null,
  listening: false,
  liveMuted: false,
  voiceMode: 'off',
  missions: {},
  canInstall: false,
  shellMode: 'yui',
  appPage: 'overview',
  appParams: {},
  sidebarOpen: false,
  sidebarPinned: (() => { try { return (localStorage.getItem('atria.sidebarPinned') ?? localStorage.getItem('yui.sidebarPinned')) === '1' } catch { return false } })(),
  updateReady: false,
  pushEnabled: false,
  workflowRuns: {},
  workflowInputs: {},
  inputOpen: null,
  customViews: {},
  liveConnecting: false,
  liveTranscript: '',
  narrow: false,
  short: false,
  device: 'desktop',
  coarse: false,
  keyboardOpen: false,
  palette: false,
  inboxOpen: false,
  histOpen: false,
  tech: false,
  expandedRun: null,
  runs: {},
  status: { claude: false, openai: false, live: false },
  loadedAt: Date.now(),

  set: (p) => set(p),

  baseState: () => {
    const s = get()
    if (s.listening) return 'listening'
    const mine = Object.values(s.runs).some(
      (r) => (r.state === 'running' || r.state === 'queued') && r.startedAt && new Date(r.startedAt).getTime() >= s.loadedAt,
    )
    return mine ? 'working' : 'idle'
  },

  show: (view, params = {}) => {
    const s = get()
    const sameView = s.view === view
    set({
      view,
      viewParams: params,
      viewNonce: s.viewNonce + 1,
      mode: s.mode === 'focus' ? 'focus' : 'canvas',
      yst: 'showing',
      pending: null,
      approvalOpen: null,
      showLines: false,
      inboxOpen: false,
      palette: false,
      selEl: sameView && view === 'website' ? s.selEl : null,
      expandedRun: params.runId ?? s.expandedRun,
    })
    clearTimeout(showTimer)
    showTimer = setTimeout(() => {
      const st = get()
      if (st.yst === 'showing') set({ yst: st.baseState() })
    }, 900)
  },

  close: () => set({ mode: 'center', yst: get().baseState(), selEl: null }),

  setFocus: (on) => {
    const s = get()
    if (on) set({ mode: 'focus' })
    else if (s.mode === 'focus') set({ mode: 'canvas' })
  },

  say: (text, opts = {}) => {
    const s = get()
    set({ msg: text, showLines: false, yst: opts.state ?? s.yst })
    if (opts.hist !== false) s.pushHist('yui', text)
  },

  pushHist: (who, text) =>
    set((s) => ({
      hist: [...s.hist, { id: `local-${++msgSeq}`, who, text, at: new Date().toISOString() }].slice(-300),
    })),

  setHeader: (h) => set({ header: h }),

  upsertRun: (r) => set((s) => ({ runs: { ...s.runs, [r.id]: r } })),
}))

export const yui = () => useYui.getState()
