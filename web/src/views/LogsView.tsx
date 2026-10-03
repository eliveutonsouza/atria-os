import type { LogsPayload } from '@shared/protocol'
import { useApi } from '../api/useApi'
import { startRun } from '../lib/actions'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { Empty, ErrorNote, Skeleton, useHeader } from './ui'

const LVL: Record<string, string> = { ERROR: C.crit, WARN: C.warn, INFO: C.t3, DEBUG: C.t4 }

export function LogsView() {
  const slug = useYui((s) => s.viewParams.project ?? s.activeProject)
  const { data, loading, error } = useApi<LogsPayload>(slug ? `/api/projects/${encodeURIComponent(slug)}/logs` : null, [], 15000)
  const hasErr = !!data?.lines.some((l) => l.level === 'ERROR')
  useHeader('Logs · produção', data?.source ?? slug ?? 'Logs', hasErr && slug ? [{ label: 'Pedir correção', fn: () => startRun('backend', slug, `Analise os erros recentes nos logs de ${data?.source} e corrija a causa.`) }] : [], [data])
  if (!slug) return <Empty text="Qual projeto? Diga: “Mostra os erros do Stoqmate.”" />
  if (loading && !data) return <Skeleton kpis={0} rows={8} />
  if (error || !data) return <ErrorNote text="Não consegui ler os logs desse projeto." />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {data.summary && <div style={{ fontSize: 14, color: C.t2, maxWidth: 720, textWrap: 'pretty' }}>{data.summary}</div>}
      {data.lines.length === 0 ? (
        <Empty text="Nenhuma linha de log recente." />
      ) : (
        <div className="mono" style={{ padding: '16px 18px', borderRadius: 14, background: 'rgba(0,0,0,.4)', border: '1px solid rgba(255,255,255,.06)', fontSize: 12.5, lineHeight: 1.85, overflowX: 'auto' }}>
          {data.lines.map((ln, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, whiteSpace: 'nowrap' }}>
              <span style={{ color: C.t4 }}>{ln.t}</span>
              <span style={{ width: 44, flexShrink: 0, color: LVL[ln.level] ?? C.t3 }}>{ln.level}</span>
              <span style={{ color: ln.level === 'ERROR' ? '#f6b3ba' : '#c9cde0' }}>{ln.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
