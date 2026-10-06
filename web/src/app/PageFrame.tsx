import { useState, type ReactNode } from 'react'
import { C } from '../lib/colors'
import { useYui, type HeaderAction } from '../store/yui'
import { ActionSheet, type SheetAction } from '../views/Sheet'
import { GUIDE_FOR_PAGE } from '../help/api'

// Cabeçalho das páginas do dashboard. Lê store.header (useHeader) — o mesmo das views do Canvas,
// então AgentDetailView, MissionView, WorkflowView etc. aparecem com seus títulos e ações.
/** Ação principal visível no celular: marcada `primary`, senão a de criar ("+ …"), senão a primeira não destrutiva. */
export function pickPrimary(actions: HeaderAction[]): HeaderAction | null {
  return actions.find((a) => a.primary) ?? actions.find((a) => a.label.trim().startsWith('+')) ?? actions.find((a) => !a.danger) ?? null
}

// Telas cujo `id` é um detalhe aberto a partir de uma lista: no celular ganham ‹ Voltar.
const NO_BACK = new Set(['overview', 'more', 'tools', 'company', 'settings'])

export function PageHeader({ extra }: { extra?: ReactNode }) {
  const header = useYui((s) => s.header)
  const phone = useYui((s) => s.device === 'phone')
  const set = useYui((s) => s.set)
  const page = useYui((s) => s.appPage)
  const hasId = useYui((s) => !!s.appParams.id)
  const helpGuide = useYui((s) => (s.shellMode === 'app' && s.appPage !== 'help' ? GUIDE_FOR_PAGE[s.appPage] ?? null : null))
  const [menu, setMenu] = useState(false)
  const openHelp = () => set({ appPage: 'help', appParams: { id: `guia:${helpGuide}` } })
  const back = header.back ?? (phone && hasId && !NO_BACK.has(page) ? () => set({ appParams: {} }) : null)

  if (phone) {
    const primary = pickPrimary(header.actions)
    const rest: SheetAction[] = header.actions.filter((a) => a !== primary).map((a) => ({ label: a.label, fn: a.fn, danger: a.danger }))
    if (helpGuide) rest.push({ label: 'Ajuda desta tela', fn: openHelp })
    return (
      <header style={{ display: 'flex', alignItems: 'flex-end', gap: 10, minWidth: 0 }}>
        {back && (
          <button aria-label="Voltar" onClick={back} style={iconBtn}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
          {header.eyebrow && <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: C.cyan, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{header.eyebrow}</div>}
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>{header.title}</h1>
        </div>
        {extra}
        {primary && (
          <button onClick={primary.fn} className="app-btn primary" style={{ height: 44, maxWidth: 128, overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }}>
            {primary.label}
          </button>
        )}
        {rest.length > 0 && (
          <button aria-label="Mais ações" aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu(true)} style={iconBtn}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg>
          </button>
        )}
        {menu && <ActionSheet title={header.title} actions={rest} onClose={() => setMenu(false)} />}
      </header>
    )
  }

  return (
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        {header.eyebrow && <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: C.cyan, fontWeight: 600 }}>{header.eyebrow}</div>}
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{header.title}</h1>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {helpGuide && (
          <button
            aria-label="Ajuda desta tela"
            title="Ajuda desta tela"
            onClick={openHelp}
            className="app-btn"
            style={{ width: 34, padding: 0, color: C.t2, fontSize: 15, fontWeight: 700, flexShrink: 0 }}
          >
            ?
          </button>
        )}
        {extra}
        {header.actions.map((a) => (
          // ação que começa com "+" (criar algo) ou marcada primary é o botão principal
          <button key={a.label} onClick={a.fn} className={`app-btn${a.primary || a.label.trim().startsWith('+') ? ' primary' : a.danger ? ' danger' : ''}`}>
            {a.label}
          </button>
        ))}
      </div>
    </header>
  )
}

const iconBtn = {
  width: 44, height: 44, flexShrink: 0, borderRadius: 12, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.04)',
  color: C.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
} as const
