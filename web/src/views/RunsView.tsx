import { useEffect, useMemo, useState } from 'react'
import type { RunEventLine, RunInfo, ViewName, ViewParams } from '@shared/protocol'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { C } from '../lib/colors'
import { elapsed, fmtTokens } from '../lib/format'
import { useYui } from '../store/yui'
import { Empty, ErrorNote, Skeleton, useHeader } from './ui'

interface RunsResp { running: number; queued: number; background: number; runs: RunInfo[] }

function runLook(r: RunInfo, now: number) {
  switch (r.state) {
    case 'running': return { color: C.cyan, time: r.startedAt ? elapsed(r.startedAt, now) : `${Math.round(r.progress)}%`, hollow: false }
    case 'waiting_approval': return { color: C.warn, time: 'aprovação', hollow: false }
    case 'done': return { color: C.ok, time: 'concluído', hollow: false }
    case 'failed': return { color: C.crit, time: 'falhou', hollow: false }
    case 'cancelled': return { color: C.t3, time: 'cancelado', hollow: true }
    default: return { color: C.t3, time: 'em espera', hollow: true }
  }
}

function TechLines({ run }: { run: RunInfo }) {
  const phone = useYui((s) => s.device === 'phone')
  const [lines, setLines] = useState<RunEventLine[] | null>(null)
  useEffect(() => {
    let alive = true
    api.get<RunEventLine[]>(`/api/runs/${run.id}/events`).then((l) => alive && setLines(l)).catch(() => alive && setLines([]))
    return () => { alive = false }
  }, [run.id, run.state, run.progress])
  const head = [`session ${run.sessionId ?? '—'} · claude-code`]
  const tail = [`tokens: ${fmtTokens(run.tokensIn)} in · ${fmtTokens(run.tokensOut)} out${run.costUsd ? ` · $${run.costUsd.toFixed(2)}` : ''}`]
  const body = (lines ?? []).slice(-40).map((l) => (l.kind === 'tool' ? l.text : l.kind === 'error' ? `! ${l.text}` : l.text))
  return (
    <div className="mono" style={{ margin: phone ? '0 14px 14px' : '0 18px 18px 46px', padding: '14px 16px', borderRadius: 12, background: 'rgba(0,0,0,.35)', border: '1px solid rgba(255,255,255,.06)', fontSize: 12, lineHeight: 1.8, color: C.t2, maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {[...head, ...(lines === null ? ['carregando…'] : body), ...tail].map((t, i) => <div key={i}>{t}</div>)}
    </div>
  )
}

const resultBtn = { height: 30, padding: '0 12px', borderRadius: 9, border: '1px solid rgba(103,216,242,.3)', background: 'rgba(103,216,242,.08)', color: '#a9e9f8', fontSize: 12, cursor: 'pointer' } as const

// Abre o que a execução produziu (tela sob medida, preview, relatório ou missão).
function openResult(id: string) {
  api
    .get<{ view: ViewName; params: ViewParams }>(`/api/runs/${id}/result-view`)
    .then((rv) => useYui.getState().show(rv.view, rv.params))
    .catch(() => {})
}

export function RunsView() {
  const phone = useYui((s) => s.device === 'phone')
  const runsMap = useYui((s) => s.runs)
  const expanded = useYui((s) => s.expandedRun)
  const tech = useYui((s) => s.tech)
  const { data, loading, error } = useApi<RunsResp>('/api/runs')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    if (!data) return
    const s = useYui.getState()
    const merged = { ...s.runs }
    for (const r of data.runs) if (!merged[r.id]) merged[r.id] = r
    s.set({ runs: merged })
  }, [data])
  // pedido de uma execução específica (/runs/:id, "Ver execução") expande ela
  const wanted = useYui((s) => s.viewParams.runId)
  useEffect(() => {
    if (wanted) useYui.getState().set({ expandedRun: wanted })
  }, [wanted])
  // como no design: abre já com a primeira execução ativa expandida
  useEffect(() => {
    const s = useYui.getState()
    if (s.expandedRun && s.runs[s.expandedRun]) return
    const first = Object.values(s.runs).find((r) => r.state === 'running')
    if (first) s.set({ expandedRun: first.id })
  }, [runsMap])
  useHeader('Live operations', 'Execuções', [
    { label: tech ? 'Ocultar detalhes técnicos' : 'Detalhes técnicos', fn: () => useYui.getState().set({ tech: !useYui.getState().tech }) },
  ], [tech])

  const runs = useMemo(() => {
    const order: Record<string, number> = { running: 0, waiting_approval: 1, queued: 2, done: 3, failed: 3, cancelled: 4 }
    return Object.values(runsMap).sort((a, b) => (order[a.state] - order[b.state]) || (b.startedAt ?? '').localeCompare(a.startedAt ?? '')).slice(0, 40)
  }, [runsMap])

  if (loading && !data && !runs.length) return <Skeleton kpis={3} rows={4} />
  if (error && !runs.length) return <ErrorNote />
  const running = runs.filter((r) => r.state === 'running').length
  const queued = runs.filter((r) => r.state === 'queued').length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', gap: phone ? 24 : 36, flexWrap: 'wrap' }}>
        <div><div className="eyebrow">RUNNING</div><div style={{ fontSize: 36, fontWeight: 300, color: C.cyan }}>{running}</div></div>
        <div><div className="eyebrow">QUEUED</div><div style={{ fontSize: 36, fontWeight: 300 }}>{queued}</div></div>
        <div><div className="eyebrow">BACKGROUND</div><div style={{ fontSize: 36, fontWeight: 300, color: C.t2 }}>{data?.background ?? 0}</div></div>
      </div>
      {!runs.length && <Empty text="Ainda não há execuções para mostrar." hint="Peça algo para a Yui e os agentes acordam." />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {runs.map((r) => {
          const ex = expanded === r.id
          const lk = runLook(r, now)
          return (
            <div key={r.id} style={{ borderRadius: 16, background: ex ? 'rgba(255,255,255,.045)' : 'rgba(255,255,255,.02)', border: `1px solid ${ex ? 'rgba(103,216,242,.22)' : 'rgba(255,255,255,.06)'}`, overflow: 'hidden', transition: 'all .3s' }}>
              <button
                aria-expanded={ex}
                onClick={() => useYui.getState().set({ expandedRun: ex ? null : r.id })}
                style={{ width: '100%', display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto', alignItems: 'center', gap: phone ? 10 : 14, padding: phone ? 14 : '16px 18px', minHeight: 44, border: 'none', background: 'transparent', color: C.text, textAlign: 'left', cursor: 'pointer' }}
              >
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: lk.hollow ? 'transparent' : lk.color, border: `1px solid ${lk.color}`, boxShadow: lk.hollow ? 'none' : `0 0 10px ${lk.color}` }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{r.agent}</span>
                  <span style={{ fontSize: 13, color: C.t2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.task}</span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  <span className="mono" style={{ fontSize: 13, color: lk.color }}>{lk.time}</span>
                  <span style={{ width: phone ? 60 : 90, height: 3, borderRadius: 2, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${r.state === 'done' ? 100 : Math.round(r.progress)}%`, background: lk.color, transition: 'width .35s' }} />
                  </span>
                </span>
              </button>
              {ex && (
                <>
                  <div style={{ padding: phone ? '4px 14px 14px' : '4px 18px 18px 46px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(220px,100%),1fr))', gap: phone ? 16 : 20 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div className="eyebrow" style={{ letterSpacing: '.16em', fontSize: 11 }}>OPERAÇÃO ATUAL</div>
                      <div className="mono" style={{ fontSize: 13, color: C.lav, wordBreak: 'break-word' }}>{r.currentOp ?? (r.result ? r.result.slice(0, 240) : '—')}</div>
                      <div className="eyebrow" style={{ letterSpacing: '.16em', fontSize: 11, marginTop: 10 }}>FERRAMENTAS</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {r.tools.length === 0 && <span style={{ fontSize: 12, color: C.t3 }}>—</span>}
                        {r.tools.map((tl) => (
                          <span key={tl} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, background: 'rgba(103,216,242,.08)', border: '1px solid rgba(103,216,242,.18)', color: '#a9e9f8' }}>{tl}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div className="eyebrow" style={{ letterSpacing: '.16em', fontSize: 11, marginBottom: 6 }}>TIMELINE</div>
                      {r.steps.length === 0 && <span style={{ fontSize: 13, color: C.t3 }}>Sem etapas ainda.</span>}
                      {r.steps.map((st, i) => {
                        const c = st.status === 'done' ? C.ok : st.status === 'active' ? C.cyan : C.t3
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 13, color: st.status === 'pending' ? C.t3 : C.text }}>
                            <span style={{ width: 16, textAlign: 'center', color: c }}>{st.status === 'done' ? '✓' : st.status === 'active' ? '●' : '○'}</span>
                            {st.label}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  {(r.state === 'done' || r.state === 'failed') && (
                    <div style={{ padding: phone ? '0 14px 14px' : '0 18px 18px 46px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {r.result && (
                        <div style={{ fontSize: 13, color: '#d6d9e8', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 220, overflowY: 'auto' }}>{r.result}</div>
                      )}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button onClick={() => openResult(r.id)} style={phone ? { ...resultBtn, height: 44 } : resultBtn}>Ver resultado</button>
                        {r.missionId && <button onClick={() => useYui.getState().show('mission', { missionId: r.missionId! })} style={phone ? { ...resultBtn, height: 44 } : resultBtn}>Ver missão</button>}
                      </div>
                    </div>
                  )}
                  {tech && <TechLines run={r} />}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
