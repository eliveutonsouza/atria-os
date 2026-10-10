import type { BrowserChallengeState, ServerEvent, UiAction } from '@shared/protocol'
import { dropMission } from '../lib/actions'
import { useYui } from '../store/yui'
import { onInputUpdated } from '../workflow/inputs'
import { MOCK } from './client'

let yuiStreaming = false

// Vault: páginas (Vault, Cérebro) assinam mudanças de notas para atualizar ao vivo.
type VaultListener = (paths: string[], at: number) => void
const vaultListeners = new Set<VaultListener>()
// Empresa: páginas assinam documentos e perfil para atualizar ao vivo.
type CompanyEvent = Extract<ServerEvent, { type: 'company.doc.updated' | 'company.doc.deleted' | 'company.profile.updated' }>
const companyListeners = new Set<(ev: CompanyEvent) => void>()
export function onCompanyEvent(fn: (ev: CompanyEvent) => void): () => void {
  companyListeners.add(fn)
  return () => companyListeners.delete(fn)
}

// Suporte remoto, avisos e atualização: a faixa do topo e Configurações releem ao receber.
const supportListeners = new Set<() => void>()
export function onSupportUpdated(fn: () => void): () => void {
  supportListeners.add(fn)
  return () => supportListeners.delete(fn)
}

// Verificação humana no navegador dos agentes: a página Navegador mostra a faixa "resolva aqui".
type ChallengeListener = (st: BrowserChallengeState) => void
const challengeListeners = new Set<ChallengeListener>()
export function onBrowserChallenge(fn: ChallengeListener): () => void {
  challengeListeners.add(fn)
  return () => challengeListeners.delete(fn)
}

export function onVaultChanged(fn: VaultListener): () => void {
  vaultListeners.add(fn)
  return () => vaultListeners.delete(fn)
}

export function applyUiAction(a: UiAction) {
  const s = useYui.getState()
  switch (a.type) {
    case 'show_view':
      s.show(a.view, a.params ?? {})
      break
    case 'close_canvas':
      s.close()
      break
    case 'set_focus':
      if (a.on && s.mode === 'center') s.show(s.view, s.viewParams)
      useYui.getState().setFocus(a.on)
      break
    case 'suggest_view':
      s.set({ pending: { view: a.view, params: a.params, label: a.label } })
      break
    case 'switch_project':
      s.set({ activeProject: a.project })
      break
    case 'open_approval':
      if (s.approvals[a.approvalId]) s.set({ approvalOpen: a.approvalId, inboxOpen: false, yst: 'warning' })
      else s.set({ pending: { view: 'approval', approvalId: a.approvalId, label: 'Revisar aprovação' } })
      break
  }
}

export function applyEvent(ev: ServerEvent) {
  const s = useYui.getState()
  switch (ev.type) {
    case 'yui.state':
      s.set({ yst: ev.state })
      break
    case 'yui.say':
      if (ev.final) {
        yuiStreaming = false
        s.set({ msg: ev.text, showLines: false })
        s.pushHist('yui', ev.text)
      } else {
        // streaming parcial: msg cresce no centro, histórico só no final
        if (!yuiStreaming) s.set({ yst: s.yst === 'thinking' || s.yst === 'idle' || s.yst === 'listening' ? 'speaking' : s.yst })
        yuiStreaming = true
        s.set({ msg: ev.text, showLines: false })
      }
      break
    case 'user.said':
      if (ev.final) {
        s.set({ liveTranscript: '' })
        s.pushHist('user', ev.text)
      } else {
        s.set({ liveTranscript: ev.text })
      }
      break
    case 'ui.action':
      applyUiAction(ev.action)
      break
    case 'mission.updated':
      s.set({ missions: { ...s.missions, [ev.mission.id]: ev.mission } })
      break
    case 'mission.deleted':
      dropMission(ev.missionId)
      break
    case 'workflow.deleted':
      if (s.view === 'workflow' && s.viewParams.workflowId === ev.slug) s.show('workflows')
      break
    case 'workflow.run.updated':
      s.set({ workflowRuns: { ...s.workflowRuns, [ev.run.id]: ev.run } })
      break
    case 'workflow.input.updated':
      onInputUpdated(ev.request)
      break
    case 'custom.created':
      s.set({ customViews: { ...s.customViews, [ev.view.id]: ev.view } })
      break
    case 'run.updated':
      s.upsertRun(ev.run)
      break
    case 'agents.updated':
      s.set({ agentsWorking: ev.agentsWorking })
      break
    case 'approval.requested':
      s.set({ approvals: { ...s.approvals, [ev.approval.id]: ev.approval } })
      break
    case 'approval.resolved': {
      const rest = { ...s.approvals }
      delete rest[ev.approvalId]
      s.set({
        approvals: rest,
        approvalOpen: s.approvalOpen === ev.approvalId ? null : s.approvalOpen,
        pending: s.pending?.approvalId === ev.approvalId ? null : s.pending,
      })
      break
    }
    case 'inbox.updated':
      s.set({ inbox: ev.inbox })
      break
    case 'artifact.created':
      break
    case 'live.status':
      s.set({ listening: ev.active, liveMuted: ev.muted, status: { ...s.status, live: ev.active } })
      if (!ev.active && (s.yst === 'listening' || s.yst === 'speaking')) s.set({ yst: useYui.getState().baseState() })
      break
    case 'company.doc.updated':
    case 'company.doc.deleted':
    case 'company.profile.updated':
      for (const fn of companyListeners) fn(ev)
      break
    case 'vault.changed':
      for (const fn of vaultListeners) fn(ev.paths, ev.at)
      break
    case 'support.updated':
      for (const fn of supportListeners) fn()
      break
    case 'browser.challenge': {
      const { type: _type, ...st } = ev
      for (const fn of challengeListeners) fn(st)
      break
    }
    case 'ping':
      break
  }
}

let es: EventSource | null = null
let retry = 0

export function connectEvents() {
  if (MOCK || es) return
  es = new EventSource('/api/events', { withCredentials: true })
  es.onopen = () => {
    retry = 0
  }
  es.onmessage = (m) => {
    try {
      applyEvent(JSON.parse(m.data) as ServerEvent)
    } catch (e) {
      console.warn('yui event', e)
    }
  }
  es.onerror = () => {
    es?.close()
    es = null
    if (useYui.getState().authed === false) return
    retry = Math.min(retry + 1, 6)
    setTimeout(connectEvents, 500 * 2 ** retry)
  }
}

export function disconnectEvents() {
  es?.close()
  es = null
}
