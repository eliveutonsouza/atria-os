import { useState, type ReactNode } from 'react'
import type { OpsBoard, Overview, ScheduleOccurrence, StatsOverview } from '@shared/protocol'
import { useApi, type ApiState } from '../../api/useApi'
import { C, toneColor } from '../../lib/colors'
import { useYui } from '../../store/yui'
import { ErrorNote, useHeader } from '../../views/ui'
import { Card, dayLabel, Dot, elapsed, fmtCost, fmtTokens, HBar, Kpi, Legend, openApp, ORIGIN_LABEL } from './common'
import { UsageSummaryCard } from './UsagePage'

// Início (Overview.dc.html): KPIs, execuções por dia, sucesso por agente, trabalhando agora, próximos agendamentos, projetos.

function greeting(name: string) {
  const h = new Date().getHours()
  const g = h < 5 || h >= 18 ? 'Boa noite' : h < 12 ? 'Bom dia' : 'Boa tarde'
  return name ? `${g}, ${name}` : g
}

const dayTip = (d: { date: string; done: number; routine: number; failed: number }) =>
  `${d.date.slice(8)}/${d.date.slice(5, 7)} — ${d.done} concluídas, ${d.routine} rotinas, ${d.failed} falhas`

const linkBtn = { border: 'none', background: 'transparent', color: '#7fdcf5', fontSize: 12, cursor: 'pointer' } as const

/** Bloco que depende de uma busca: esqueleto enquanto carrega, erro com "Tentar de novo", senão o conteúdo. */
function Loaded({ s, rows = 3, children }: { s: ApiState<unknown>; rows?: number; children: ReactNode }) {
  if (!s.data && s.error) return <ErrorNote text="Não consegui carregar isso agora." retry={s.reload} />
  if (!s.data)
    return (
      <div aria-busy="true" aria-label="Carregando" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: rows }).map((_, i) => <div key={i} className="skel" style={{ height: 36, opacity: 1 - i * 0.15 }} />)}
      </div>
    )
  return <>{children}</>
}

/** Seletor do período (7 ou 30 dias). */
function PeriodToggle({ days, onChange }: { days: 7 | 30; onChange: (d: 7 | 30) => void }) {
  return (
    <div role="group" aria-label="Período" style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.02)' }}>
      {([7, 30] as const).map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={days === d}
          onClick={() => onChange(d)}
          className={days === d ? 'app-btn small primary' : 'app-btn small'}
          style={days === d ? undefined : { border: 'none', background: 'transparent' }}
        >
          Últimos {d} dias
        </button>
      ))}
    </div>
  )
}

export function OverviewPage() {
  const userName = useYui((s) => s.userName)
  const [days, setDays] = useState<7 | 30>(7)
  const coarse = useYui((s) => s.coarse)
  const [selDay, setSelDay] = useState<string | null>(null) // no toque: barra tocada mostra o valor
  const stats = useApi<StatsOverview>(`/api/stats/overview?days=${days}`, [days], 30000)
  const board = useApi<OpsBoard>('/api/ops/board', [], 8000)
  const [from] = useState(() => new Date())
  const occ = useApi<ScheduleOccurrence[]>(
    `/api/schedule/occurrences?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(new Date(from.getTime() + 7 * 86400_000).toISOString())}`,
    [],
    60000,
  )
  const ov = useApi<Overview>('/api/overview', [], 60000)

  useHeader('Início · ao vivo', greeting(userName), [{ label: '+ Nova missão', primary: true, fn: () => openApp('missions', 'new') }], [userName])

  const k = stats.data?.kpis
  const daily = stats.data?.daily ?? []
  const maxDay = Math.max(4, ...daily.map((d) => d.done + d.failed + d.routine))
  const working = [...(board.data?.columns.running ?? []), ...(board.data?.columns.queued ?? [])].slice(0, 6)
  const next = (occ.data ?? []).filter((o) => o.enabled).slice(0, 6)
  const byAgent = (stats.data?.byAgent ?? []).filter((a) => a.success !== null).slice(0, 7)
  const delta = k ? k.runsToday - k.runsYesterday : 0
  const tools = stats.data?.topTools ?? []
  // rótulos do eixo: início, ⅓ e ⅔ do período (servem para 7 e para 30 dias)
  const ticks = daily.length ? [0, Math.floor(daily.length / 3), Math.floor((daily.length * 2) / 3)] : []

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <PeriodToggle days={days} onChange={setDays} />
      </div>
      <section className="app-grid-5">
        <Kpi label="Execuções hoje" value={k ? String(k.runsToday) : '—'} delta={k ? `${delta >= 0 ? '+' : ''}${delta} vs. ontem` : undefined} deltaColor={delta >= 0 ? C.ok : C.t2} />
        <Kpi label={`Sucesso · ${days} dias`} value={k?.success7d != null ? `${k.success7d}%` : '—'} color={C.ok} delta={k ? `${k.failed7d} falha${k.failed7d === 1 ? '' : 's'}` : undefined} />
        <Kpi label="Agentes ativos" value={k ? String(k.agentsActive) : '—'} color={C.cyan} delta={k ? `de ${k.agentsTotal}` : undefined} />
        <Kpi label="Aguardando você" value={k ? String(k.approvals) : '—'} color={C.warn} delta="aprovações" deltaColor="#f5c97a" />
        <Kpi label={`Custo · ${days} dias`} value={k ? fmtCost(k.cost7d) : '—'} color={C.lav} delta={k ? `${fmtTokens(k.tokens7d)} tokens` : undefined} />
      </section>

      <UsageSummaryCard />

      <section className="app-grid-3">
        <Card className="app-span-2" title="Execuções por dia" right={<Legend items={[{ label: 'concluídas', color: C.cyan }, { label: 'falhas', color: C.warn }, { label: 'rotinas', color: C.violet }]} />}>
          <Loaded s={stats} rows={4}>
          <div role="img" aria-label={`Execuções por dia nos últimos ${days} dias`} style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 170 }}>
            {daily.map((d, i) => {
              const total = d.done + d.failed + d.routine
              const h = (v: number) => `${(v / maxDay) * 100}%`
              return (
                <div
                  key={d.date}
                  title={dayTip(d)}
                  onClick={coarse ? () => setSelDay(selDay === d.date ? null : d.date) : undefined}
                  style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: total ? 2 : 0, minWidth: 0, ...(coarse ? { cursor: 'pointer', opacity: selDay && selDay !== d.date ? 0.45 : 1 } : null) }}
                >
                  {d.failed > 0 && <div style={{ height: h(d.failed), background: C.warn, borderRadius: 2, opacity: 0.85 }} />}
                  {d.routine > 0 && <div style={{ height: h(d.routine), background: C.violet, borderRadius: 2, opacity: 0.7 }} />}
                  <div
                    style={{
                      height: d.done ? h(d.done) : 2,
                      background: d.done ? 'linear-gradient(180deg,#67d8f2,rgba(103,216,242,.45))' : 'rgba(255,255,255,.05)',
                      borderRadius: '3px 3px 1px 1px',
                      opacity: i === daily.length - 1 ? 1 : 0.9,
                    }}
                  />
                </div>
              )
            })}
          </div>
          <div className="app-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.t3 }}>
            {ticks.map((i) => (
              <span key={i}>{daily[i] ? `${daily[i].date.slice(8)}/${daily[i].date.slice(5, 7)}` : ''}</span>
            ))}
            <span>hoje</span>
          </div>
          </Loaded>
          {coarse && (
            <div role="status" style={{ fontSize: 12.5, color: selDay ? C.soft : C.t3, minHeight: 18 }}>
              {(() => {
                const d = daily.find((x) => x.date === selDay)
                return d ? dayTip(d) : 'Toque numa barra para ver o dia.'
              })()}
            </div>
          )}
        </Card>

        <Card title="Sucesso por agente" right={`${days} dias`}>
          <Loaded s={stats}>
          {byAgent.length === 0 && <span className="app-muted">Ainda sem execuções concluídas no período.</span>}
          {byAgent.map((a) => (
            <HBar
              key={a.agentId}
              label={a.agent}
              value={`${a.success}%`}
              pct={a.success ?? 0}
              color={(a.success ?? 0) >= 95 ? C.ok : (a.success ?? 0) >= 85 ? C.cyan : C.warn}
              onClick={() => openApp('agents', a.agentId)}
            />
          ))}
          </Loaded>
        </Card>

        <Card className="app-span-2" title="Trabalhando agora" right={<button onClick={() => openApp('ops')} className="touch-link" style={linkBtn}>Ver operações →</button>}>
          <Loaded s={board} rows={2}>
          {working.length === 0 ? (
            <span className="app-muted">Nenhum agente trabalhando agora. Peça algo para a Yui ou rode um workflow.</span>
          ) : (
            <div className="app-grid-2" style={{ gap: 10 }}>
              {working.map((w) => {
                const queued = !w.startedAt
                const c = queued ? C.t3 : C.cyan
                return (
                  <button
                    key={w.id}
                    onClick={() => openApp('runs', w.id)}
                    className="app-row"
                    style={{
                      padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.025)', border: `1px solid ${queued ? 'rgba(255,255,255,.06)' : 'rgba(103,216,242,.14)'}`,
                      display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left', color: C.text, cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, width: '100%' }}>
                      <Dot c={c} pulse={!queued} hollow={queued} />
                      <span style={{ fontWeight: 600 }}>{w.agent}</span>
                      <span style={{ color: C.t3, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {ORIGIN_LABEL[w.origin]}
                        {w.originLabel ? ` · ${w.originLabel}` : ''}
                      </span>
                      <span style={{ flex: 1 }} />
                      <span className="app-mono" style={{ fontSize: 11, color: c }}>{elapsed(w.startedAt)}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: '#b4b9cf' }}>{w.task}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                      <span style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: '100%', width: `${w.progress}%`, background: c, transition: 'width .5s' }} />
                      </span>
                      <span className="app-mono" style={{ fontSize: 11, color: C.t2 }}>{w.project ?? '—'}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          </Loaded>
        </Card>

        <Card title="Próximos agendamentos" right={<button onClick={() => openApp('schedule')} className="touch-link" style={linkBtn}>Agenda →</button>}>
          <Loaded s={occ}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {next.length === 0 && <span className="app-muted">Nenhuma rotina agendada. Crie uma em Agendamentos ou peça para a Yui.</span>}
            {next.map((n) => (
              <div
                key={`${n.routineId}${n.at}`}
                style={{ display: 'grid', gridTemplateColumns: '84px 12px minmax(0,1fr)', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.05)', fontSize: 12.5 }}
              >
                <span className="app-mono" style={{ color: C.t3, fontSize: 11.5 }}>{dayLabel(n.at)}</span>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: n.workflow ? C.violet : C.cyan }} />
                <span style={{ color: '#c9cde0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}</span>
              </div>
            ))}
          </div>
          </Loaded>
        </Card>

        <Card className="app-span-2" title="Projetos" right={<button onClick={() => openApp('projects')} className="touch-link" style={linkBtn}>Todos →</button>}>
          <Loaded s={ov}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {(ov.data?.projects ?? []).length === 0 && <span className="app-muted">Nenhum projeto clonado ainda. Conecte o GitHub em Configurações.</span>}
            {(ov.data?.projects ?? []).slice(0, 6).map((p) => (
              <button
                key={p.slug}
                onClick={() => openApp('projects', p.slug)}
                className="app-row"
                style={{
                  display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto 52px', alignItems: 'center', gap: 12, padding: '10px 8px', border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,.05)', background: 'transparent', color: C.text, textAlign: 'left', cursor: 'pointer', borderRadius: 8,
                }}
              >
                <Dot c={toneColor(p.tone)} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                  <span style={{ fontSize: 12, color: C.t2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.note}</span>
                </span>
                <span style={{ fontSize: 12, color: toneColor(p.tone) }}>{p.status}</span>
                <span style={{ fontSize: 18, fontWeight: 300, textAlign: 'right' }}>{p.health === null ? '—' : `${p.health}%`}</span>
              </button>
            ))}
          </div>
          </Loaded>
        </Card>

        <Card title="Ferramentas mais usadas" right={`${days} dias`}>
          <Loaded s={stats}>
          {tools.length === 0 && <span className="app-muted">Sem uso registrado ainda.</span>}
          {tools.slice(0, 7).map((t) => (
            <HBar key={t.name} label={t.name} value={String(t.count)} pct={(t.count / (tools[0]?.count || 1)) * 100} color={C.violet} labelW={110} mono />
          ))}
          </Loaded>
        </Card>
      </section>
    </>
  )
}
