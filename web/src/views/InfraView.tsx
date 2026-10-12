import type { InfraPayload } from '@shared/protocol'
import { useApi } from '../api/useApi'
import { C, toneColor } from '../lib/colors'
import { card, Empty, ErrorNote, Eyebrow, Skeleton, useHeader } from './ui'

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`)
const pctTone = (v: number | null) => (v == null ? C.text : v >= 90 ? C.crit : v >= 75 ? C.warn : C.text)

export function InfraView() {
  const { data, loading, error } = useApi<InfraPayload>('/api/infra', [], 10000)
  useHeader('Infraestrutura · ao vivo', 'Minha VPS')
  if (loading && !data) return <Skeleton rows={6} />
  if (error || !data) return <ErrorNote />
  const healthy = data.containers.filter((c) => c.tone === 'ok').length
  const warn = data.containers.length - healthy
  const kpis = [
    { l: 'CPU', v: pct(data.cpu), c: pctTone(data.cpu) },
    { l: 'RAM', v: pct(data.ram), c: pctTone(data.ram) },
    { l: 'Disco', v: pct(data.disk), c: pctTone(data.disk) },
    { l: 'Load', v: data.load.length ? data.load[0].toFixed(2) : '—', c: C.text },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14 }}>
        {kpis.map((k) => (
          <div key={k.l} style={card}>
            <div style={{ fontSize: 12, color: C.t2, marginBottom: 8 }}>{k.l}</div>
            <div style={{ fontSize: 40, fontWeight: 300, lineHeight: 1, letterSpacing: '-.02em', color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 36, flexWrap: 'wrap' }}>
        <div><div className="eyebrow">SAUDÁVEIS</div><div style={{ fontSize: 36, fontWeight: 300, color: C.ok }}>{healthy}</div></div>
        <div><div className="eyebrow">ATENÇÃO</div><div style={{ fontSize: 36, fontWeight: 300, color: warn ? C.warn : C.t2 }}>{warn}</div></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Eyebrow style={{ marginBottom: 8 }}>Containers</Eyebrow>
        {data.containers.length === 0 && <Empty text="Não consegui listar os containers." />}
        {data.containers.map((c) => {
          const col = toneColor(c.tone)
          return (
            <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto', gap: 14, alignItems: 'center', padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,.05)', fontSize: 14 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: col, boxShadow: `0 0 10px ${col}` }} />
              <span className="mono" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              <span style={{ fontSize: 12, color: col }}>{c.health ?? c.state}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
