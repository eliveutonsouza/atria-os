import type { ServerEvent, UiAction } from '@shared/protocol'
import { useYui } from '../store/yui'
import { MOCK } from './client'

let yuiStreaming = false

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
