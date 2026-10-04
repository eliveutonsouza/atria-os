import { useEffect, useMemo, useState } from 'react'
import type { RunEventLine, RunInfo, ViewName, ViewParams } from '@shared/protocol'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { C } from '../../lib/colors'
import { useYui } from '../../store/yui'
import { input } from '../../views/kit'
import { Empty, useHeader } from '../../views/ui'
import { Dot, elapsed, fmtCost, fmtDuration, fmtTokens, openApp, relTime, Tag } from './common'

// Execuções: tabela filtrável (agente, projeto, estado, origem) + detalhe com timeline, eventos e resultado.

const STATE: Record<string, [string, string]> = {
  running: ['rodando', C.cyan],
  queued: ['na fila', C.t2],
  waiting_approval: ['aguardando você', C.warn],
  done: ['concluído', C.ok],
  failed: ['falhou', C.crit],
  cancelled: ['cancelado', C.t3],
}
const origin = (r: RunInfo) => (r.missionId ? 'missão' : r.workflowRunId ? 'workflow' : 'Yui/manual')
const sortKey = (r: RunInfo) => (r.state === 'running' || r.state === 'queued' || r.state === 'waiting_approval' ? '9' : '1') + (r.finishedAt ?? r.startedAt ?? '')

export function RunsPage() {
  const sel = useYui((s) => s.appParams.id)
  const live = useYui((s) => s.runs)
  const { data } = useApi<{ runs: RunInfo[] }>('/api/runs', [], 20000)
  const [q, setQ] = useState('')
  const [agent, setAgent] = useState('')
  const [state, setState] = useState('')
  const [project, setProject] = useState('')
  const [org, setOrg] = useState('')
  useHeader('Execuções', 'Histórico de execuções', [
    { label: 'Operações', fn: () => openApp('ops') },
    { label: 'Missões', fn: () => openApp('missions') },
  ])

  const runs = useMemo(() => {
    const m = new Map<string, RunInfo>()
    for (const r of data?.runs ?? []) m.set(r.id, r)
    for (const r of Object.values(live)) m.set(r.id, { ...m.get(r.id), ...r })
    return [...m.values()].sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
  }, [data, live])

  const agents = [...new Set(runs.map((r) => r.agent))].sort()
  const projects = [...new Set(runs.map((r) => r.project).filter(Boolean) as string[])].sort()
  const n = q.trim().toLowerCase()
  const shown = runs.filter(
    (r) =>
      (!agent || r.agent === agent) &&
      (!state || r.state === state) &&
      (!project || r.project === project) &&
      (!org || origin(r) === org) &&
      (!n || `${r.task} ${r.result ?? ''} ${r.agent}`.toLowerCase().includes(n)),
  )
  const current = runs.find((r) => r.id === sel) ?? null

  const selectStyle = { ...input, height: 34, padding: '0 10px', width: 'auto', minWidth: 120 } as const
  return (
    <>
      <section style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input aria-label="Buscar execuções" placeholder="Buscar tarefa ou resultado…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...input, height: 34, flex: '1 1 220px' }} />
        <select aria-label="Agente" value={agent} onChange={(e) => setAgent(e.target.value)} style={selectStyle}>
          <option value="">Todos os agentes</option>
          {agents.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select aria-label="Estado" value={state} onChange={(e) => setState(e.target.value)} style={selectStyle}>
          <option value="">Todos os estados</option>
          {Object.entries(STATE).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Projeto" value={project} onChange={(e) => setProject(e.target.value)} style={selectStyle}>
          <option value="">Todos os projetos</option>
          {projects.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select aria-label="Origem" value={org} onChange={(e) => setOrg(e.target.value)} style={selectStyle}>
          <option value="">Toda origem</option>
          <option>Yui/manual</option>
          <option>missão</option>
          <option>workflow</option>
        </select>
      </section>
      <div className="app-split" style={{ alignItems: 'flex-start' }}>
        <section className="app-card" style={{ flex: 1, minWidth: 0, padding: 6, width: '100%' }}>
          <div className="app-hide-narrow" style={{ display: 'grid', gridTemplateColumns: '14px 110px minmax(0,1fr) 110px 100px 70px', gap: 12, padding: '8px 10px', fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: C.t3, fontWeight: 600 }}>
            <span />
            <span>Agente</span>
            <span>Tarefa</span>
            <span>Projeto</span>
            <span>Estado</span>
            <span style={{ textAlign: 'right' }}>Quando</span>
          </div>
          {shown.length === 0 && <Empty text="Nenhuma execução com esses filtros." />}
          {shown.map((r) => {
            const [l, c] = STATE[r.state] ?? [r.state, C.t2]
            const on = r.id === sel
            return (
              <button
                key={r.id}
                onClick={() => openApp('runs', r.id)}
                className={on ? undefined : 'app-row'}
                style={{
                  display: 'grid', gridTemplateColumns: '14px 110px minmax(0,1fr) 110px 100px 70px', alignItems: 'center', gap: 12, width: '100%', padding: '10px', border: 'none', borderRadius: 10,
                  background: on ? 'rgba(103,216,242,.07)' : 'transparent', color: C.text, textAlign: 'left', cursor: 'pointer', fontSize: 13,
                }}
              >
                <Dot c={c} size={7} pulse={r.state === 'running'} />
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.agent}</span>
                <span style={{ color: '#c9cde0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.task}</span>
                <span className="app-mono" style={{ fontSize: 11.5, color: C.t2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.project ?? '—'}</span>
                <span style={{ fontSize: 12, color: c }}>{r.state === 'running' ? `${l} ${r.progress}%` : l}</span>
                <span className="app-mono" style={{ fontSize: 11, color: C.t3, textAlign: 'right' }}>{r.state === 'running' ? elapsed(r.startedAt) : relTime(r.finishedAt ?? r.startedAt)}</span>
              </button>
            )
          })}
        </section>
        {current && <RunDetail run={current} />}
      </div>
    </>
  )
}

function RunDetail({ run }: { run: RunInfo }) {
  const [lines, setLines] = useState<RunEventLine[] | null>(null)
  const [tech, setTech] = useState(false)
  useEffect(() => {
    setLines(null)
    api.get<RunEventLine[]>(`/api/runs/${run.id}/events`).then(setLines).catch(() => setLines([]))
  }, [run.id, run.state, run.progress])
  const [l, c] = STATE[run.state] ?? [run.state, C.t2]
  const active = run.state === 'running' || run.state === 'queued' || run.state === 'waiting_approval'
  const openResult = () =>
    api
      .get<{ view: ViewName; params: ViewParams }>(`/api/runs/${run.id}/result-view`)
      .then((rv) => useYui.getState().show(rv.view, rv.params))
      .catch(() => useYui.getState().say('Essa execução não deixou uma tela para mostrar.'))
  const dur = run.startedAt ? (run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now()) - new Date(run.startedAt).getTime() : null
  return (
    <aside style={{ width: 420, maxWidth: '100%', flexShrink: 0, padding: '18px 20px', borderRadius: 18, background: 'linear-gradient(180deg, rgba(20,24,50,.62), rgba(12,14,32,.62))', border: '1px solid rgba(160,170,255,.11)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, letterSpacing: '.16em', color: c, fontWeight: 600 }}>{l.toUpperCase()}</span>
        <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35 }}>{run.task}</span>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Tag>{run.agent}</Tag>
          {run.project && <Tag color={C.t2} bg="rgba(255,255,255,.05)">{run.project}</Tag>}
          <Tag color={C.lav} bg="rgba(166,140,247,.1)">{origin(run)}</Tag>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, fontSize: 12 }}>
        {[
          ['Duração', fmtDuration(dur)],
          ['Tokens', fmtTokens(run.tokensIn + run.tokensOut)],
          ['Custo', fmtCost(run.costUsd)],
        ].map(([k, v]) => (
          <div key={k} style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
            <div style={{ color: C.t2, fontSize: 11 }}>{k}</div>
            <div style={{ fontSize: 18, fontWeight: 300 }}>{v}</div>
          </div>
        ))}
      </div>
      {run.currentOp && active && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Operação atual</div>
          <div className="app-mono" style={{ fontSize: 12.5, color: C.lav }}>{run.currentOp}</div>
        </div>
      )}
      {run.steps.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Timeline</div>
          {run.steps.map((st, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '4px 0', fontSize: 13, color: st.status === 'pending' ? C.t3 : C.text }}>
              <span style={{ width: 16, textAlign: 'center', color: st.status === 'done' ? C.ok : st.status === 'active' ? C.cyan : C.t3 }}>{st.status === 'done' ? '✓' : st.status === 'active' ? '●' : '○'}</span>
              {st.label}
            </div>
          ))}
        </div>
      )}
      {run.tools.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {run.tools.map((t) => <span key={t} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, background: 'rgba(103,216,242,.08)', border: '1px solid rgba(103,216,242,.18)', color: '#a9e9f8' }}>{t}</span>)}
        </div>
      )}
      {run.result && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Resultado</div>
          <div style={{ fontSize: 13, color: '#d6d9e8', lineHeight: 1.55, whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>{run.result}</div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {run.state === 'done' && <button className="app-btn small" onClick={() => void openResult()}>Ver resultado</button>}
        {run.missionId && <button className="app-btn small" onClick={() => openApp('missions', run.missionId!)}>Ver missão</button>}
        <button className="app-btn small" onClick={() => setTech(!tech)}>{tech ? 'Ocultar detalhes técnicos' : 'Detalhes técnicos'}</button>
        {active && (
          <button className="app-btn small danger" onClick={() => void api.post(`/api/runs/${run.id}/cancel`).catch(() => {})}>
            Cancelar
          </button>
        )}
      </div>
      {tech && (
        <div className="app-mono" style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(0,0,0,.35)', border: '1px solid rgba(255,255,255,.06)', fontSize: 11.5, lineHeight: 1.7, color: C.t2, maxHeight: 320, overflowY: 'auto' }}>
          <div>session {run.sessionId ?? '—'}</div>
          {(lines ?? []).slice(-60).map((ln, i) => (
            <div key={i} style={{ color: ln.kind === 'error' ? '#f6b3ba' : ln.kind === 'tool' ? '#c9cde0' : C.t2 }}>
              {ln.kind === 'error' ? '! ' : ''}
              {ln.text}
            </div>
          ))}
          {lines === null && <div>carregando…</div>}
        </div>
      )}
    </aside>
  )
}
