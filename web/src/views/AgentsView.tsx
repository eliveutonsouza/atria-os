import type { AgentConfig, AgentInfo } from '@shared/protocol'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { C } from '../lib/colors'
import { ago } from '../lib/format'
import { useYui } from '../store/yui'
import { ErrorNote, Empty, Skeleton, useHeader } from './ui'

const GROUP_ORDER = ['Engineering', 'Design', 'Operações', 'Growth']

async function newAgent() {
  try {
    const a = await api.post<AgentConfig>('/api/agents', { name: 'Novo agente', description: 'Descreva a especialidade', group: 'Geral', prompt: 'Instruções de trabalho do agente.' })
    if (a) useYui.getState().show('agent', { agentId: a.id })
  } catch {
    useYui.getState().say('Não consegui criar o agente agora.', { state: 'warning' })
  }
}

export function AgentsView() {
  const narrow = useYui((s) => s.narrow)
  const agentsWorking = useYui((s) => s.agentsWorking)
  const { data, loading, error } = useApi<AgentInfo[]>('/api/agents', [agentsWorking], 15000)
  useHeader('Equipe de agentes', 'Agentes', [
    { label: '+ Novo agente', fn: () => void newAgent(), primary: true },
    { label: 'Ferramentas', fn: () => useYui.getState().show('tools') },
    { label: 'Execuções', fn: () => useYui.getState().show('runs') },
  ])
  if (loading && !data) return <Skeleton kpis={0} rows={8} />
  if (error || !data) return <ErrorNote />
  if (!data.length) return <Empty text="Nenhum agente configurado ainda." hint="Os agentes ficam em /workspace/.claude/agents." />
  const running = data.filter((a) => a.status === 'running').length
  const sleeping = data.filter((a) => a.status === 'sleeping').length
  const groups = [...new Set(data.map((a) => a.group))].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div style={{ display: 'flex', gap: narrow ? '12px 24px' : 40, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div><span style={{ fontSize: narrow ? 40 : 48, fontWeight: 300, letterSpacing: '-.03em' }}>{data.length}</span><span style={{ fontSize: 13, color: C.t2, marginLeft: 10 }}>configurados</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: C.cyan, boxShadow: `0 0 10px ${C.cyan}` }} />{running} trabalhando</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: C.t2 }}><span style={{ width: 8, height: 8, borderRadius: '50%', border: `1px solid ${C.t3}` }} />{sleeping} dormindo</div>
      </div>
      {groups.map((g) => (
        <div key={g} style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="eyebrow" style={{ paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,.08)' }}>{g}</div>
          {data.filter((a) => a.group === g).map((ag) => {
            const run = ag.status === 'running'
            const wait = ag.status === 'waiting'
            const dot = run ? C.cyan : wait ? C.warn : 'transparent'
            return (
              <div
                key={ag.id}
                role="button"
                tabIndex={0}
                title={`Abrir ${ag.name}`}
                onClick={() => useYui.getState().show('agent', { agentId: ag.id })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') useYui.getState().show('agent', { agentId: ag.id })
                }}
                className="hov-row"
                style={{ cursor: 'pointer', borderRadius: 8, display: 'grid', gridTemplateColumns: narrow ? '30px minmax(0,1fr) auto' : '30px minmax(80px,160px) minmax(0,1fr) minmax(0,100px) minmax(0,100px)', minWidth: 0, alignItems: 'center', gap: narrow ? 12 : 14, padding: '12px 0', minHeight: 44, borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: 14 }}>
                <span style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, boxShadow: `0 0 10px ${dot}` }} />
                </span>
                {narrow ? (
                  // celular: nome + tarefa empilhados, só a última atividade à direita
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{ag.name}</span>
                    <span style={{ fontSize: 12.5, color: run ? C.text : C.t3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ag.task ?? (wait ? 'Em espera' : 'Dormindo')}</span>
                  </span>
                ) : (
                  <>
                    <span style={{ fontWeight: 600 }}>{ag.name}</span>
                    <span style={{ color: run ? C.text : C.t3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ag.task ?? (wait ? 'Em espera' : 'Dormindo')}</span>
                  </>
                )}
                <span style={{ fontSize: 12, color: C.t3, whiteSpace: 'nowrap' }}>{ago(ag.lastActivity)}</span>
                {!narrow && <span className="mono" style={{ fontSize: 12, color: C.t3 }}>{ag.nextWake ?? '—'}</span>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
