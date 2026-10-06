import { useState } from 'react'
import type { UsageLimit, UsageReport } from '@shared/protocol'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { C } from '../../lib/colors'
import { useYui } from '../../store/yui'
import { input } from '../../views/kit'
import { ErrorNote, Skeleton, useHeader } from '../../views/ui'
import { Card, Legend, openApp } from './common'

// Consumo de IA (Main.dc.html / Phone-Consumo.dc.html): limites do plano Claude, contexto da última execução,
// custo da OpenAI por função, custo por dia e Claude Code por agente. O card do Início (Phone-Inicio.dc.html) mora aqui também.

const CLAUDE = '#a68cf7'
const OPENAI = C.ok
const PERIODS = [
  { days: 1, label: 'Hoje', long: 'Hoje' },
  { days: 7, label: '7 dias', long: 'Últimos 7 dias' },
  { days: 30, label: '30 dias', long: 'Últimos 30 dias' },
] as const

const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nf0 = new Intl.NumberFormat('pt-BR')

function usd(v: number | null | undefined): string {
  if (v == null) return 'sem preço'
  if (v > 0 && v < 0.01) return '< US$ 0,01'
  return `US$ ${nf2.format(v)}`
}
function tok(n: number): string {
  if (n >= 1e6) return `${nf1.format(n / 1e6)} M`
  if (n >= 1e3) return `${nf0.format(Math.round(n / 1e3))} k`
  return nf0.format(n)
}
function minutes(s: number): string {
  return s < 60 ? '< 1 min' : `${nf0.format(Math.round(s / 60))} min`
}
function ago(iso: string | null): string {
  if (!iso) return ''
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m} min`
  if (m < 1440) return `há ${Math.round(m / 60)} h`
  return `há ${Math.round(m / 1440)} d`
}
/** "em 2 h 14 min" até 24 h; depois "seg 09:00"; além de uma semana, a data. `short` tira o "reinicia". */
function resetIn(iso: string | null, short = false): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - Date.now()
  if (ms <= 0) return short ? 'agora' : 'reinicia agora'
  const d = new Date(iso)
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  let txt: string
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    txt = short ? (h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`) : h ? `em ${h} h ${m} min` : `em ${m} min`
  } else if (ms < 7 * 86_400_000) {
    txt = `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} ${hm}`
  } else {
    txt = `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hm}`
  }
  return short ? txt : `reinicia ${txt}`
}
const hot = (l: UsageLimit) => ((l.pct ?? 0) >= 95 || l.status === 'rejected' ? 2 : (l.pct ?? 0) >= 80 ? 1 : 0)
const limitColor = (l: UsageLimit) => [l.kind === 'five_hour' ? 'linear-gradient(90deg, #67d8f2, #a68cf7)' : C.cyan, C.warn, C.crit][hot(l)]
const pctColor = (l: UsageLimit) => [C.text, C.warn, C.crit][hot(l)]
const SHORT_LABEL: Record<string, string> = { five_hour: 'Sessão (5 h)', seven_day: 'Semana', seven_day_opus: 'Semana Opus', seven_day_sonnet: 'Semana Sonnet' }

function Meter({ pct, color, h = 10 }: { pct: number; color: string; h?: number }) {
  return (
    <span aria-hidden style={{ display: 'block', height: h, borderRadius: h / 2, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
      <span style={{ display: 'block', height: '100%', width: `${Math.max(pct > 0 ? 2 : 0, Math.min(100, pct))}%`, background: color, borderRadius: h / 2, transition: 'width .5s var(--ease)' }} />
    </span>
  )
}

const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, fontSize: 13, minWidth: 0 } as const
const lbl = { fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: C.t3, fontWeight: 700 } as const
const ellipsis = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const

function Kpis({ items, phone }: { items: [string, string][]; phone: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 10 }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ minWidth: 0 }}>
          <span style={{ ...lbl, fontSize: phone ? 10 : 11, letterSpacing: phone ? '.1em' : '.16em' }}>{k}</span>
          <b style={{ display: 'block', fontSize: phone ? 18 : 24, fontWeight: 500, marginTop: 4, overflowWrap: 'anywhere' }}>{v}</b>
        </div>
      ))}
    </div>
  )
}

const periodLabel = (days: number) => PERIODS.find((p) => p.days === days)?.label.toLowerCase() ?? `${days} dias`

function CardTitle({ color, name, note, phone }: { color: string; name: string; note?: string | null; phone: boolean }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexWrap: 'wrap' }}>
      <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
      <b style={{ fontSize: phone ? 15 : 16, fontWeight: 600 }}>{name}</b>
      {!phone && note && <span style={{ fontSize: 12, color: C.t2, fontWeight: 400 }}>{note}</span>}
    </span>
  )
}

function ClaudeCard({ r, phone }: { r: UsageReport; phone: boolean }) {
  const c = r.claude
  const plan = c.plan ? `${phone ? 'plano' : 'assinatura'} ${c.plan[0].toUpperCase()}${c.plan.slice(1)}` : null
  const ctx = c.lastContext
  const ctxPct = ctx ? Math.round((ctx.used / ctx.window) * 100) : 0
  return (
    <Card
      title={<CardTitle color={C.lav} name="Claude Code" note={[plan, c.model].filter(Boolean).join(' · ')} phone={phone} />}
      right={phone ? plan ?? undefined : c.limitsAt ? `lido ${ago(c.limitsAt)}` : undefined}
    >
      {c.limits.length === 0 && (
        <span style={{ fontSize: 13, color: C.t2 }}>
          Limites ainda não lidos — toque em Atualizar limites.
          {c.limitsAt && <span style={{ color: C.t3 }}> Última leitura {ago(c.limitsAt)}.</span>}
        </span>
      )}
      {c.limits.map((l) => (
        <div key={l.kind} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={row}>
            <span style={ellipsis}>{phone ? SHORT_LABEL[l.kind] ?? l.label : l.label}</span>
            <span style={{ whiteSpace: 'nowrap' }}>
              <b style={{ color: pctColor(l) }}>{l.pct == null ? '—' : `${Math.round(l.pct)}%`}</b>
              {l.resetsAt && <span style={{ color: C.t2 }}> · {resetIn(l.resetsAt, phone)}</span>}
            </span>
          </div>
          <Meter pct={l.pct ?? 0} color={limitColor(l)} h={phone ? 8 : 10} />
        </div>
      ))}
      {ctx && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} title={ctx.task}>
          <div style={row}>
            <span style={ellipsis}>
              {phone ? 'Contexto (última)' : 'Contexto da última execução'}
              {!phone && <span style={{ color: C.t3 }}> ({ctx.agent} · {ctx.task})</span>}
            </span>
            <span className="app-mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              {tok(ctx.used)} / {tok(ctx.window)}{phone ? '' : ` · ${ctxPct}%`}
            </span>
          </div>
          <Meter pct={ctxPct} color={ctxPct >= 95 ? C.crit : ctxPct >= 80 ? C.warn : C.lav} h={phone ? 8 : 10} />
          {phone && <span style={{ ...ellipsis, fontSize: 12, color: C.t3 }}>{ctx.agent} · {ctx.task}</span>}
        </div>
      )}
      <div style={{ paddingTop: 10, borderTop: '1px solid rgba(255,255,255,.06)' }}>
        <Kpis phone={phone} items={[['Execuções', nf0.format(c.runs)], ['Tokens', tok(c.tokens)], [phone ? 'Custo eq.' : 'Custo equivalente', usd(c.cost)]]} />
      </div>
    </Card>
  )
}

function OpenAICard({ r, phone }: { r: UsageReport; phone: boolean }) {
  const o = r.openai
  const maxCost = Math.max(0, ...o.byFeature.map((f) => f.cost ?? 0))
  const maxTok = Math.max(1, ...o.byFeature.map((f) => f.tokens))
  return (
    <Card title={<CardTitle color={OPENAI} name="OpenAI API" note="cérebro, voz, planejamento, empresa" phone={phone} />} right={phone ? undefined : 'medido a cada chamada'}>
      <Kpis phone={phone} items={[['Hoje', usd(o.today)], ['7 dias', usd(o.d7)], ['30 dias', usd(o.d30)]]} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={lbl}>Por função · {periodLabel(r.days)}</span>
        {o.byFeature.length === 0 && <span className="app-muted">Nenhuma chamada à OpenAI no período.</span>}
        {o.byFeature.map((f) => {
          const meta = [f.model, f.seconds > 0 ? minutes(f.seconds) : f.tokens > 0 ? `${tok(f.tokens)} tok` : null].filter(Boolean).join(' · ')
          // sem preço: a barra mostra a fatia de tokens
          const pct = f.cost != null && maxCost > 0 ? (f.cost / maxCost) * 100 : (f.tokens / maxTok) * 100
          return (
            <div key={`${f.feature}|${f.model}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={row}>
                <span style={{ minWidth: 0, display: 'flex', flexDirection: phone ? 'column' : 'row', gap: phone ? 2 : 8, alignItems: phone ? 'flex-start' : 'baseline' }}>
                  <span>{f.label}</span>
                  <span className="app-mono" style={{ ...ellipsis, color: C.t3, fontSize: 11, maxWidth: '100%' }}>{meta}</span>
                </span>
                <b style={{ whiteSpace: 'nowrap', color: f.cost == null ? C.t2 : C.text, fontWeight: f.cost == null ? 500 : 700 }}>{usd(f.cost)}</b>
              </div>
              <Meter pct={pct} color={f.cost == null ? 'rgba(79,224,176,.35)' : OPENAI} h={phone ? 8 : 10} />
            </div>
          )
        })}
      </div>
      {o.unpriced.length > 0 && (
        <button
          onClick={() => openApp('settings', 'models')}
          style={{ textAlign: 'left', fontSize: 12.5, color: '#f5c97a', background: 'rgba(245,181,74,.08)', border: '1px solid rgba(245,181,74,.25)', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', overflowWrap: 'anywhere' }}
        >
          Sem preço para <span className="app-mono">{o.unpriced.join(', ')}</span> — defina em Configurações › Modelos
        </button>
      )}
    </Card>
  )
}

function dayLabel(date: string, i: number, n: number): string {
  if (i === n - 1) return 'hoje'
  if (n <= 7) return new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
  return i % 7 === 0 ? `${date.slice(8)}/${date.slice(5, 7)}` : ''
}

function DailyChart({ r }: { r: UsageReport }) {
  const coarse = useYui((s) => s.coarse)
  const [sel, setSel] = useState<string | null>(null)
  const max = Math.max(0.01, ...r.daily.map((d) => d.claude + d.openai))
  const tip = (d: UsageReport['daily'][number]) => `${d.date.slice(8)}/${d.date.slice(5, 7)} — Claude ${usd(d.claude)} · OpenAI ${usd(d.openai)}`
  const gap = r.daily.length > 7 ? 3 : 14
  return (
    <Card title="Custo por dia" right={<Legend items={[{ label: 'Claude Code', color: CLAUDE }, { label: 'OpenAI', color: OPENAI }]} />}>
      <div role="img" aria-label="Custo por dia, Claude Code e OpenAI empilhados" style={{ display: 'flex', alignItems: 'flex-end', gap, height: 160, padding: '8px 4px 0', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        {r.daily.map((d) => (
          <div
            key={d.date}
            title={tip(d)}
            onClick={coarse ? () => setSel(sel === d.date ? null : d.date) : undefined}
            style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', cursor: coarse ? 'pointer' : 'default', opacity: sel && sel !== d.date ? 0.45 : 1 }}
          >
            <div style={{ width: '100%', maxWidth: 22, display: 'flex', flexDirection: 'column' }}>
              {d.openai > 0 && <div style={{ height: (d.openai / max) * 150, minHeight: 2, background: OPENAI, borderRadius: '4px 4px 0 0' }} />}
              {d.claude > 0 && <div style={{ height: (d.claude / max) * 150, minHeight: 2, background: CLAUDE, borderRadius: d.openai > 0 ? 0 : '4px 4px 0 0' }} />}
              {!d.openai && !d.claude && <div style={{ height: 2, background: 'rgba(255,255,255,.06)' }} />}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap, fontSize: 11, color: C.t3, padding: '0 4px' }}>
        {r.daily.map((d, i) => (
          <span key={d.date} style={{ flex: 1, minWidth: 0, textAlign: 'center', whiteSpace: 'nowrap' }}>{dayLabel(d.date, i, r.daily.length)}</span>
        ))}
      </div>
      {coarse && (
        <div role="status" style={{ fontSize: 12.5, color: sel ? '#c9cde0' : C.t3, minHeight: 18 }}>
          {(() => {
            const d = r.daily.find((x) => x.date === sel)
            return d ? tip(d) : 'Toque numa barra para ver o dia.'
          })()}
        </div>
      )}
    </Card>
  )
}

function AgentsTable({ r }: { r: UsageReport }) {
  const th = { textAlign: 'left', fontSize: 11, color: C.t3, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', padding: '0 0 8px' } as const
  const td = { padding: '9px 0', borderTop: '1px solid rgba(255,255,255,.06)' } as const
  return (
    <Card title={`Claude Code por agente · ${periodLabel(r.days)}`}>
      {r.claude.byAgent.length === 0 ? (
        <span className="app-muted">Nenhuma execução de agente no período.</span>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>Agente</th>
              <th style={{ ...th, textAlign: 'right' }}>Exec.</th>
              <th style={{ ...th, textAlign: 'right' }}>Tokens</th>
              <th style={{ ...th, textAlign: 'right' }}>Custo</th>
            </tr>
          </thead>
          <tbody>
            {r.claude.byAgent.map((a) => (
              <tr key={a.agentId} className="app-row" onClick={() => openApp('agents', a.agentId)} style={{ cursor: 'pointer' }}>
                <td style={{ ...td, ...ellipsis, maxWidth: 0, width: '40%' }}>{a.agent}</td>
                <td style={{ ...td, textAlign: 'right' }}>{nf0.format(a.runs)}</td>
                <td className="app-mono" style={{ ...td, textAlign: 'right', fontSize: 12 }}>{tok(a.tokens)}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{usd(a.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

export function UsagePage() {
  const device = useYui((s) => s.device)
  const phone = device === 'phone'
  const [days, setDays] = useState<1 | 7 | 30>(7)
  const [busy, setBusy] = useState(false)
  const usage = useApi<UsageReport>(`/api/usage?days=${days}`, [days], 60000)

  const refresh = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.post('/api/usage/refresh')
      usage.reload()
    } catch {
      useYui.getState().say('Não consegui ler os limites do Claude agora. Tente de novo em instantes.')
    } finally {
      setBusy(false)
    }
  }

  useHeader(phone ? 'Sistema' : 'Sistema · consumo de inteligência artificial', 'Consumo de IA', [{ label: busy ? 'Atualizando…' : 'Atualizar limites', primary: true, fn: refresh }], [busy, phone, days])

  const r = usage.data
  return (
    <>
      {phone ? (
        <div role="radiogroup" aria-label="Período" style={{ display: 'flex', padding: 4, borderRadius: 12, background: 'rgba(255,255,255,.04)' }}>
          {PERIODS.map((p) => {
            const on = p.days === days
            return (
              <button
                key={p.days}
                role="radio"
                aria-checked={on}
                onClick={() => setDays(p.days)}
                style={{ flex: 1, minHeight: 44, border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: on ? 'rgba(103,216,242,.14)' : 'transparent', color: on ? '#fff' : C.t2 }}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.t2 }}>
            Período
            <select value={days} onChange={(e) => setDays(Number(e.target.value) as 1 | 7 | 30)} style={{ ...input, height: 34, padding: '0 10px', width: 'auto', minWidth: 150 }}>
              {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.long}</option>)}
            </select>
          </label>
        </div>
      )}
      {!r && usage.error && <ErrorNote />}
      {!r && !usage.error && <Skeleton kpis={2} rows={4} />}
      {r && (
        <>
          <section className="app-grid-2" style={{ gap: 16 }}>
            <ClaudeCard r={r} phone={phone} />
            <OpenAICard r={r} phone={phone} />
          </section>
          <section style={{ display: 'grid', gridTemplateColumns: device === 'desktop' ? 'minmax(0, 1.4fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: 16 }}>
            <DailyChart r={r} />
            <AgentsTable r={r} />
          </section>
        </>
      )}
    </>
  )
}

/** Card "Consumo de IA" do Início: sessão 5 h, semana e OpenAI hoje; abre a página de consumo. */
export function UsageSummaryCard() {
  const wide = useYui((s) => s.device) === 'desktop'
  const { data } = useApi<UsageReport>('/api/usage?days=1', [], 60000)
  const lim = (k: string) => data?.claude.limits.find((l) => l.kind === k) ?? null
  const bars = [
    ['Claude · sessão 5 h', lim('five_hour')],
    ['Claude · semana', lim('seven_day')],
  ] as const
  return (
    <button
      onClick={() => openApp('usage')}
      aria-label="Abrir Consumo de IA"
      className="app-card app-row"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', textAlign: 'left', color: C.text, cursor: 'pointer', font: 'inherit' }}
    >
      <div className="app-card-title" style={{ width: '100%' }}>
        <span>Consumo de IA</span>
        <span style={{ fontSize: 12, color: '#7fdcf5' }}>Detalhes ›</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: wide ? 'minmax(0, 1fr) minmax(0, 1fr) auto' : 'minmax(0, 1fr)', gap: wide ? 24 : 10, alignItems: 'end', width: '100%' }}>
        {data && !bars.some(([, l]) => l) && <span style={{ fontSize: 13, color: C.t2, gridColumn: wide ? 'span 2' : undefined }}>Limites do Claude ainda não lidos.</span>}
        {bars.map(([label, l]) =>
          l ? (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <div style={row}>
                <span style={ellipsis}>{label}</span>
                <span style={{ whiteSpace: 'nowrap' }}>
                  <b style={{ color: pctColor(l) }}>{l.pct == null ? '—' : `${Math.round(l.pct)}%`}</b>
                  {l.kind === 'five_hour' && l.resetsAt && <span style={{ color: C.t2 }}> · {resetIn(l.resetsAt, true)}</span>}
                </span>
              </div>
              <Meter pct={l.pct ?? 0} color={limitColor(l)} h={8} />
            </div>
          ) : null,
        )}
        <div style={{ ...row, ...(wide ? { flexDirection: 'column', alignItems: 'flex-end', gap: 2 } : { paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.06)' }) }}>
          <span style={wide ? { fontSize: 12, color: C.t2 } : undefined}>OpenAI hoje</span>
          <b style={{ fontSize: wide ? 18 : 13, whiteSpace: 'nowrap' }}>{data ? usd(data.openai.today) : '—'}</b>
        </div>
      </div>
    </button>
  )
}
