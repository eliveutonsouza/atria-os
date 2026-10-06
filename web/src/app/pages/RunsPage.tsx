import { useEffect, useMemo, useState } from 'react'
import type { RunEventLine, RunInfo, ViewName, ViewParams } from '@shared/protocol'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { C } from '../../lib/colors'
import { useYui } from '../../store/yui'
import { input } from '../../views/kit'
import { ConfirmDeleteModal, Empty, useHeader } from '../../views/ui'
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
const isActive = (r: RunInfo) => r.state === 'running' || r.state === 'queued' || r.state === 'waiting_approval'
const PURGE_DAYS = [7, 30, 90]

// Tira execuções apagadas do estado vivo (não há evento de exclusão no SSE).
function dropLive(keep: (r: RunInfo) => boolean) {
  const s = useYui.getState()
  s.set({ runs: Object.fromEntries(Object.entries(s.runs).filter(([, r]) => keep(r))) })
}

const sortKey = (r: RunInfo) => (r.state === 'running' || r.state === 'queued' || r.state === 'waiting_approval' ? '9' : '1') + (r.finishedAt ?? r.startedAt ?? '')

export function RunsPage() {
  const device = useYui((s) => s.device)
  const narrow = device === 'phone'
  const tablet = device === 'tablet'
  const sel = useYui((s) => s.appParams.id)
  const live = useYui((s) => s.runs)
  const { data, reload } = useApi<{ runs: RunInfo[] }>('/api/runs', [], 20000)
  // páginas antigas ("Carregar mais") e execuções apagadas nesta tela
  const [older, setOlder] = useState<RunInfo[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [purgePick, setPurgePick] = useState(false)
  const [purgeDays, setPurgeDays] = useState<number | null>(null)
  const [purging, setPurging] = useState(false)
  const [q, setQ] = useState('')
  const [agent, setAgent] = useState('')
  const [state, setState] = useState('')
  const [project, setProject] = useState('')
  const [org, setOrg] = useState('')
  useHeader('Execuções', 'Histórico de execuções', [
    { label: 'Operações', fn: () => openApp('ops') },
    { label: 'Missões', fn: () => openApp('missions') },
    { label: 'Limpar antigas', fn: () => setPurgePick(true), danger: true },
  ])

  const runs = useMemo(() => {
    const m = new Map<string, RunInfo>()
    for (const r of older) m.set(r.id, r)
    for (const r of data?.runs ?? []) m.set(r.id, r)
    for (const r of Object.values(live)) m.set(r.id, { ...m.get(r.id), ...r })
    for (const id of removed) m.delete(id)
    return [...m.values()].sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
  }, [data, live, older, removed])

  const loadMore = async () => {
    // 1ª página extra: parte da execução mais antiga já carregada (duplicatas são descartadas no Map)
    const loaded = runs.map((r) => r.startedAt ?? r.finishedAt).filter(Boolean) as string[]
    const before = cursor ?? loaded.sort()[0] ?? null
    setLoadingMore(true)
    try {
      const r = await api.get<{ runs: RunInfo[]; hasMore: boolean; next: string | null }>(`/api/runs/page?limit=40${before ? `&before=${encodeURIComponent(before)}` : ''}`)
      setOlder((o) => [...o, ...r.runs])
      setCursor(r.next)
      setHasMore(r.hasMore)
    } catch {
      useYui.getState().say('Não consegui carregar execuções mais antigas agora.')
    }
    setLoadingMore(false)
  }

  const purge = async (days: number) => {
    setPurging(true)
    try {
      const r = await api.post<{ deleted: number }>('/api/runs/purge', { olderThanDays: days })
      const cutoff = Date.now() - days * 86400_000
      const old = (r: RunInfo) => !isActive(r) && new Date(r.finishedAt ?? r.startedAt ?? Date.now()).getTime() < cutoff
      dropLive((x) => !old(x))
      setOlder((o) => o.filter((x) => !old(x)))
      reload()
      useYui.getState().say(r.deleted ? `Apaguei ${r.deleted} execuç${r.deleted > 1 ? 'ões' : 'ão'} com mais de ${days} dias.` : `Nenhuma execução com mais de ${days} dias.`)
      setPurgeDays(null)
    } catch (e) {
      useYui.getState().say(`Não consegui limpar: ${(e as Error).message}.`)
    }
    setPurging(false)
  }

  const onDeleted = (id: string) => {
    setRemoved((s) => new Set(s).add(id))
    dropLive((r) => r.id !== id)
    openApp('runs')
  }

  const purgeUi = (
    <>
      {purgePick && (
        <section className="app-card" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '12px 14px' }}>
          <span style={{ fontSize: 13, color: C.t2, flex: narrow ? '1 1 100%' : '0 1 auto' }}>Apagar execuções terminadas há mais de</span>
          {PURGE_DAYS.map((d) => (
            <button key={d} className="app-btn small" style={narrow ? { flex: 1, minHeight: 44 } : undefined} onClick={() => { setPurgePick(false); setPurgeDays(d) }}>{d} dias</button>
          ))}
          <button className="app-btn small" style={narrow ? { flex: '1 1 100%', minHeight: 44 } : undefined} onClick={() => setPurgePick(false)}>Cancelar</button>
        </section>
      )}
      {purgeDays !== null && (
        <ConfirmDeleteModal
          title={`Apagar execuções com mais de ${purgeDays} dias?`}
          text="Apaga do histórico as execuções concluídas, com falha ou canceladas, com eventos e resultado. Execuções rodando, na fila ou aguardando você ficam."
          rows={[{ label: 'Mais antigas que', value: new Date(Date.now() - purgeDays * 86400_000).toLocaleDateString('pt-BR') }]}
          busy={purging}
          onCancel={() => setPurgeDays(null)}
          onConfirm={() => void purge(purgeDays)}
        />
      )}
    </>
  )

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
  // celular: execução aberta ocupa a tela toda (sem filtros nem lista)
  if (narrow && current) return <RunDetail run={current} full onDeleted={onDeleted} />
  return (
    <>
      {purgeUi}
      <section className={narrow ? 'app-filters-narrow' : undefined} style={narrow ? undefined : { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input aria-label="Buscar execuções" placeholder="Buscar tarefa ou resultado…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...input, height: narrow ? 42 : 34, flex: '1 1 220px' }} />
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
        <section className={narrow ? undefined : 'app-card'} style={{ flex: 1, minWidth: 0, padding: narrow ? 0 : 6, width: '100%' }}>
          <div className="app-hide-narrow" style={{ display: tablet ? 'none' : 'grid', gridTemplateColumns: '14px 110px minmax(0,1fr) 110px 100px 70px', gap: 12, padding: '8px 10px', fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: C.t3, fontWeight: 600 }}>
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
              narrow ? (
                // Celular: cartão compacto em 2 linhas (estado + tarefa · agente e tempo) com chevron, sem colunas fixas.
                <button
                  key={r.id}
                  onClick={() => openApp('runs', r.id)}
                  className="app-row"
                  style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 12px', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, padding: 14, marginBottom: 8, border: '1px solid rgba(255,255,255,.07)', borderRadius: 16, background: 'rgba(255,255,255,.035)', color: C.text, textAlign: 'left', cursor: 'pointer' }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Dot c={c} size={7} pulse={r.state === 'running'} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.task}</span>
                      <span style={{ fontSize: 12, color: c, whiteSpace: 'nowrap' }}>{r.state === 'running' ? `${l} ${r.progress}%` : l}</span>
                    </span>
                    <span className="app-mono" style={{ fontSize: 11.5, color: C.t3, paddingLeft: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.agent}{r.project ? ` · ${r.project}` : ''} · {r.state === 'running' ? elapsed(r.startedAt) : relTime(r.finishedAt ?? r.startedAt)}
                    </span>
                  </span>
                  <span aria-hidden style={{ fontSize: 22, color: C.t3, lineHeight: 1 }}>›</span>
                </button>
              ) : tablet ? (
                // Tablet: só ponto, tarefa e estado (o detalhe fica ao lado)
                <button
                  key={r.id}
                  onClick={() => openApp('runs', r.id)}
                  className={on ? undefined : 'app-row'}
                  style={{ display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, padding: '10px', border: 'none', borderRadius: 10, background: on ? 'rgba(103,216,242,.07)' : 'transparent', color: C.text, textAlign: 'left', cursor: 'pointer', fontSize: 13 }}
                >
                  <Dot c={c} size={7} pulse={r.state === 'running'} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ color: '#c9cde0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.task}</span>
                    <span className="app-mono" style={{ fontSize: 11, color: C.t3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.agent} · {r.state === 'running' ? elapsed(r.startedAt) : relTime(r.finishedAt ?? r.startedAt)}</span>
                  </span>
                  <span style={{ fontSize: 12, color: c, whiteSpace: 'nowrap' }}>{r.state === 'running' ? `${l} ${r.progress}%` : l}</span>
                </button>
              ) : (
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
            )
          })}
          {hasMore && runs.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
              <button className="app-btn small" disabled={loadingMore} style={narrow ? { width: '100%', minHeight: 44, justifyContent: 'center' } : undefined} onClick={() => void loadMore()}>
                {loadingMore ? 'Carregando…' : 'Carregar mais'}
              </button>
            </div>
          )}
        </section>
        {current && <RunDetail run={current} onDeleted={onDeleted} />}
      </div>
    </>
  )
}

function RunDetail({ run, full = false, onDeleted }: { run: RunInfo; full?: boolean; onDeleted: (id: string) => void }) {
  const tablet = useYui((s) => s.device === 'tablet')
  const [lines, setLines] = useState<RunEventLine[] | null>(null)
  const [tech, setTech] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const remove = async () => {
    setBusy(true)
    try {
      await api.del(`/api/runs/${run.id}`)
      setConfirm(false)
      onDeleted(run.id)
      useYui.getState().say('Execução excluída.')
    } catch (e) {
      useYui.getState().say(`Não consegui excluir: ${(e as Error).message}.`)
    }
    setBusy(false)
  }
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
    <aside style={{ width: full ? '100%' : tablet ? 340 : 420, maxWidth: '100%', flexShrink: 0, minWidth: 0, padding: full ? 14 : '18px 20px', borderRadius: 18, background: 'linear-gradient(180deg, rgba(20,24,50,.62), rgba(12,14,32,.62))', border: '1px solid rgba(160,170,255,.11)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, letterSpacing: '.16em', color: c, fontWeight: 600 }}>{l.toUpperCase()}</span>
        <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{run.task}</span>
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
          <div style={{ fontSize: 13, color: '#d6d9e8', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: full ? undefined : 260, overflowY: 'auto' }}>{run.result}</div>
        </div>
      )}
      <div style={full ? { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 } : { display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {run.state === 'done' && <button className="app-btn small" onClick={() => void openResult()}>Ver resultado</button>}
        {run.missionId && <button className="app-btn small" onClick={() => openApp('missions', run.missionId!)}>Ver missão</button>}
        <button className="app-btn small" onClick={() => setTech(!tech)}>{tech ? 'Ocultar detalhes técnicos' : 'Detalhes técnicos'}</button>
        {active && (
          <button className="app-btn small danger" onClick={() => void api.post(`/api/runs/${run.id}/cancel`).catch(() => {})}>
            Cancelar
          </button>
        )}
        <button className="app-btn small danger" onClick={() => setConfirm(true)}>Excluir</button>
      </div>
      {confirm && (
        <ConfirmDeleteModal
          title="Excluir esta execução?"
          text={active ? 'Ela ainda está ativa: vou cancelar o agente antes. Some do histórico com eventos e resultado.' : 'Some do histórico com eventos e resultado. Missões e workflows que a usaram continuam existindo.'}
          rows={[
            { label: 'Tarefa', value: run.task },
            { label: 'Agente', value: run.agent },
            { label: 'Estado', value: l },
          ]}
          busy={busy}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void remove()}
        />
      )}
      {tech && (
        <div className="app-mono" style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(0,0,0,.35)', border: '1px solid rgba(255,255,255,.06)', fontSize: 11.5, lineHeight: 1.7, color: C.t2, maxHeight: 320, overflowY: 'auto', overflowWrap: 'anywhere' }}>
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
