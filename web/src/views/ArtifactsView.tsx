import type { ArtifactInfo } from '@shared/protocol'
import { useApi } from '../api/useApi'
import { C } from '../lib/colors'
import { ago } from '../lib/format'
import { useYui } from '../store/yui'
import { Empty, ErrorNote, Skeleton, useHeader } from './ui'

const KIND: Record<ArtifactInfo['kind'], string> = { website: 'Site', report: 'Relatório', chart: 'Gráfico', table: 'Tabela', html: 'Página', image: 'Imagem', other: 'Arquivo' }

function open(a: ArtifactInfo) {
  const s = useYui.getState()
  if (a.kind === 'report') s.show('report', { artifactId: a.id })
  else if (a.url) s.show('website', { artifactId: a.id, project: a.project ?? undefined })
}

export function ArtifactsView() {
  const { data, loading, error } = useApi<ArtifactInfo[]>('/api/artifacts')
  useHeader('Artifacts', 'Artefatos')
  if (loading && !data) return <Skeleton kpis={0} rows={5} />
  if (error || !data) return <ErrorNote />
  if (!data.length) return <Empty text="Ainda não há artefatos." hint="Sites, relatórios e apresentações dos agentes aparecem aqui." />
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 14 }}>
      {data.map((a) => (
        <button key={a.id} onClick={() => open(a)} className="hov-bg2" style={{ textAlign: 'left', padding: '18px 20px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', color: C.text, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="eyebrow" style={{ color: C.cyan }}>{KIND[a.kind]}</span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{a.title}</span>
          <span style={{ fontSize: 12, color: C.t3 }}>{a.project ? `${a.project} · ` : ''}{ago(a.createdAt)}</span>
        </button>
      ))}
    </div>
  )
}
