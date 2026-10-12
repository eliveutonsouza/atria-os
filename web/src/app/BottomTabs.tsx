import type { AppPage } from '@shared/protocol'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { NavIcon } from './navItems'
import { openPage } from './Sidebar'

// Celular: barra de abas fixa embaixo (prancha Main do canvas). Some com o teclado aberto.

const TABS: { id: AppPage; label: string; match?: AppPage[] }[] = [
  { id: 'overview', label: 'Início', match: ['overview', 'ops', 'agents'] },
  { id: 'runs', label: 'Execuções' },
  { id: 'workflows', label: 'Workflows', match: ['workflows', 'schedule'] },
  { id: 'inbox', label: 'Aprovações' },
  { id: 'more', label: 'Mais' },
]

export function BottomTabs() {
  const app = useYui((s) => s.shellMode === 'app')
  const page = useYui((s) => s.appPage)
  const phone = useYui((s) => s.device === 'phone')
  const kb = useYui((s) => s.keyboardOpen)
  const pending = useYui((s) => s.inbox.length)
  if (!app || !phone || kb) return null
  const inTabs = TABS.some((t) => (t.match ?? [t.id]).includes(page))
  return (
    <nav
      aria-label="Navegação principal"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 30, height: 'var(--tabbar)', boxSizing: 'border-box',
        paddingBottom: 'var(--sab)', paddingLeft: 'var(--sal)', paddingRight: 'var(--sar)', display: 'flex',
        background: 'rgba(10,12,29,.92)', borderTop: '1px solid rgba(255,255,255,.08)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      }}
    >
      {TABS.map((t) => {
        // telas fora das abas (Missões, Vault…) acendem "Mais"
        const on = (t.match ?? [t.id]).includes(page) || (t.id === 'more' && !inTabs)
        return (
          <button
            key={t.id}
            onClick={() => openPage(t.id)}
            aria-current={on ? 'page' : undefined}
            style={{
              flex: 1, minWidth: 0, border: 'none', background: 'transparent', cursor: 'pointer', position: 'relative',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
              color: on ? C.text : '#8b91ad', fontSize: 11, fontWeight: on ? 600 : 500,
            }}
          >
            <span style={{ color: on ? C.cyan : 'currentColor', display: 'flex' }}>
              <NavIcon id={t.id} size={22} stroke={1.8} />
            </span>
            {t.label}
            {t.id === 'inbox' && pending > 0 && (
              <span
                aria-label={`${pending} pendentes`}
                style={{ position: 'absolute', top: 5, left: 'calc(50% + 6px)', minWidth: 18, height: 18, borderRadius: 9, padding: '0 5px', background: C.warn, color: '#1a1204', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {pending}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
