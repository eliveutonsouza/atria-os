import { useEffect, useRef, useState } from 'react'
import type { HelpResults, HelpTaskType } from '@shared/protocol'
import { api } from '../api/client'
import { C } from '../lib/colors'
import { toastErr, toastOk } from '../lib/feedback'
import { useYui } from '../store/yui'
import { fmtHours, TIPO_COLOR, TIPO_LABEL } from './api'
import { Loading } from './ui'

// Resultados: números reais do banco + horas economizadas (quantidade × minutos por tipo, ajustáveis).

type Period = HelpResults['period']
const PERIODS: [Period, string][] = [
  ['week', 'Esta semana'],
  ['month', 'Este mês'],
  ['90d', 'Últimos 90 dias'],
]

const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

export function ResultsTab() {
  const narrow = useYui((s) => s.narrow)
  const [period, setPeriod] = useState<Period>('month')
  const [r, setR] = useState<HelpResults | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mins, setMins] = useState<Partial<Record<HelpTaskType, string>>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let alive = true
    setErr(null)
    api
      .get<HelpResults>(`/api/help/results?period=${period}`)
      .then((x) => {
        if (!alive) return
        setR(x)
        setMins(Object.fromEntries(x.rows.map((row) => [row.tipo, String(row.minutes)])))
      })
      .catch((e: Error) => alive && setErr(e.message))
    return () => {
      alive = false
    }
  }, [period])
  useEffect(() => () => clearTimeout(timer.current), [])

  const editMinutes = (tipo: HelpTaskType, v: string) => {
    const next = { ...mins, [tipo]: v }
    setMins(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const body: Record<string, number> = {}
      for (const [k, val] of Object.entries(next)) {
        const n = Number(val)
        if (Number.isFinite(n)) body[k] = Math.max(0, Math.min(600, Math.round(n)))
      }
      api
        .put<HelpResults>('/api/help/results/minutes', body)
        .then(() => api.get<HelpResults>(`/api/help/results?period=${period}`))
        .then((x) => {
          setR(x)
          toastOk('Minutos salvos.')
        })
        .catch((e: unknown) => toastErr(e, 'Não consegui salvar os minutos'))
    }, 600)
  }

  if (!r) return <Loading error={err} />
  const k = r.kpis
  const maxW = Math.max(1, ...r.weeks.map((w) => w.hours))
  const tipos = [...new Set(r.weeks.flatMap((w) => Object.keys(w.byTipo)))] as HelpTaskType[]
  const kpis = [
    { l: 'Execuções concluídas', v: String(k.runsDone), c: C.cyan, d: k.successRate != null ? `${Math.round(k.successRate * 100)}% de sucesso` : 'sem falhas registradas' },
    { l: 'Workflows rodados', v: String(k.workflowsDone), c: C.violet, d: 'concluídos no período' },
    { l: 'Aprovações suas', v: String(k.approvals), c: C.warn, d: k.approvalAvgMin != null ? `tempo médio ${Math.round(k.approvalAvgMin)} min` : '—' },
    { l: 'Respostas da base', v: String(k.queries), c: '#f78cc8', d: `${k.docsReady} documentos prontos` },
    { l: 'Custo do período', v: usd.format(k.costUsd), c: C.lav, d: 'agentes (uso de IA)' },
  ]

  return (
    <div className="help-print" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div role="group" aria-label="Período" className="hp-seg no-print">
          {PERIODS.map(([p, l]) => (
            <button key={p} className={period === p ? 'on' : ''} aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {l}
            </button>
          ))}
        </div>
        <span className="print-only" style={{ fontSize: 16, fontWeight: 700 }}>
          Atria OS — resultados de {fmtDate(r.from)} a {fmtDate(r.to)}
        </span>
        <span style={{ fontSize: 12, color: C.t3 }} className="no-print">
          {fmtDate(r.from)} – {fmtDate(r.to)}
        </span>
        <button className="app-btn no-print" onClick={() => window.print()}>
          Imprimir resumo
        </button>
      </div>
      {err && <div style={{ color: C.crit, fontSize: 13 }}>{err}</div>}

      <section className="hp-kpis" style={{ gridTemplateColumns: narrow ? 'repeat(2, minmax(0,1fr))' : undefined }}>
        <div className="hp-card hp-hours" style={{ gridColumn: narrow ? 'span 2' : undefined }}>
          <span style={{ fontSize: 12, color: C.t2 }}>Tempo economizado (estimado)</span>
          <span style={{ fontSize: 40, fontWeight: 300, color: C.ok, lineHeight: 1 }}>{fmtHours(r.hours)}</span>
          <span style={{ fontSize: 12, color: '#c9cde0' }}>≈ {(r.hours / 8).toFixed(1).replace('.', ',')} dias úteis de trabalho</span>
        </div>
        {kpis.map((x) => (
          <div key={x.l} className="hp-card" style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 12, color: C.t2 }}>{x.l}</span>
            <span style={{ fontSize: 28, fontWeight: 300, color: x.c, lineHeight: 1.1, whiteSpace: 'nowrap' }}>{x.v}</span>
            <span style={{ fontSize: 11.5, color: C.t3 }}>{x.d}</span>
          </div>
        ))}
      </section>

      <section className="hp-results" style={{ gridTemplateColumns: narrow ? 'minmax(0,1fr)' : undefined }}>
        <div className="hp-card" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>Horas economizadas por semana</span>
            <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11.5, color: C.t2 }}>
              {tipos.map((t) => (
                <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: TIPO_COLOR[t] }} />
                  {TIPO_LABEL[t]}
                </span>
              ))}
            </span>
          </div>
          {r.weeks.length === 0 ? (
            <div style={{ padding: 20, fontSize: 13, color: C.t3 }}>Ainda não há execuções concluídas neste período.</div>
          ) : (
            <div className="hp-bars" data-own-scroll>
              {r.weeks.map((w) => (
                <div key={w.from} className="hp-bar-col">
                  <span className="app-mono" style={{ fontSize: 11, color: '#c9cde0' }}>
                    {fmtHours(w.hours)}
                  </span>
                  <div className="hp-bar" style={{ height: `${Math.max(2, (w.hours / maxW) * 100)}%` }} title={`${w.label}: ${fmtHours(w.hours)}`}>
                    {tipos
                      .filter((t) => (w.byTipo[t] ?? 0) > 0)
                      .map((t) => (
                        <span key={t} style={{ flexGrow: w.byTipo[t] ?? 0, flexBasis: 0, background: TIPO_COLOR[t], minHeight: 2 }} />
                      ))}
                  </div>
                  <span style={{ fontSize: 11, color: C.t3, whiteSpace: 'nowrap' }}>{w.label}</span>
                </div>
              ))}
            </div>
          )}
          <span style={{ fontSize: 12, color: C.t3 }}>Conta só execuções concluídas com sucesso. Falhas e canceladas não entram.</span>
        </div>

        <div className="hp-card" style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Como o tempo é calculado</span>
            <span style={{ fontSize: 11.5, color: C.t3 }} className="no-print">
              você ajusta os minutos
            </span>
          </div>
          <div className="hp-mins-row hp-eyebrow" style={{ padding: '4px 0' }}>
            <span>Tipo de tarefa</span>
            <span>Qtd.</span>
            <span>Min. cada</span>
            <span style={{ textAlign: 'right' }}>Horas</span>
          </div>
          {r.rows.map((row) => (
            <div key={row.tipo} className="hp-mins-row" style={{ fontSize: 13, borderBottom: '1px solid rgba(255,255,255,.04)', padding: '4px 0' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: TIPO_COLOR[row.tipo], flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.label}</span>
              </span>
              <span className="app-mono" style={{ color: '#c9cde0' }}>
                {row.count}
              </span>
              <label style={{ display: 'flex' }}>
                <span className="sr-only">Minutos por {row.label}</span>
                <input type="number" min={0} max={600} inputMode="numeric" className="hp-input hp-min-input" value={mins[row.tipo] ?? String(row.minutes)} onChange={(e) => editMinutes(row.tipo, e.target.value)} />
              </label>
              <span className="app-mono" style={{ textAlign: 'right', color: C.ok }}>
                {row.hours.toFixed(1).replace('.', ',')}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
