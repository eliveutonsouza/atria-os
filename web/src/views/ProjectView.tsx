import type { ProjectDetail } from '@shared/protocol'
import { useApi } from '../api/useApi'
import { startRun } from '../lib/actions'
import { C, toneColor } from '../lib/colors'
import { useYui, type HeaderAction } from '../store/yui'
import { card, Empty, ErrorNote, Eyebrow, Skeleton, useHeader } from './ui'

export function ProjectView() {
  const slug = useYui((s) => s.viewParams.project ?? s.activeProject)
  const { data, loading, error } = useApi<ProjectDetail>(slug ? `/api/projects/${encodeURIComponent(slug)}` : null, [], 20000)
  const actions: HeaderAction[] = []
  if (data?.hasPreview) actions.push({ label: 'Live preview', fn: () => useYui.getState().show('website', { project: data.slug }) })
  if (data?.hasLogs) actions.push({ label: 'Ver logs', fn: () => useYui.getState().show('logs', { project: data.slug }) })
  if (data?.issue) actions.push({ label: 'Pedir correção', primary: true, fn: () => startRun('backend', data.slug, `Investigue e corrija o problema: ${data.issue}`) })
  useHeader('Projeto', data?.name ?? slug ?? 'Projeto', actions, [data])
  if (!slug) return <Empty text="Nenhum projeto ativo." hint="Diga: “Abre o Stoqmate.”" />
  if (loading && !data) return <Skeleton rows={4} />
  if (error || !data) return <ErrorNote text="Não encontrei esse projeto." />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 1100 }}>
      {data.issue && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 14, background: 'rgba(245,181,74,.07)', border: '1px solid rgba(245,181,74,.25)', color: '#f5c97a', fontSize: 14 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.warn, boxShadow: `0 0 10px ${C.warn}`, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{data.issue}</span>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14 }}>
        {data.kpis.map((k) => (
          <div key={k.label} style={card}>
            <div style={{ fontSize: 12, color: C.t2, marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontSize: 30, fontWeight: 300, letterSpacing: '-.02em', color: toneColor(k.tone) }}>{k.value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Eyebrow style={{ marginBottom: 8 }}>Atividade recente</Eyebrow>
        {data.activity.length === 0 && <Empty text="Ainda não há atividade neste projeto." />}
        {data.activity.map((ac, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '64px 14px minmax(0,1fr)', gap: 12, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.05)', fontSize: 14 }}>
            <span className="mono" style={{ fontSize: 12, color: C.t3 }}>{ac.t}</span>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: toneColor(ac.tone) }} />
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{ac.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
