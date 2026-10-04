import type { ReactNode } from 'react'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { GUIDE_FOR_PAGE } from '../help/api'

// Cabeçalho das páginas do dashboard. Lê store.header (useHeader) — o mesmo das views do Canvas,
// então AgentDetailView, MissionView, WorkflowView etc. aparecem com seus títulos e ações.
export function PageHeader({ extra }: { extra?: ReactNode }) {
  const header = useYui((s) => s.header)
  const narrow = useYui((s) => s.narrow)
  const set = useYui((s) => s.set)
  const helpGuide = useYui((s) => (s.shellMode === 'app' && s.appPage !== 'help' ? GUIDE_FOR_PAGE[s.appPage] ?? null : null))
  return (
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {narrow && (
          <button
            aria-label="Abrir menu"
            onClick={() => set({ sidebarOpen: true })}
            style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.03)', color: C.text, fontSize: 16, cursor: 'pointer' }}
          >
            ≡
          </button>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          {header.eyebrow && <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: C.cyan, fontWeight: 600 }}>{header.eyebrow}</div>}
          <h1 style={{ margin: 0, fontSize: narrow ? 20 : 24, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{header.title}</h1>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {helpGuide && (
          <button
            aria-label="Ajuda desta tela"
            title="Ajuda desta tela"
            onClick={() => set({ appPage: 'help', appParams: { id: `guia:${helpGuide}` } })}
            style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.03)', color: C.t2, fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            ?
          </button>
        )}
        {extra}
        {header.actions.map((a) => (
          // ação que começa com "+" (criar algo) é o botão principal, como no layout
          <button key={a.label} onClick={a.fn} className={`app-btn${a.label.trim().startsWith('+') ? ' primary' : ''}`}>
            {a.label}
          </button>
        ))}
      </div>
    </header>
  )
}
