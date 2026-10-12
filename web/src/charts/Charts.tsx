import { useId } from 'react'
import { C } from '../lib/colors'

// Gráficos SVG no idioma visual do design (sem biblioteca): barras com gradiente, área lavanda, linhas e pizza.

export const SERIES_COLORS = [C.cyan, C.lav, C.ok, C.violet, C.warn, C.critSoft]
const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

function NoData({ height }: { height: number }) {
  return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: C.t3 }}>Sem dados no período</div>
}

export function KpiTile({ label, value, color = C.text, size = 40 }: { label: string; value: string; color?: string; size?: number }) {
  return (
    <div style={{ padding: '18px 20px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', minWidth: 0 }}>
      <div style={{ fontSize: 12, color: C.t2, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: size, fontWeight: 300, lineHeight: 1.05, letterSpacing: '-.02em', color, overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  )
}

/** Barras verticais (uma série) — usado na atividade 24h. */
export function Bars({ values, tips, height = 140, highlightLast = true, label }: { values: number[]; tips?: string[]; height?: number; highlightLast?: boolean; label: string }) {
  const max = Math.max(1, ...values)
  if (!values.some((v) => v > 0)) return <NoData height={height} />
  return (
    <div role="img" aria-label={`${label}: ${values.map((v, i) => tips?.[i] ?? fmt(v)).join(', ')}`} style={{ height, display: 'flex', alignItems: 'flex-end', gap: values.length > 40 ? 2 : 4 }}>
      {values.map((v, i) => (
        <div
          key={i}
          title={tips?.[i] ?? String(v)}
          style={{
            flex: 1, height: `${Math.round((v / max) * 100)}%`, minHeight: 2, borderRadius: '3px 3px 1px 1px',
            background: 'linear-gradient(180deg,#67d8f2,rgba(166,140,247,.35))',
            opacity: highlightLast && i === values.length - 1 ? 1 : 0.55 + (0.45 * v) / max,
          }}
        />
      ))}
    </div>
  )
}

/** Barras agrupadas (várias séries) com rótulos. */
export function GroupedBars({ labels, series, height = 180 }: { labels: string[]; series: { name: string; values: number[] }[]; height?: number }) {
  const all = series.flatMap((s) => s.values)
  const max = Math.max(1, ...all)
  if (!all.some((v) => v > 0)) return <NoData height={height} />
  // com poucas barras, o valor aparece em cima de cada uma (não só no title)
  const showVals = labels.length * series.length <= 24
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div role="img" aria-label={`Gráfico de barras: ${labels.map((l, i) => `${l} ${series.map((s) => `${s.name} ${fmt(s.values[i] ?? 0)}`).join(', ')}`).join('; ')}`} style={{ height, display: 'flex', alignItems: 'flex-end', gap: 10, paddingTop: showVals ? 16 : 0 }}>
        {labels.map((l, i) => (
          <div key={i} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', gap: 3, minWidth: 0 }}>
            {series.map((s, si) => {
              const v = s.values[i] ?? 0
              return (
                <div
                  key={si}
                  title={`${l} · ${s.name}: ${fmt(v)}`}
                  style={{ flex: 1, position: 'relative', height: `${Math.max(1, (v / max) * 100)}%`, borderRadius: '3px 3px 1px 1px', background: series.length === 1 ? 'linear-gradient(180deg,#67d8f2,rgba(166,140,247,.35))' : SERIES_COLORS[si % SERIES_COLORS.length], opacity: series.length === 1 ? 0.9 : 0.8 }}
                >
                  {showVals && <span className="mono" style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', paddingBottom: 2, fontSize: 10, color: C.t2, whiteSpace: 'nowrap' }}>{fmt(v)}</span>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <AxisLabels labels={labels} />
    </div>
  )
}

function AxisLabels({ labels }: { labels: string[] }) {
  const step = Math.max(1, Math.ceil(labels.length / 8))
  return (
    <div className="mono" style={{ display: 'flex', gap: 10, fontSize: 10, color: C.t3 }}>
      {labels.map((l, i) => (
        <span key={i} style={{ flex: 1, minWidth: 0, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', visibility: i % step === 0 ? 'visible' : 'hidden' }}>{l}</span>
      ))}
    </div>
  )
}

function linePoints(values: number[], lo: number, hi: number): string[] {
  const span = Math.max(1e-9, hi - lo)
  return values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * 300).toFixed(1)},${(100 - ((v - lo) / span) * 92 - 4).toFixed(1)}`)
}

/** Linha/área (uma ou mais séries). Área = primeira série preenchida em lavanda, como no design. */
export function LineArea({ series, area = false, height = 140, label, min, max: maxIn }: { series: { name: string; values: number[] }[]; area?: boolean; height?: number; label: string; min?: number; max?: number }) {
  const gid = useId().replace(/:/g, '')
  const all = series.flatMap((s) => s.values)
  const lo = min ?? Math.min(0, ...all)
  const hi = maxIn ?? Math.max(1, ...all)
  return (
    <svg viewBox="0 0 300 100" preserveAspectRatio="none" role="img" aria-label={label} style={{ width: '100%', height, display: 'block' }}>
      <defs>
        <linearGradient id={`a${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a68cf7" stopOpacity=".35" />
          <stop offset="1" stopColor="#a68cf7" stopOpacity="0" />
        </linearGradient>
      </defs>
      {series.map((s, si) => {
        const pts = linePoints(s.values, lo, hi)
        const color = si === 0 && area ? '#cbbcff' : SERIES_COLORS[si % SERIES_COLORS.length]
        return (
          <g key={si}>
            {area && si === 0 && <path d={`M0,100 L${pts.join(' L')} L300,100 Z`} fill={`url(#a${gid})`} />}
            <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </g>
        )
      })}
    </svg>
  )
}

/** Pizza/rosca. */
export function Pie({ labels, values, size = 180 }: { labels: string[]; values: number[]; size?: number }) {
  const sum = values.reduce((a, b) => a + Math.max(0, b), 0)
  if (!sum) return <NoData height={size} />
  const total = sum
  let acc = 0
  const r = 40
  const circ = 2 * Math.PI * r
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`Gráfico de pizza: ${labels.map((l, i) => `${l} ${fmt(values[i] ?? 0)}`).join(', ')}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="14" />
        {values.map((v, i) => {
          const frac = Math.max(0, v) / total
          const dash = `${frac * circ} ${circ}`
          const off = -acc * circ
          acc += frac
          return <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth="14" strokeDasharray={dash} strokeDashoffset={off}><title>{`${labels[i]}: ${fmt(v)}`}</title></circle>
        })}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        {labels.map((l, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
            <span style={{ color: 'var(--text-dim)' }}>{l}</span>
            <span style={{ color: C.t2 }}>{fmt(values[i] ?? 0)}</span>
            <span style={{ color: C.t3 }}>{Math.round((Math.max(0, values[i] ?? 0) / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Legend({ names }: { names: string[] }) {
  if (names.length < 2) return null
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: C.t2 }}>
      {names.map((n, i) => (
        <span key={n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: SERIES_COLORS[i % SERIES_COLORS.length] }} />{n}
        </span>
      ))}
    </div>
  )
}
