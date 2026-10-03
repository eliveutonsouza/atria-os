import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { C, glow } from '../lib/colors'
import { useYui, type HeaderAction } from '../store/yui'

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
