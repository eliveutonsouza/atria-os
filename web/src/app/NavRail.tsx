import type { AppPage } from '@shared/protocol'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { exitApp } from './nav'
import { NavIcon } from './navItems'
import { openPage } from './Sidebar'

// Tablet: trilho de ícones (prancha Tablet-Missoes). "Mais" abre o menu completo (gaveta).

export const RAIL_W = 76

const ITEMS: { id: AppPage; label: string }[] = [
  { id: 'overview', label: 'Início' },
  { id: 'runs', label: 'Execuções' },
  { id: 'missions', label: 'Missões' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'inbox', label: 'Aprovações' },
  { id: 'terminal', label: 'Terminal' },
]

export function NavRail() {
  const app = useYui((s) => s.shellMode === 'app')
  const page = useYui((s) => s.appPage)
  const tablet = useYui((s) => s.device === 'tablet')
  const pending = useYui((s) => s.inbox.length)
  if (!app || !tablet) return null
  const inRail = ITEMS.some((i) => i.id === page)
  const btn = (on: boolean) => ({
    width: 64, height: 58, borderRadius: 14, border: 'none', cursor: 'pointer', position: 'relative' as const,
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 4,
    background: on ? 'rgba(103,216,242,.12)' : 'transparent', color: on ? C.text : '#8b91ad', fontSize: 10.5, fontWeight: on ? 600 : 500,
  })
  return (
    <nav
      aria-label="Navegação principal"
      style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, width: `calc(${RAIL_W}px + var(--sal))`, zIndex: 30, boxSizing: 'border-box',
        padding: 'calc(12px + var(--sat)) 0 calc(12px + var(--sab)) var(--sal)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        background: 'rgba(10,12,29,.7)', borderRight: '1px solid rgba(255,255,255,.06)', overflowY: 'auto',
      }}
    >
      <button aria-label="Falar com a Yui" title="Falar com a Yui" onClick={() => exitApp()} style={{ ...btn(false), height: 52 }}>
        <span aria-hidden style={{ width: 32, height: 32, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #fff, #67d8f2 45%, #a68cf7)', boxShadow: '0 0 18px rgba(103,216,242,.4)' }} />
      </button>
      {ITEMS.map((it) => {
        const on = it.id === page
        return (
          <button key={it.id} onClick={() => openPage(it.id)} aria-current={on ? 'page' : undefined} style={btn(on)}>
            <span style={{ color: on ? C.cyan : 'currentColor', display: 'flex' }}>
              <NavIcon id={it.id} size={22} stroke={1.8} />
            </span>
            {it.label}
            {it.id === 'inbox' && pending > 0 && (
              <span aria-label={`${pending} pendentes`} style={{ position: 'absolute', top: 4, right: 10, minWidth: 18, height: 18, borderRadius: 9, padding: '0 5px', background: C.warn, color: '#1a1204', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{pending}</span>
            )}
          </button>
        )
      })}
      <button onClick={() => useYui.getState().set({ sidebarOpen: true })} aria-current={!inRail ? 'page' : undefined} style={btn(!inRail)}>
        <span style={{ color: !inRail ? C.cyan : 'currentColor', display: 'flex' }}>
          <NavIcon id="more" size={22} stroke={1.8} />
        </span>
        Mais
      </button>
    </nav>
  )
}
