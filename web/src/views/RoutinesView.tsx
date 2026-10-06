import { useMemo, useState } from 'react'
import '../workflow/workflow.css'
import type { AgentInfo, RoutineInfo, WorkflowDef } from '@shared/protocol'
import { useApi } from '../api/useApi'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { CRON_PRESETS, dayLabel, describeCron, hhmm, send } from '../workflow/http'
import { Empty, ErrorNote, Skeleton, useHeader } from './ui'

// Rotinas agendadas (cron): "Hoje" estilo PRD §85 + gestão (criar/editar/pausar/rodar agora/excluir).

const LAST_C: Record<string, string> = { done: C.ok, failed: C.crit, cancelled: C.t3, running: C.cyan, waiting_approval: C.warn, queued: C.t2 }

const isToday = (iso: string | null) => !!iso && new Date(iso).toDateString() === new Date().toDateString()

export function RoutinesView() {
  const { data, loading, error, reload } = useApi<RoutineInfo[]>('/api/routines', [], 15000)
  const workflows = useApi<WorkflowDef[]>('/api/workflows').data ?? []
  const agents = useApi<AgentInfo[]>('/api/agents').data ?? []
  const [editing, setEditing] = useState<RoutineInfo | 'new' | null>(null)
  const say = useYui.getState().say
  const phone = useYui((s) => s.device === 'phone')

  useHeader('Automações', 'Rotinas', [
    { label: '+ Nova rotina', fn: () => setEditing('new'), primary: true },
    { label: 'Workflows', fn: () => useYui.getState().show('workflows') },
  ])

  const today = useMemo(() => {
    const items: { t: string; at: number; mark: string; color: string; r: RoutineInfo; label: string }[] = []
    for (const r of data ?? []) {
      if (isToday(r.lastRun)) {
        const c = LAST_C[r.lastStatus ?? ''] ?? C.t2
        items.push({ t: hhmm(r.lastRun), at: +new Date(r.lastRun!), mark: r.lastStatus === 'done' ? '✓' : r.lastStatus === 'failed' ? '!' : '●', color: c, r, label: r.lastStatus ?? '' })
      }
      if (r.enabled && isToday(r.nextRun)) items.push({ t: hhmm(r.nextRun), at: +new Date(r.nextRun!), mark: '○', color: C.t3, r, label: 'agendada' })
    }
    return items.sort((a, b) => a.at - b.at)
  }, [data])

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) say(ok)
    } catch (e) {
      say(`Não deu: ${(e as Error).message}.`)
    }
    reload()
  }

  const target = (r: RoutineInfo) =>
    r.workflow ? `workflow · ${workflows.find((w) => w.slug === r.workflow)?.name ?? r.workflow}` : `${agents.find((a) => a.id === r.agentId)?.name ?? r.agentId ?? '—'}${r.project ? ` · ${r.project}` : ''}`

  if (loading && !data) return <Skeleton kpis={0} rows={5} />
  if (error || !data) return <ErrorNote text="Não consegui listar as rotinas." />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26, maxWidth: 1100 }}>
      {editing && <RoutineForm initial={editing === 'new' ? null : editing} workflows={workflows} agents={agents} phone={phone} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}

      <section>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Hoje</div>
        {today.length === 0 ? (
          <div style={{ fontSize: 14, color: C.t3, padding: '10px 0' }}>Nenhuma rotina roda hoje.</div>
        ) : (
          today.map((it, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: phone ? '48px 14px minmax(0,1fr) auto' : '64px 20px minmax(0,1fr) auto', alignItems: 'center', gap: phone ? 8 : 12, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <span className="mono" style={{ fontSize: 13, color: C.t3 }}>{it.t}</span>
              <span style={{ color: it.color, textAlign: 'center' }}>{it.mark}</span>
              <span style={{ fontSize: 15 }}>
                {it.r.name}
                <span style={{ fontSize: 12, color: C.t3 }}> · {target(it.r)}</span>
              </span>
              <span style={{ fontSize: 12, color: it.color }}>{it.label}</span>
            </div>
          ))
        )}
      </section>

      <section>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Todas as rotinas</div>
        {!data.length ? (
          <Empty text="Nenhuma rotina agendada." hint="Agende um workflow ou crie uma rotina simples para um agente." />
        ) : (
          data.map((r) => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: phone ? 'minmax(0,1fr)' : 'minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,.05)', opacity: r.enabled ? 1 : 0.55 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 12.5, color: C.t2, marginTop: 3 }}>
                  {describeCron(r.cron)} <span className="mono" style={{ color: C.t4 }}>({r.cron})</span> · {target(r)}
                </div>
                <div style={{ fontSize: 12, color: C.t3, marginTop: 3 }}>
                  Próxima: {r.enabled ? dayLabel(r.nextRun) : 'pausada'} · Última:{' '}
                  {r.lastRun ? <span style={{ color: LAST_C[r.lastStatus ?? ''] ?? C.t2 }}>{dayLabel(r.lastRun)} ({r.lastStatus})</span> : 'nunca'}
                </div>
              </div>
              {/* celular: ações abaixo do nome, grade 2×2 de 44px */}
              <div style={phone ? { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 6 } : { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button className="wf-btn" onClick={() => void act(() => send('POST', `/api/routines/${r.id}/run`), `Rodando "${r.name}" agora.`)}>Rodar agora</button>
                <button className="wf-btn" onClick={() => void act(() => send('PUT', `/api/routines/${r.id}`, { enabled: !r.enabled }), r.enabled ? 'Rotina pausada.' : 'Rotina reativada.')}>
                  {r.enabled ? 'Pausar' : 'Ativar'}
                </button>
                <button className="wf-btn ghost" onClick={() => setEditing(r)}>Editar</button>
                <button className="wf-btn ghost" style={{ color: '#f39aa4' }} onClick={() => void act(() => send('DELETE', `/api/routines/${r.id}`), 'Rotina removida.')}>Excluir</button>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

function RoutineForm({ initial, workflows, agents, phone, onClose, onSaved }: { initial: RoutineInfo | null; workflows: WorkflowDef[]; agents: AgentInfo[]; phone: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [cron, setCron] = useState(initial?.cron ?? '0 8 * * 1-5')
  const [kind, setKind] = useState<'workflow' | 'agent'>(initial?.agentId ? 'agent' : 'workflow')
  const [workflow, setWorkflow] = useState(initial?.workflow ?? workflows[0]?.slug ?? '')
  const [agentId, setAgentId] = useState(initial?.agentId ?? agents[0]?.id ?? '')
  const [project, setProject] = useState(initial?.project ?? '')
  const [instruction, setInstruction] = useState(initial?.instruction ?? '')
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    const body =
      kind === 'workflow'
        ? { name: name || `Workflow · ${workflows.find((w) => w.slug === workflow)?.name ?? workflow}`, cron, workflowId: workflow, agentId: null, instruction: null, project: null }
        : { name, cron, workflowId: null, agentId, instruction, project: project.trim() || null }
    try {
      await send(initial ? 'PUT' : 'POST', initial ? `/api/routines/${initial.id}` : '/api/routines', body)
      useYui.getState().say(initial ? 'Rotina atualizada.' : `Rotina criada: ${describeCron(cron)}.`)
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div style={{ padding: 18, borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(103,216,242,.2)', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{initial ? 'Editar rotina' : 'Nova rotina'}</span>
        <button className="wf-btn ghost" onClick={onClose}>Fechar</button>
      </div>
      <div style={phone ? { display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 8 } : { display: 'flex', gap: 8 }}>
        <button className="wf-btn" aria-pressed={kind === 'workflow'} style={kind === 'workflow' ? { borderColor: 'rgba(103,216,242,.45)' } : undefined} onClick={() => setKind('workflow')}>Executar workflow</button>
        <button className="wf-btn" aria-pressed={kind === 'agent'} style={kind === 'agent' ? { borderColor: 'rgba(103,216,242,.45)' } : undefined} onClick={() => setKind('agent')}>Instrução para um agente</button>
      </div>
      <label>
        <span className="wf-label">Nome</span>
        <input className="wf-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'workflow' ? 'opcional' : 'Ex.: Checagem de infraestrutura'} />
      </label>
      {kind === 'workflow' ? (
        <label>
          <span className="wf-label">Workflow</span>
          <select className="wf-input" value={workflow} onChange={(e) => setWorkflow(e.target.value)}>
            {workflows.map((w) => (
              <option key={w.slug} value={w.slug}>{w.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: phone ? 'minmax(0,1fr)' : '1fr 1fr', gap: 8 }}>
            <label>
              <span className="wf-label">Agente</span>
              <select className="wf-input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="wf-label">Projeto (opcional)</span>
              <input className="wf-input" value={project} onChange={(e) => setProject(e.target.value)} placeholder="stoqmate" />
            </label>
          </div>
          <label>
            <span className="wf-label">Instrução</span>
            <textarea className="wf-input" rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
          </label>
        </>
      )}
      <div>
        <span className="wf-label">Quando</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {CRON_PRESETS.filter((p) => p.cron).map((p) => (
            <button key={p.label} className="wf-btn" aria-pressed={cron === p.cron} style={cron === p.cron ? { borderColor: 'rgba(103,216,242,.45)', color: '#a9e9f8' } : undefined} onClick={() => setCron(p.cron!)}>
              {p.label}
            </button>
          ))}
          <input className="wf-input wf-mono" aria-label="Cron" value={cron} onChange={(e) => setCron(e.target.value)} style={{ width: phone ? '100%' : 160 }} />
          <span style={{ fontSize: 12, color: C.t3 }}>{describeCron(cron)}</span>
        </div>
      </div>
      {err && <div style={{ fontSize: 12.5, color: C.crit }}>{err}</div>}
      <div>
        <button className="wf-btn primary" onClick={() => void save()} style={phone ? { width: '100%', height: 48 } : undefined}>Salvar rotina</button>
      </div>
    </div>
  )
}
