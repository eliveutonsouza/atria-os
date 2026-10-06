import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { C, glow } from '../lib/colors'
import { useYui, type HeaderAction } from '../store/yui'
import { BottomSheet } from './Sheet'

export const card: CSSProperties = { padding: '18px 20px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }

/** Define eyebrow/título/ações do cabeçalho do Canvas para a view atual. */
export function useHeader(eyebrow: string, title: string, actions: HeaderAction[] = [], deps: unknown[] = []) {
  useEffect(() => {
    useYui.getState().setHeader({ eyebrow, title, actions })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eyebrow, title, ...deps])
}

export function Dot({ c, size = 8, hollow = false }: { c: string; size?: number; hollow?: boolean }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: hollow ? 'transparent' : c, border: hollow ? `1px solid ${C.t3}` : undefined, boxShadow: hollow ? undefined : glow(c) }}
    />
  )
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="eyebrow" style={style}>{children}</div>
}

export function Skeleton({ rows = 3, kpis = 4 }: { rows?: number; kpis?: number }) {
  return (
    <div aria-busy="true" aria-label="Carregando" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {kpis > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14 }}>
          {Array.from({ length: kpis }).map((_, i) => <div key={i} className="skel" style={{ height: 88 }} />)}
        </div>
      )}
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skel" style={{ height: 44, opacity: 1 - i * 0.15 }} />)}
    </div>
  )
}

/** Empty state "Yui-oriented" (§119). */
export function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div style={{ padding: '48px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
      <span aria-hidden style={{ width: 14, height: 14, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #fff, #67d8f2 45%, #a68cf7)', opacity: 0.8 }} />
      <div style={{ fontSize: 15, color: '#c9cde0', maxWidth: 420 }}>{text}</div>
      {hint && <div style={{ fontSize: 13, color: C.t3 }}>{hint}</div>}
    </div>
  )
}

export function ErrorNote({ text }: { text?: string }) {
  return <Empty text={text ?? 'Não consegui carregar isso agora.'} hint="Peça de novo para a Yui em instantes." />
}

/** Confirmação de exclusão definitiva (workflows, missões…): Cancelar recebe o foco, o botão vermelho exclui. */
export function ConfirmDeleteModal({ title, text, rows = [], busy, onCancel, onConfirm }: {
  title: string
  text: string
  rows?: { label: string; value: string }[]
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const phone = useYui((s) => s.device === 'phone')
  useEffect(() => {
    if (phone) return // a folha inferior cuida do ESC
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel, phone])
  const body = (
    <>
      <div style={{ fontSize: 11, letterSpacing: '.2em', color: C.crit, fontWeight: 700 }}>AÇÃO DESTRUTIVA · NÃO DÁ PARA DESFAZER</div>
      <div id="cdm-title" style={{ fontSize: 18, fontWeight: 700, overflowWrap: 'anywhere' }}>{title}</div>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: '#c9cde0' }}>{text}</p>
      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 13 }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
              <span style={{ color: C.t2 }}>{r.label}</span>
              <span style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: phone ? 'repeat(2, minmax(0, 1fr))' : 'auto auto', justifyContent: phone ? undefined : 'end', gap: 8 }}>
        <button autoFocus disabled={busy} onClick={onCancel} style={{ height: phone ? 50 : 42, padding: '0 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.03)', color: '#dfe3f3', fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancelar
        </button>
        <button
          disabled={busy}
          onClick={onConfirm}
          style={{ height: phone ? 50 : 42, padding: '0 16px', borderRadius: 10, border: 'none', background: '#e2566a', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Excluindo…' : 'Excluir definitivamente'}
        </button>
      </div>
    </>
  )
  if (phone)
    return (
      <BottomSheet label={title} role="alertdialog" tone="rgba(240,98,114,.5)" onClose={busy ? () => {} : onCancel}>
        {body}
      </BottomSheet>
    )
  return createPortal(
    <div onClick={busy ? undefined : onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,10,.66)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 16 }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cdm-title" onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '100%', maxHeight: 'calc(var(--vvh) - 32px)', overflowY: 'auto', boxSizing: 'border-box', padding: 22, borderRadius: 18, background: '#10132a', border: '1px solid rgba(240,98,114,.35)', boxShadow: '0 30px 80px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {body}
      </div>
    </div>,
    document.body,
  )
}
