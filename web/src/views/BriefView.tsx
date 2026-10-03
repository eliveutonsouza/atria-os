import type { Brief } from '@shared/protocol'
import { useApi } from '../api/useApi'
import { C, toneColor } from '../lib/colors'
import { useYui } from '../store/yui'
import { Empty, ErrorNote, Eyebrow, Skeleton, useHeader } from './ui'

export function BriefView() {
  const { data, loading, error } = useApi<Brief>('/api/brief')
  useHeader('Overnight', 'Enquanto você esteve fora', [{ label: 'Visão geral', fn: () => useYui.getState().show('dashboard') }])
  if (loading && !data) return <Skeleton rows={6} />
  if (error || !data) return <ErrorNote />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 1100 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14 }}>
        {data.kpis.map((k, i) => (
          <div key={i} style={{ padding: '20px 22px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 52, fontWeight: 300, lineHeight: 1, letterSpacing: '-.03em', color: toneColor(k.tone) }}>{k.value}</div>
            <div style={{ fontSize: 13, color: C.t2 }}>{k.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Eyebrow style={{ marginBottom: 10 }}>Linha do tempo</Eyebrow>
        {data.timeline.length === 0 && <Empty text="Nada rodou enquanto você esteve fora." />}
        {data.timeline.map((ev, i) => {
          const c = toneColor(ev.tone)
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '64px 20px minmax(0,1fr) auto', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <span className="mono" style={{ fontSize: 13, color: C.t3 }}>{ev.t}</span>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, boxShadow: `0 0 10px ${c}` }} />
              <span style={{ fontSize: 15 }}>{ev.label}</span>
              <span style={{ fontSize: 12, color: c }}>{ev.result}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
