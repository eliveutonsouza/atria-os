import type { CSSProperties, ReactNode } from 'react'
import type { ToolStatus } from '@shared/protocol'
import { C, glow } from '../lib/colors'

// Peças visuais compartilhadas pelas views de Ferramentas, Agente e Mapa do Claude (idioma do design).

export const STATUS_META: Record<ToolStatus, { label: string; color: string }> = {
  ok: { label: 'ok', color: C.ok },
  warn: { label: 'atenção', color: C.warn },
  'needs-auth': { label: 'pede autorização', color: C.warn },
  down: { label: 'fora do ar', color: C.crit },
  unknown: { label: 'desconhecido', color: C.t3 },
}

export function mcpStatusMeta(s: string): { label: string; color: string } {
  if (s === 'connected') return { label: 'conectado', color: C.ok }
  if (s === 'pending') return { label: 'conectando', color: C.cyan }
  if (s === 'needs-auth') return { label: 'pede autorização', color: C.warn }
  if (s === 'failed') return { label: 'falhou', color: C.crit }
  return { label: s, color: C.t3 }
}

export function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color, whiteSpace: 'nowrap' }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: glow(color, 8) }} />
      {label}
    </span>
  )
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {items.map((it) => {
        const on = it.id === value
        return (
          <button
            key={it.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.id)}
            style={{
              height: 32, padding: '0 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
              border: `1px solid ${on ? 'rgba(103,216,242,.35)' : 'rgba(255,255,255,.08)'}`,
              background: on ? 'rgba(103,216,242,.1)' : 'transparent', color: on ? '#a9e9f8' : C.t2,
            }}
          >
            {it.label}
            {it.count !== undefined && <span className="mono" style={{ fontSize: 11, color: on ? '#a9e9f8' : C.t3 }}>{it.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function Chip({ children, on, onClick, title }: { children: ReactNode; on?: boolean; onClick?: () => void; title?: string }) {
  const style: CSSProperties = {
    fontSize: 12, padding: '4px 10px', borderRadius: 8, cursor: onClick ? 'pointer' : 'default', whiteSpace: 'nowrap',
    border: `1px solid ${on ? 'rgba(103,216,242,.35)' : 'rgba(255,255,255,.08)'}`,
    background: on ? 'rgba(103,216,242,.1)' : 'rgba(255,255,255,.02)', color: on ? '#a9e9f8' : C.t2,
  }
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={on} title={title} style={{ ...style, fontFamily: 'inherit' }}>{children}</button>
  ) : (
    <span title={title} style={style}>{children}</span>
  )
}

export function SmallBtn({ children, onClick, primary, disabled, title }: { children: ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={primary ? undefined : 'hov-bg2'}
      style={{
        height: 30, padding: '0 12px', borderRadius: 9, fontSize: 12, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
        border: primary ? 'none' : '1px solid rgba(255,255,255,.1)',
        background: primary ? 'linear-gradient(135deg,#67d8f2,#a68cf7)' : 'rgba(255,255,255,.03)',
        color: primary ? '#0a0c1d' : '#dfe3f3', fontWeight: primary ? 700 : 400,
      }}
    >
      {children}
    </button>
  )
}

export const input: CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(0,0,0,.25)',
  color: C.text, fontSize: 14, fontFamily: 'inherit', outline: 'none',
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span style={{ fontSize: 12, color: C.t3 }}>{hint}</span>}
    </label>
  )
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} style={{ ...input, maxWidth: 320 }} />
}
