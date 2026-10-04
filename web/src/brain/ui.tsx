import type { ReactNode } from 'react'
import { rgba } from './palette'
import { mono } from './styles'

// Peças visuais compartilhadas pelo universo e pela Constelação.

export function Star({ color, color2, size = 14 }: { color: string; color2: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, flex: 'none', borderRadius: '50%', background: `radial-gradient(circle at 36% 32%, #fff, ${color} 42%, ${color2} 100%)`, boxShadow: `0 0 ${size}px ${rgba(color, 0.7)}` }}
    />
  )
}

export function Chip({ on, color, label, count, onClick }: { on: boolean; color: string; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      style={{
        height: 32, padding: '0 12px', borderRadius: 16, flex: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5,
        border: `1px solid ${on ? 'rgba(103,216,242,0.45)' : 'rgba(160,170,255,0.14)'}`, background: on ? 'rgba(103,216,242,0.12)' : 'rgba(10,12,29,0.6)', color: on ? '#fff' : '#c9cde0',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}` }} />
      {label}
      {count !== undefined && <span style={{ ...mono, fontSize: 10.5, color: '#8c92ad' }}>{count}</span>}
    </button>
  )
}

export function Toggle({ on, label, tone = 'cyan', onClick }: { on: boolean; label: string; tone?: 'cyan' | 'warn'; onClick: () => void }) {
  const c = tone === 'warn' ? '245,181,74' : '103,216,242'
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      style={{
        height: 30, padding: '0 10px', borderRadius: 9, cursor: 'pointer', fontSize: 12,
        border: `1px solid ${on ? `rgba(${c},0.45)` : 'rgba(255,255,255,0.08)'}`, background: on ? `rgba(${c},0.12)` : 'transparent', color: on ? '#fff' : '#8c92ad',
      }}
    >
      {label}
    </button>
  )
}

export function IconBtn({ label, onClick, children, size = 36 }: { label: string; onClick: () => void; children: ReactNode; size?: number }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ width: size, height: size, borderRadius: 10, border: '1px solid rgba(160,170,255,0.16)', background: 'rgba(12,14,32,0.72)', color: '#c9cde0', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
    >
      {children}
    </button>
  )
}
