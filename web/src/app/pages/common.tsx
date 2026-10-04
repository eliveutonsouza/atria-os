import { useLayoutEffect, type CSSProperties, type ReactNode } from 'react'
import type { AppPage, OpsCard, ViewParams } from '@shared/protocol'
import { C } from '../../lib/colors'
import { useYui } from '../../store/yui'
import { syncViewParams } from '../nav'

// Peças visuais compartilhadas pelas páginas do dashboard (layout v3 do canvas Claude Design).

export function Card({ title, right, children, style, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <section className={`app-card${className ? ` ${className}` : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 12, ...style }}>
      {(title || right) && (
        <div className="app-card-title">
          <span>{title}</span>
          {right && <span className="app-muted">{right}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Kpi({ label, value, color = C.text, delta, deltaColor = C.t2, size = 34 }: { label: string; value: string; color?: string; delta?: string; deltaColor?: string; size?: number }) {
  return (
    <div className="app-card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: C.t2 }}>{label}</span>
      <span style={{ fontSize: size, fontWeight: 300, lineHeight: 1, color, letterSpacing: '-.02em' }}>{value}</span>
      {delta && <span style={{ fontSize: 11, color: deltaColor }}>{delta}</span>}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <span style={{ display: 'flex', gap: 14, color: C.t2, fontSize: 12, flexWrap: 'wrap' }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: i.color }} />
          {i.label}
        </span>
      ))}
    </span>
  )
}

/** Barras horizontais (sucesso por agente, ferramentas mais usadas). */
export function HBar({ label, value, pct, color = C.cyan, labelW = 90, mono = false, onClick }: { label: string; value: string; pct: number; color?: string; labelW?: number; mono?: boolean; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={onClick ? 'app-row' : undefined}
      style={{ display: 'grid', gridTemplateColumns: `${labelW}px minmax(0,1fr) 44px`, alignItems: 'center', gap: 10, fontSize: 12.5, border: 'none', background: 'transparent', color: 'inherit', padding: onClick ? '3px 4px' : 0, borderRadius: 6, cursor: onClick ? 'pointer' : 'default', textAlign: 'left' }}
    >
      <span className={mono ? 'app-mono' : undefined} style={{ color: '#c9cde0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: mono ? 11.5 : 12.5 }}>{label}</span>
      <span style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.max(2, Math.min(100, pct))}%`, background: color, borderRadius: 4, transition: 'width .5s var(--ease)' }} />
      </span>
      <span className="app-mono" style={{ textAlign: 'right', fontSize: 11, color: C.t2 }}>{value}</span>
    </Tag>
  )
}

export function Dot({ c, pulse = false, hollow = false, size = 8 }: { c: string; pulse?: boolean; hollow?: boolean; size?: number }) {
  return (
    <span
      aria-hidden
      className={pulse ? 'app-pulse' : undefined}
      style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: hollow ? 'transparent' : c, border: hollow ? `1px solid ${C.t3}` : undefined, boxShadow: hollow ? undefined : `0 0 10px ${c}` }}
    />
  )
}

export function Tag({ children, color = '#a9e9f8', bg = 'rgba(103,216,242,.08)' }: { children: ReactNode; color?: string; bg?: string }) {
  return <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 6, background: bg, color, whiteSpace: 'nowrap' }}>{children}</span>
}

export const ORIGIN_LABEL: Record<OpsCard['origin'], string> = { yui: 'Yui', manual: 'manual', routine: 'rotina', mission: 'missão', workflow: 'workflow' }

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}
export function fmtCost(v: number | null | undefined): string {
  if (!v) return '$0'
  return v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v)}`
}
export function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}
export function elapsed(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'fila'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  const mm = Math.floor(s / 60), ss = s % 60
  if (mm >= 60) return `${Math.floor(mm / 60)}h${String(mm % 60).padStart(2, '0')}`
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}
export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.round(s / 60)}min`
  if (s < 86400) return `há ${Math.round(s / 3600)}h`
  return `há ${Math.round(s / 86400)}d`
}
export function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
export function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const diff = Math.round((new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 86400_000)
  if (diff === 0) return hhmm(iso)
  if (diff === 1) return `amanhã ${hhmm(iso)}`
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} ${hhmm(iso)}`
}

/** Cor por agente (estável) — mesma paleta dos pontos orbitais da Yui. */
const AGENT_COLORS = [C.cyan, C.violet, C.lav, C.ok, '#7fdcf5', C.warn]
export function agentColor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AGENT_COLORS[h % AGENT_COLORS.length]
}

/** Repassa parâmetros da página para as views reaproveitadas que leem `viewParams` (antes da pintura). */
export function useViewParams(p: ViewParams) {
  const key = JSON.stringify(p)
  useLayoutEffect(() => {
    syncViewParams(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/** Navega entre páginas do dashboard (com id opcional de detalhe). */
export function openApp(page: AppPage, id?: string) {
  useYui.getState().set({ appPage: page, appParams: id ? { id } : {} })
}
