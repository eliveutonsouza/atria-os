import type { LogsPayload, Overview } from '@shared/protocol'
import { useApi } from '../../api/useApi'
import { startRun } from '../../lib/actions'
import { C } from '../../lib/colors'
import { useYui } from '../../store/yui'
import { InfraView } from '../../views/InfraView'
import { useHeader } from '../../views/ui'
import { Card, openApp } from './common'

// Infra & logs: saúde da VPS (InfraView) + logs do container de cada projeto.

const LVL: Record<string, string> = { ERROR: C.crit, WARN: C.warn, INFO: C.t3, DEBUG: C.t4 }

export function InfraPage() {
  const sel = useYui((s) => s.appParams.id)
  const ov = useApi<Overview>('/api/overview', [], 60000)
  const projects = ov.data?.projects ?? []
  const slug = sel ?? null
  const logs = useApi<LogsPayload>(slug ? `/api/projects/${encodeURIComponent(slug)}/logs` : null, [slug], 15000)
  useHeader('Infra & logs', 'Minha VPS', [{ label: 'Terminal', fn: () => openApp('terminal') }])
  const hasErr = !!logs.data?.lines.some((l) => l.level === 'ERROR')
  return (
    <>
      <InfraView />
      <Card
        title="Logs por projeto"
        right={
          <select
            aria-label="Projeto"
            value={slug ?? ''}
            onChange={(e) => openApp('infra', e.target.value || undefined)}
            style={{ height: 30, borderRadius: 8, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)', color: C.text, padding: '0 8px', fontSize: 12 }}
          >
            <option value="">Escolha um projeto…</option>
            {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        }
      >
        {!slug && <span className="app-muted">Escolha um projeto para ver os logs do container dele.</span>}
        {slug && logs.data?.summary && <div style={{ fontSize: 13, color: C.t2 }}>{logs.data.summary}</div>}
        {slug && hasErr && (
          <div>
            <button className="app-btn small" onClick={() => void startRun('backend', slug, `Analise os erros recentes nos logs de ${logs.data?.source} e corrija a causa.`)}>Pedir correção ao Backend</button>
          </div>
        )}
        {slug && (logs.data?.lines.length ?? 0) > 0 && (
          <div className="app-mono" style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(0,0,0,.4)', border: '1px solid rgba(255,255,255,.06)', fontSize: 12, lineHeight: 1.8, overflowX: 'auto', maxHeight: 460, overflowY: 'auto' }}>
            {logs.data!.lines.map((ln, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, whiteSpace: 'nowrap' }}>
                <span style={{ color: C.t4 }}>{ln.t}</span>
                <span style={{ width: 44, flexShrink: 0, color: LVL[ln.level] ?? C.t3 }}>{ln.level}</span>
                <span style={{ color: ln.level === 'ERROR' ? '#f6b3ba' : '#c9cde0' }}>{ln.msg}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
