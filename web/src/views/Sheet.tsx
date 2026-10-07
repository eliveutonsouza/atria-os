import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../lib/colors'

// Folha inferior (celular): alça, conteúdo e respiro da safe area. ESC e toque fora fecham.

export function BottomSheet({ label, onClose, children, tone, role = 'dialog', zIndex = 72 }: { label: string; onClose: () => void; children: ReactNode; tone?: string; role?: 'dialog' | 'alertdialog'; zIndex?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  // portal no <body>: fica acima da barra de abas, do orb e de qualquer contexto de empilhamento da página
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex, background: 'rgba(4,5,12,.62)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end' }}>
      <section
        role={role}
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxHeight: 'calc(var(--vvh) - var(--sat) - 24px)', overflowY: 'auto', overscrollBehavior: 'contain', boxSizing: 'border-box',
          padding: '10px calc(16px + var(--sar)) calc(16px + var(--sab)) calc(16px + var(--sal))', borderRadius: '24px 24px 0 0',
          background: 'linear-gradient(180deg,#14173a,#0e1022)', borderTop: `1px solid ${tone ?? 'rgba(255,255,255,.1)'}`, boxShadow: '0 -20px 60px rgba(0,0,0,.55)',
          display: 'flex', flexDirection: 'column', gap: 12, animation: 'atria-sheet-in .24s var(--ease)', color: C.text,
        }}
      >
        <div aria-hidden style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(255,255,255,.2)', alignSelf: 'center', flexShrink: 0 }} />
        {children}
      </section>
    </div>,
    document.body,
  )
}

export interface SheetAction {
  label: string
  fn: () => void
  danger?: boolean
  hint?: string
}

/** Menu ⋯ (prancha Phone-Acoes): linhas de 52px, destrutivas em vermelho por último, botão Fechar. */
export function ActionSheet({ title, actions, onClose }: { title?: string; actions: SheetAction[]; onClose: () => void }) {
  const sorted = [...actions.filter((a) => !a.danger), ...actions.filter((a) => a.danger)]
  return (
    <BottomSheet label={title ? `Ações: ${title}` : 'Ações'} onClose={onClose}>
      {title && <div style={{ fontSize: 13, color: C.t3, padding: '0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sorted.map((a, i) => (
          <button
            key={a.label}
            onClick={() => {
              onClose()
              a.fn()
            }}
            style={{
              minHeight: 52, padding: '0 6px', border: 'none', borderBottom: i < sorted.length - 1 ? '1px solid rgba(255,255,255,.06)' : 'none', background: 'transparent',
              color: a.danger ? '#f39aa4' : C.text, fontSize: 16, fontWeight: 500, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
            }}
          >
            <span style={{ flex: 1 }}>{a.label}</span>
            {a.hint && <span style={{ fontSize: 13, color: C.t3 }}>{a.hint}</span>}
          </button>
        ))}
      </div>
      <button onClick={onClose} style={{ height: 48, borderRadius: 14, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.04)', color: '#dfe3f3', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
        Fechar
      </button>
    </BottomSheet>
  )
}
