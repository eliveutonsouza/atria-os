import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { BottomSheet, type SheetAction } from '../views/Sheet'

// Diálogos do vault: pedir um caminho (renomear/mover, nova pasta) e o menu de contexto da árvore no desktop.

export function PathPrompt({ title, hint, label, initial, confirm, onCancel, onSubmit }: {
  title: string
  hint?: ReactNode
  label: string
  initial: string
  confirm: string
  onCancel: () => void
  onSubmit: (value: string) => Promise<unknown>
}) {
  const phone = useYui((s) => s.device === 'phone')
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (phone) return
    ref.current?.focus()
    ref.current?.select()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phone, busy, onCancel])
  const go = () => {
    const v = value.trim().replace(/^\/+|\/+$/g, '')
    if (!v) return setErr('Informe um nome.')
    setBusy(true)
    onSubmit(v)
      .catch((e: Error) => setErr(e.message === 'destino já existe' || e.message === 'já existe' ? 'Já existe algo com esse nome.' : e.message))
      .finally(() => setBusy(false))
  }
  const h = phone ? 50 : 40
  const body = (
    <>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, color: C.t2, lineHeight: 1.5 }}>{hint}</div>}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: C.t2 }}>
        {label}
        <input ref={ref} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} className="vault-input" style={{ height: phone ? 46 : 38 }} spellCheck={false} />
      </label>
      {err && <div role="alert" style={{ color: C.crit, fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: phone ? 'repeat(2,minmax(0,1fr))' : 'auto auto', justifyContent: phone ? undefined : 'end', gap: 8 }}>
        <button className="app-btn" style={{ height: h }} disabled={busy} onClick={onCancel}>Cancelar</button>
        <button className="app-btn primary" style={{ height: h }} disabled={busy} onClick={go}>{busy ? 'Salvando…' : confirm}</button>
      </div>
    </>
  )
  if (phone) return <BottomSheet label={title} onClose={busy ? () => {} : onCancel}>{body}</BottomSheet>
  return createPortal(
    <div onClick={busy ? undefined : onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,10,.66)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '100%', boxSizing: 'border-box', padding: 22, borderRadius: 18, background: '#10132a', border: '1px solid rgba(160,170,255,.18)', boxShadow: '0 30px 80px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 14, color: C.text }}>
        {body}
      </div>
    </div>,
    document.body,
  )
}

/** Menu de contexto (botão direito) na árvore do vault; no toque a página usa o ActionSheet. */
export function ContextMenu({ x, y, title, actions, onClose }: { x: number; y: number; title: string; actions: SheetAction[]; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const W = 220
  const left = Math.min(x, window.innerWidth - W - 8)
  const top = Math.min(y, window.innerHeight - (actions.length * 34 + 44))
  return createPortal(
    <div onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} style={{ position: 'fixed', inset: 0, zIndex: 70 }}>
      <div role="menu" aria-label={`Ações: ${title}`} onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left, top, width: W, padding: 6, borderRadius: 12, background: '#121530', border: '1px solid rgba(160,170,255,.18)', boxShadow: '0 18px 50px rgba(0,0,0,.55)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 11.5, color: C.t3, padding: '4px 8px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {actions.map((a) => (
          <button
            key={a.label}
            role="menuitem"
            className="vault-row"
            onClick={() => {
              onClose()
              a.fn()
            }}
            style={{ minHeight: 32, padding: '0 8px', border: 'none', background: 'transparent', color: a.danger ? '#f39aa4' : '#dfe3f3', textAlign: 'left' }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
