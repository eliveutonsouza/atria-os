import type { Overview } from '@shared/protocol'
import { useApi } from '../api/useApi'
import { C, toneColor } from '../lib/colors'
import { useYui } from '../store/yui'
import { card, Empty, ErrorNote, Eyebrow, Skeleton, useHeader } from './ui'
import { Bars, KpiTile, LineArea } from '../charts/Charts'

function hourLabels(): string[] {
  const h = new Date().getHours()
  return [0, 6, 12, 18].map((i) => `${String((h - 23 + i + 48) % 24).padStart(2, '0')}h`).concat('agora')
}

function dayLabel(daysAgo: number): string {
  if (daysAgo === 0) return 'hoje'
  const d = new Date(Date.now() - daysAgo * 86400000)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '').replace(' de ', ' ')
}

export function DashboardView() {
  const agentsWorking = useYui((s) => s.agentsWorking)
  const { data, loading, error } = useApi<Overview>('/api/overview', [], 30000)
  useHeader('System overview · Live', 'Visão geral', [{ label: 'Execuções', fn: () => useYui.getState().show('runs') }])
  if (loading && !data) return <Skeleton rows={3} />
  if (error || !data) return <ErrorNote />

  // série de sucesso: nulos herdam o último valor conhecido
  let last = 100
  const vals = data.success30d.map((v) => (v == null ? last : (last = v)))
  const known = data.success30d.filter((v): v is number => v != null)
  const lo = Math.min(85, ...(known.length ? known.map((v) => v - 2) : [85]))
  const hl = hourLabels()
  const kpis = [
    { l: 'Agentes', v: String(data.agentsTotal), color: C.text },
    { l: 'Ativos', v: String(Math.max(agentsWorking, data.agentsActive)), color: C.cyan },
    { l: 'Runs hoje', v: String(data.runsToday), color: C.text },
    { l: 'Sucesso', v: data.successRate == null ? '—' : `${Math.round(data.successRate)}%`, color: C.ok },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14 }}>
        {kpis.map((k) => <KpiTile key={k.l} label={k.l} value={k.v} color={k.color} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap: 14 }}>
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ fontWeight: 600 }}>Atividade dos agentes</span><span style={{ color: C.t3 }}>últimas 24h</span></div>
          <Bars values={data.bars24h} tips={data.bars24h.map((b) => `${b} execuções`)} label="Execuções por hora nas últimas 24 horas" />
          <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.t3 }}>{hl.map((l) => <span key={l}>{l}</span>)}</div>
        </div>
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ fontWeight: 600 }}>Taxa de sucesso</span><span style={{ color: C.t3 }}>30 dias</span></div>
          <LineArea series={[{ name: 'Sucesso', values: vals }]} area min={lo} max={100} label="Taxa de sucesso nos últimos 30 dias" />
          <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.t3 }}><span>{dayLabel(29)}</span><span>{dayLabel(15)}</span><span>hoje</span></div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Eyebrow style={{ marginBottom: 8 }}>Projetos</Eyebrow>
        {data.projects.length === 0 && <Empty text="Ainda não há projetos no workspace." hint="Diga: “Yui, crie um projeto novo.”" />}
        {data.projects.map((p) => {
          const c = toneColor(p.tone)
          return (
            <button
              key={p.slug}
              onClick={() => useYui.getState().show('project', { project: p.slug })}
              className="hov-row"
              style={{ display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto 60px', alignItems: 'center', gap: 14, padding: '14px 12px', margin: '0 -12px', border: 'none', borderBottom: '1px solid rgba(255,255,255,.05)', background: 'transparent', color: C.text, textAlign: 'left', cursor: 'pointer', borderRadius: 10 }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, boxShadow: `0 0 10px ${c}` }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</span>
                <span style={{ fontSize: 12, color: C.t2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.note}</span>
              </span>
              <span style={{ fontSize: 12, color: c }}>{p.status}</span>
              <span style={{ fontSize: 20, fontWeight: 300, textAlign: 'right' }}>{p.health == null ? '—' : `${p.health}%`}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
