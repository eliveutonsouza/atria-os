import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { OpsBoard, OpsCard } from '@shared/protocol'
import { useApi } from '../../api/useApi'
import { C } from '../../lib/colors'
import { useYui } from '../../store/yui'
import { useHeader } from '../../views/ui'
import { agentColor, Card, elapsed, openApp, ORIGIN_LABEL, Tag } from './common'

// Operações (Ops.dc.html): metodologia de execução — pipeline com contadores, quadro ao vivo e linha do tempo 24h.

type ColKey = keyof OpsBoard['columns']
const COLS: { key: ColKey; title: string; color: string }[] = [
  { key: 'queued', title: 'Na fila', color: C.t3 },
  { key: 'running', title: 'Rodando', color: C.cyan },
  { key: 'waiting', title: 'Aguardando você', color: C.warn },
  { key: 'doneToday', title: 'Concluído hoje', color: C.ok },
  { key: 'failed', title: 'Falhou', color: C.crit },
]

const BORDER: Partial<Record<ColKey, string>> = { running: 'rgba(103,216,242,.25)', waiting: 'rgba(245,181,74,.3)', failed: 'rgba(240,98,114,.3)' }

function openCard(c: OpsCard) {
  const s = useYui.getState()
  if (c.kind === 'approval') {
    if (s.approvals[c.id]) s.set({ approvalOpen: c.id, yst: 'warning' })
    else openApp('inbox')
    return
  }
  openApp('runs', c.id)
}

export function OpsPage() {
  const board = useApi<OpsBoard>('/api/ops/board', [], 5000)
  const runs = useYui((s) => s.runs)
  const inbox = useYui((s) => s.inbox)
  const phone = useYui((s) => s.device === 'phone')
  const coarse = useYui((s) => s.coarse)
  // no toque: trecho tocado na linha do tempo fica marcado e o texto aparece abaixo do gráfico
  const [selSpan, setSelSpan] = useState<{ agentId: string; i: number } | null>(null)
  useHeader('Operações · metodologia de execução', 'Quem está fazendo o quê', [
    { label: 'Execuções', primary: true, fn: () => openApp('runs') },
    { label: 'Agentes', fn: () => openApp('agents') },
  ])

  // execução ou aprovação mudou (SSE) → atualiza o quadro na hora
  const reload = useRef(board.reload)
  reload.current = board.reload
  useEffect(() => {
    const t = setTimeout(() => reload.current(), 400)
    return () => clearTimeout(t)
  }, [runs, inbox])

  const d = board.data
  const p = d?.pipeline
  const pipe = [
    { k: 'Entrada', t: 'Você', n: p ? `${p.inbound} pedido${p.inbound === 1 ? '' : 's'} hoje` : 'voz · texto · rotina', c: C.t2, on: false },
    { k: 'Conversa', t: 'Yui', n: 'GPT-Live · texto', c: C.cyan, on: true },
    { k: 'Decide', t: 'Cérebro', n: p ? `${p.brain} ${p.brain === 1 ? 'delegação' : 'delegações'} hoje` : 'tarefa · missão · workflow', c: C.lav, on: !!p?.brain },
    { k: 'Planeja', t: 'Missões & workflows', n: p ? `${p.missions} missão · ${p.workflows} workflow` : '—', c: C.violet, on: !!(p?.missions || p?.workflows) },
    { k: 'Executa', t: 'Agentes', n: p ? `${p.running} rodando · ${p.queued} na fila` : '—', c: C.cyan, on: !!p?.running },
    { k: 'Controle', t: 'Aprovação', n: p ? `${p.approvals} aguardando você` : '—', c: C.warn, on: !!p?.approvals },
    { k: 'Resultado', t: 'Entrega', n: p ? `${p.doneToday} hoje` : '—', c: C.ok, on: false },
  ]

  const now = Date.now()
  const span0 = now - 86400_000
  const pos = (iso: string) => Math.max(0, Math.min(100, ((new Date(iso).getTime() - span0) / 86400_000) * 100))
  const spanTip = (sp: { task: string; start: string }) => `${sp.task} — ${new Date(sp.start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  // trechos são finos demais para o dedo: pega o mais próximo do ponto tocado na linha
  const pickSpan = (g: NonNullable<typeof d>['gantt'][number], e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const at = ((e.clientX - r.left) / r.width) * 100
    let best = -1
    let bestDist = Infinity
    g.spans.forEach((sp, i) => {
      const a = pos(sp.start)
      const b = pos(sp.end ?? new Date().toISOString())
      const dist = at < a ? a - at : at > b ? at - b : 0
      if (dist < bestDist) { best = i; bestDist = dist }
    })
    if (best < 0 || bestDist > 8) return setSelSpan(null)
    setSelSpan(selSpan?.agentId === g.agentId && selSpan.i === best ? null : { agentId: g.agentId, i: best })
  }
  const selected = selSpan ? d?.gantt.find((g) => g.agentId === selSpan.agentId)?.spans[selSpan.i] : undefined

  return (
    <>
      <section className="app-card app-pipeline" aria-label="Pipeline de execução">
        {pipe.map((n, i) => (
          <div key={n.k} className="app-pipeline-step">
            <div
              style={{
                flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 3,
                background: n.on ? 'rgba(103,216,242,.07)' : 'rgba(255,255,255,.02)', border: `1px solid ${n.on ? 'rgba(103,216,242,.25)' : 'rgba(255,255,255,.06)'}`,
              }}
            >
              <span style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: C.t3, fontWeight: 600 }}>{n.k}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{n.t}</span>
              <span style={{ fontSize: 11.5, color: n.c }}>{n.n}</span>
            </div>
            {i < pipe.length - 1 && (
              <svg className="app-hide-narrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.t4} strokeWidth="1.8" strokeLinecap="round" aria-hidden style={{ flexShrink: 0 }}>
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            )}
          </div>
        ))}
      </section>

      <section className="app-grid-5" style={{ gap: 10, alignItems: 'start' }}>
        {COLS.map((col) => {
          const cards = d?.columns[col.key] ?? []
          return (
            <div key={col.key} style={{ padding: 12, borderRadius: 16, background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }} className="app-kanban-col">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px 6px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: col.color }} />
                  {col.title}
                </span>
                <span className="app-mono" style={{ fontSize: 11, color: C.t3 }}>{cards.length}</span>
              </div>
              {cards.length === 0 && <span style={{ fontSize: 12, color: C.t4, padding: '6px 4px' }}>—</span>}
              {cards.map((cd) => (
                <button
                  key={cd.id}
                  onClick={() => openCard(cd)}
                  className="app-row"
                  style={{
                    padding: '10px 12px', borderRadius: 12, background: 'rgba(16,20,42,.7)', border: `1px solid ${BORDER[col.key] ?? 'rgba(255,255,255,.06)'}`,
                    display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left', color: C.text, cursor: 'pointer', minWidth: 0,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, width: '100%' }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(255,255,255,.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: col.color, flexShrink: 0 }}>
                      {cd.agent.slice(0, 1).toUpperCase()}
                    </span>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cd.agent}</span>
                    <span style={{ flex: 1 }} />
                    {col.key === 'running' && <span className="app-mono" style={{ fontSize: 10.5, color: C.cyan }}>{elapsed(cd.startedAt)}</span>}
                  </span>
                  <span style={{ fontSize: 12, color: '#b4b9cf', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{cd.task}</span>
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>
                    <Tag>{`${cd.kind === 'approval' ? 'aprovação' : ORIGIN_LABEL[cd.origin]}${cd.originLabel ? ` · ${cd.originLabel}` : ''}`}</Tag>
                    {cd.project && <Tag color={C.t2} bg="rgba(255,255,255,.05)">{cd.project}</Tag>}
                  </span>
                  {col.key === 'running' && (
                    <span style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,.07)', overflow: 'hidden', width: '100%' }}>
                      <span style={{ display: 'block', height: '100%', width: `${cd.progress}%`, background: C.cyan, transition: 'width .5s' }} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )
        })}
      </section>

      <Card title="Linha do tempo · 24h" right={phone ? undefined : <span className="app-mono" style={{ fontSize: 10, whiteSpace: 'normal', textAlign: 'right' }}>−24h · −18h · −12h · −6h · agora</span>}>
        {(d?.gantt ?? []).length === 0 && <span className="app-muted">Nenhuma execução nas últimas 24 horas.</span>}
        {(d?.gantt ?? []).map((g) => (
          <div key={g.agentId} style={{ display: 'grid', gridTemplateColumns: phone ? '76px minmax(0,1fr)' : '100px minmax(0,1fr)', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <button onClick={() => openApp('agents', g.agentId)} style={{ border: 'none', background: 'transparent', color: '#c9cde0', textAlign: 'left', cursor: 'pointer', padding: 0, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...(coarse ? { minHeight: 44 } : null) }}>
              {g.agent}
            </button>
            <div onClick={coarse ? (e) => pickSpan(g, e) : undefined} style={{ position: 'relative', height: 14, borderRadius: 4, background: 'rgba(255,255,255,.03)', ...(coarse ? { cursor: 'pointer' } : null) }}>
              {[25, 50, 75].map((x) => <span key={x} style={{ position: 'absolute', left: `${x}%`, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,.05)' }} />)}
              {g.spans.map((sp, i) => {
                const x = pos(sp.start)
                const w = Math.max(0.6, pos(sp.end ?? new Date().toISOString()) - x)
                const color = sp.state === 'failed' ? C.crit : sp.state === 'running' ? C.cyan : sp.state === 'waiting_approval' ? C.warn : agentColor(g.agentId)
                const on = selSpan?.agentId === g.agentId && selSpan.i === i
                return (
                  <span
                    key={i}
                    title={spanTip(sp)}
                    className={sp.state === 'running' ? 'app-pulse' : undefined}
                    style={{ position: 'absolute', top: 2, height: 10, left: `${x}%`, width: `${w}%`, borderRadius: 3, background: color, opacity: sp.state === 'done' ? 0.8 : 1, ...(on ? { outline: '2px solid #fff', outlineOffset: 1 } : null) }}
                  />
                )
              })}
            </div>
          </div>
        ))}
        {phone && (d?.gantt ?? []).length > 0 && (
          <div className="app-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.t3, paddingLeft: 86 }}>
            <span>−24h</span><span>−12h</span><span>agora</span>
          </div>
        )}
        {coarse && (d?.gantt ?? []).length > 0 && (
          <div role="status" style={{ fontSize: 12.5, color: selected ? '#c9cde0' : C.t3, minHeight: 18 }}>
            {selected ? spanTip(selected) : 'Toque na linha de um agente para ver a execução.'}
          </div>
        )}
      </Card>
    </>
  )
}
