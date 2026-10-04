import { useMemo, useState } from 'react'
import type { ScheduleOccurrence, WorkflowDef, WorkflowRunInfo } from '@shared/protocol'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { C } from '../../lib/colors'
import { useYui } from '../../store/yui'
import { RoutinesView } from '../../views/RoutinesView'
import { useHeader } from '../../views/ui'
import { Card, openApp } from './common'

// Agendamentos (Schedule.dc.html): calendário semanal das rotinas (cron expandido) + workflows ao lado + gestão das rotinas.

type WfItem = WorkflowDef & { lastRun: WorkflowRunInfo | null; routines: { id: string; name: string; cron: string; enabled: boolean }[] }
const DAY = 86400_000

function mondayOf(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - y.getTime()) / DAY + 1) / 7)
}

const EV = {
  wf: { bg: 'rgba(166,140,247,.14)', b: 'rgba(166,140,247,.3)', c: '#cbbcff' },
  agent: { bg: 'rgba(103,216,242,.1)', b: 'rgba(103,216,242,.25)', c: '#a9e9f8' },
  off: { bg: 'rgba(255,255,255,.03)', b: 'rgba(255,255,255,.08)', c: C.t3 },
}

export function SchedulePage() {
  const [week, setWeek] = useState(() => mondayOf(new Date()))
  const from = week.toISOString()
  const to = new Date(week.getTime() + 7 * DAY - 1).toISOString()
  const occ = useApi<ScheduleOccurrence[]>(`/api/schedule/occurrences?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, [from], 60000)
  const wfs = useApi<WfItem[]>('/api/workflows', [], 30000)
  const thisWeek = mondayOf(new Date()).getTime() === week.getTime()
  useHeader(`Agendamentos · semana ${isoWeek(week)}`, 'Sua rotina automatizada', [
    { label: '‹', fn: () => setWeek(new Date(week.getTime() - 7 * DAY)) },
    { label: thisWeek ? 'Esta semana' : 'Hoje', fn: () => setWeek(mondayOf(new Date())) },
    { label: '›', fn: () => setWeek(new Date(week.getTime() + 7 * DAY)) },
    { label: '+ Nova rotina', fn: () => document.getElementById('yui-routines')?.scrollIntoView({ behavior: 'smooth' }) },
  ], [from, thisWeek])

  const days = Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * DAY))
  const todayKey = new Date().toDateString()
  const narrow = useYui((s) => s.narrow)
  const [dayPick, setDayPick] = useState<string | null>(null)
  const selectedDay = dayPick && days.some((d) => d.toDateString() === dayPick) ? dayPick : days.find((d) => d.toDateString() === todayKey)?.toDateString() ?? days[0].toDateString()
  const dayItems = (occ.data ?? []).filter((o) => new Date(o.at).toDateString() === selectedDay).sort((a, b) => a.at.localeCompare(b.at))
  // linhas = horários com algo agendado (como no layout); muitas ocorrências por hora viram "+N"
  const { hours, cell } = useMemo(() => {
    const map = new Map<string, ScheduleOccurrence[]>()
    const hs = new Set<number>()
    for (const o of occ.data ?? []) {
      const d = new Date(o.at)
      const h = d.getHours()
      hs.add(h)
      const key = `${d.toDateString()}|${h}`
      map.set(key, [...(map.get(key) ?? []), o])
    }
    return { hours: [...hs].sort((a, b) => a - b), cell: map }
  }, [occ.data])

  const run = (slug: string) =>
    api
      .post(`/api/workflows/${slug}/run`, {})
      .then(() => useYui.getState().say(`Workflow ${slug} iniciado.`, { state: 'delegating' }))
      .catch(() => useYui.getState().say('Não consegui iniciar o workflow.', { state: 'warning' }))

  return (
    <>
      <div className="app-split" style={{ alignItems: 'flex-start' }}>
        {narrow ? (
          // Celular: agenda do dia (chips dos 7 dias + lista) em vez da grade semanal larga.
          <section aria-label="Agenda do dia" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
              {days.map((d) => {
                const key = d.toDateString()
                const on = key === selectedDay
                const count = (occ.data ?? []).filter((o) => new Date(o.at).toDateString() === key).length
                return (
                  <button key={key} onClick={() => setDayPick(key)} aria-pressed={on} style={{ minHeight: 56, borderRadius: 12, border: `1px solid ${on ? 'rgba(103,216,242,.4)' : 'rgba(255,255,255,.08)'}`, background: on ? 'rgba(103,216,242,.12)' : 'rgba(255,255,255,.02)', color: key === todayKey ? C.cyan : C.text, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 0, cursor: 'pointer' }}>
                    <span style={{ fontSize: 10.5, color: C.t2 }}>{d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</span>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>{d.getDate()}</span>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: count ? C.violet : 'transparent' }} />
                  </button>
                )
              })}
            </div>
            <div className="app-card" style={{ padding: '6px 14px' }}>
              {dayItems.length === 0 && <div style={{ padding: '18px 0', color: C.t2, fontSize: 14 }}>Nada agendado neste dia.</div>}
              {dayItems.map((o) => {
                const tone = !o.enabled ? EV.off : o.workflow ? EV.wf : EV.agent
                return (
                  <div key={`${o.routineId}-${o.at}`} style={{ display: 'grid', gridTemplateColumns: '52px 10px minmax(0, 1fr)', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.05)', fontSize: 14 }}>
                    <span className="app-mono" style={{ color: C.t3, fontSize: 12.5 }}>{new Date(o.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: tone.c }} />
                    <span style={{ color: o.enabled ? C.text : C.t3 }}>{o.name}{o.workflow ? <span style={{ color: C.t3, fontSize: 12 }}> · workflow</span> : null}</span>
                  </div>
                )
              })}
            </div>
          </section>
        ) : (
        <section
          aria-label="Calendário semanal"
          style={{ flex: 1, minWidth: 0, width: '100%', borderRadius: 16, background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)', overflowX: 'auto' }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '54px repeat(7, minmax(92px, 1fr))', minWidth: 700 }}>
            <span />
            {days.map((d) => {
              const today = d.toDateString() === todayKey
              return (
                <span key={d.toISOString()} style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: today ? C.cyan : C.t2, borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                  {d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').replace(/^\w/, (c) => c.toUpperCase())} {String(d.getDate()).padStart(2, '0')}
                </span>
              )
            })}
            {hours.length === 0 && (
              <div style={{ gridColumn: '1 / -1', padding: '40px 16px', textAlign: 'center', color: C.t2, fontSize: 14 }}>
                Nada agendado nesta semana. Agende um workflow ou crie uma rotina abaixo.
              </div>
            )}
            {hours.map((h) => (
              <Row key={h} h={h} days={days} cell={cell} />
            ))}
          </div>
        </section>
        )}
        <aside style={{ width: 340, maxWidth: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="eyebrow">Workflows</div>
          {(wfs.data ?? []).length === 0 && <span className="app-muted">Nenhum workflow ainda.</span>}
          {(wfs.data ?? []).map((w) => {
            const routine = w.routines.find((r) => r.enabled)
            const running = w.lastRun && (w.lastRun.status === 'running' || w.lastRun.status === 'waiting_approval')
            const tasks = w.nodes.filter((n) => n.type !== 'start' && n.type !== 'end').slice(0, 6)
            return (
              <div key={w.slug} className="app-card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{w.name}</span>
                  <span style={{ fontSize: 11, color: running ? C.cyan : C.t2, whiteSpace: 'nowrap' }}>{running ? 'rodando agora' : routine ? 'agendado' : 'manual'}</span>
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {tasks.map((n) => {
                    const st = w.lastRun?.nodes[n.id]?.status
                    const on = st === 'running', done = st === 'done'
                    return (
                      <span key={n.id} style={{ fontSize: 10.5, padding: '3px 7px', borderRadius: 6, background: done ? 'rgba(79,224,176,.12)' : on ? 'rgba(103,216,242,.12)' : 'rgba(255,255,255,.05)', color: done ? '#8af0cc' : on ? '#a9e9f8' : C.t2 }}>
                        {n.type === 'decision' ? 'Decisão' : n.type === 'approval' ? 'Aprovação' : n.agent ?? n.title}
                      </span>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button className="app-btn small" onClick={() => openApp('workflows', w.slug)}>Abrir</button>
                  <button className="app-btn small" onClick={() => void run(w.slug)}>Rodar agora</button>
                  <span style={{ flex: 1 }} />
                  <span className="app-mono" style={{ fontSize: 11, color: C.t3 }}>{routine?.cron ?? w.trigger.cron ?? 'manual'}</span>
                </div>
              </div>
            )
          })}
        </aside>
      </div>
      <Card title="Rotinas" right="crie, pause, edite ou rode agora" style={{ scrollMarginTop: 20 }}>
        <div id="yui-routines">
          <RoutinesView />
        </div>
      </Card>
    </>
  )
}

function Row({ h, days, cell }: { h: number; days: Date[]; cell: Map<string, ScheduleOccurrence[]> }) {
  return (
    <>
      <span className="app-mono" style={{ fontSize: 10.5, color: C.t3, padding: '8px 6px', borderTop: '1px solid rgba(255,255,255,.04)' }}>{String(h).padStart(2, '0')}h</span>
      {days.map((d) => {
        const list = cell.get(`${d.toDateString()}|${h}`) ?? []
        return (
          <div key={d.toISOString()} style={{ borderTop: '1px solid rgba(255,255,255,.04)', borderLeft: '1px solid rgba(255,255,255,.04)', padding: 6, display: 'flex', flexDirection: 'column', gap: 4, minHeight: 44 }}>
            {list.slice(0, 2).map((o) => {
              const t = !o.enabled ? EV.off : o.workflow ? EV.wf : EV.agent
              return (
                <button
                  key={o.routineId + o.at}
                  title={`${o.name} — ${new Date(o.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${o.enabled ? '' : ' (pausada)'}`}
                  onClick={() => (o.workflow ? openApp('workflows', o.workflow) : document.getElementById('yui-routines')?.scrollIntoView({ behavior: 'smooth' }))}
                  style={{ fontSize: 11, padding: '5px 7px', borderRadius: 8, background: t.bg, border: `1px solid ${t.b}`, color: t.c, lineHeight: 1.3, textAlign: 'left', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {o.name}
                </button>
              )
            })}
            {list.length > 2 && <span style={{ fontSize: 10.5, color: C.t3 }}>+{list.length - 2}</span>}
          </div>
        )
      })}
    </>
  )
}
