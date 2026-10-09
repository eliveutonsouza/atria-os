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
import { MonitorSection } from './settings/MonitorSection'
import { NoticesSection } from './settings/NoticesSection'
import { SupportSection } from './settings/SupportSection'

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
  { id: 'notices', label: 'Avisos' },
  { id: 'system', label: 'Sistema' },
  { id: 'support', label: 'Suporte e atualizações' },
] as const
type TabId = (typeof TABS)[number]['id']

export function SettingsPage() {
  const raw = useYui((s) => s.appParams.id)
  const tab: TabId = (TABS.find((t) => t.id === raw)?.id ?? 'start') as TabId
  const go = (id: TabId) => useYui.getState().set({ appParams: { id } })
  useHeader('Configurações', TABS.find((t) => t.id === tab)!.label, [], [tab])
  const device = useYui((s) => s.device)
  const phone = device === 'phone'

  let body: ReactNode
  switch (tab) {
    case 'account': body = <AccountSection />; break
    case 'connections': body = <ConnectionsSection />; break
    case 'voice': body = <VoiceSection />; break
    case 'models': body = <ModelsSection />; break
    case 'agents': body = <AgentsApprovalsSection />; break
    case 'notifications': body = <NotificationsSection />; break
    case 'notices': body = <NoticesSection />; break
    case 'system': body = <><SystemSection /><MonitorSection /></>; break
    case 'support': body = <SupportSection />; break
    default: body = <SetupSteps onGo={go} />
  }

  // celular: seções viram faixa de chips no topo; tablet: menu estreito à esquerda
  return (
    <div style={phone ? { display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 } : { display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', minHeight: 0 }}>
      <nav
        aria-label="Seções das configurações"
        className={phone ? 'h-scroll' : undefined}
        style={phone ? { display: 'flex', gap: 6, margin: '0 calc(-16px - var(--sar)) 0 calc(-16px - var(--sal))', padding: '0 calc(16px + var(--sar)) 0 calc(16px + var(--sal))' } : { flex: device === 'tablet' ? '0 0 180px' : '0 1 210px', minWidth: device === 'tablet' ? 0 : 180, display: 'flex', flexDirection: 'column', gap: 2 }}
      >
        {TABS.map((t) => {
          const on = t.id === tab
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.id)}
              aria-current={on ? 'page' : undefined}
              style={
                phone
                  ? { flex: '0 0 auto', height: 44, padding: '0 16px', borderRadius: 22, whiteSpace: 'nowrap', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', color: on ? C.text : C.t2, background: on ? 'rgba(103,216,242,.12)' : 'rgba(255,255,255,.04)', border: `1px solid ${on ? 'rgba(103,216,242,.35)' : 'rgba(255,255,255,.08)'}` }
                  : { height: 38, padding: '0 12px', borderRadius: 10, border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 13.5, fontFamily: 'inherit', color: on ? C.text : C.t2, background: on ? 'rgba(103,216,242,.08)' : 'transparent' }
              }
            >
              {t.label}
            </button>
          )
        })}
      </nav>
      <section style={{ flex: phone ? '1 1 auto' : '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>{body}</section>
    </div>
  )
}
