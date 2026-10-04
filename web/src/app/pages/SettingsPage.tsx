import type { ReactNode } from 'react'
import { C } from '../../lib/colors'
import { useYui } from '../../store/yui'
import { useHeader } from '../../views/ui'
import {
  AccountSection,
  AgentsApprovalsSection,
  ConnectionsSection,
  ModelsSection,
  NotificationsSection,
  SetupSteps,
  SystemSection,
  VoiceSection,
} from './settings/sections'

// Configurações (Settings.dc.html): menu de seções à esquerda, conteúdo à direita.
// A seção ativa mora na URL: /app/settings/<seção>.

const TABS = [
  { id: 'start', label: 'Primeiros passos' },
  { id: 'account', label: 'Conta' },
  { id: 'connections', label: 'Conexões' },
  { id: 'voice', label: 'Yui & voz' },
  { id: 'models', label: 'Modelos' },
  { id: 'agents', label: 'Agentes & aprovações' },
  { id: 'notifications', label: 'Notificações' },
  { id: 'system', label: 'Sistema' },
] as const
type TabId = (typeof TABS)[number]['id']

export function SettingsPage() {
  const raw = useYui((s) => s.appParams.id)
  const tab: TabId = (TABS.find((t) => t.id === raw)?.id ?? 'start') as TabId
  const go = (id: TabId) => useYui.getState().set({ appParams: { id } })
  useHeader('Configurações', TABS.find((t) => t.id === tab)!.label, [], [tab])

  let body: ReactNode
  switch (tab) {
    case 'account': body = <AccountSection />; break
    case 'connections': body = <ConnectionsSection />; break
    case 'voice': body = <VoiceSection />; break
    case 'models': body = <ModelsSection />; break
    case 'agents': body = <AgentsApprovalsSection />; break
    case 'notifications': body = <NotificationsSection />; break
    case 'system': body = <SystemSection />; break
    default: body = <SetupSteps onGo={go} />
  }

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', minHeight: 0 }}>
      <nav aria-label="Seções das configurações" style={{ flex: '0 1 210px', minWidth: 180, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {TABS.map((t) => {
          const on = t.id === tab
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.id)}
              aria-current={on ? 'page' : undefined}
              style={{ height: 38, padding: '0 12px', borderRadius: 10, border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 13.5, fontFamily: 'inherit', color: on ? C.text : C.t2, background: on ? 'rgba(103,216,242,.08)' : 'transparent' }}
            >
              {t.label}
            </button>
          )
        })}
      </nav>
      <section style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>{body}</section>
    </div>
  )
}
