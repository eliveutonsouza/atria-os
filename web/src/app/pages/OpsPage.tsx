import { useEffect, useRef } from 'react'
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
  useHeader('Operações · metodologia de execução', 'Quem está fazendo o quê', [
    { label: 'Execuções', fn: () => openApp('runs') },
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

  return (
    <>
      <section className="app-card" style={{ display: 'flex', alignItems: 'stretch', gap: 8, overflowX: 'auto' }} aria-label="Pipeline de execução">
        {pipe.map((n, i) => (
          <div key={n.k} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 128 }}>
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.t4} strokeWidth="1.8" strokeLinecap="round" aria-hidden style={{ flexShrink: 0 }}>
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
            <div key={col.key} style={{ padding: 12, borderRadius: 16, background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, minHeight: 160 }}>
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
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Tag>{cd.kind === 'approval' ? 'aprovação' : ORIGIN_LABEL[cd.origin]}{cd.originLabel ? ` · ${cd.originLabel}` : ''}</Tag>
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

      <Card title="Linha do tempo · 24h" right={<span className="app-mono" style={{ fontSize: 10 }}>−24h · −18h · −12h · −6h · agora</span>}>
        {(d?.gantt ?? []).length === 0 && <span className="app-muted">Nenhuma execução nas últimas 24 horas.</span>}
        {(d?.gantt ?? []).map((g) => (
          <div key={g.agentId} style={{ display: 'grid', gridTemplateColumns: '100px minmax(0,1fr)', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <button onClick={() => openApp('agents', g.agentId)} style={{ border: 'none', background: 'transparent', color: '#c9cde0', textAlign: 'left', cursor: 'pointer', padding: 0, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {g.agent}
            </button>
            <div style={{ position: 'relative', height: 14, borderRadius: 4, background: 'rgba(255,255,255,.03)' }}>
              {[25, 50, 75].map((x) => <span key={x} style={{ position: 'absolute', left: `${x}%`, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,.05)' }} />)}
              {g.spans.map((sp, i) => {
                const x = pos(sp.start)
                const w = Math.max(0.6, pos(sp.end ?? new Date().toISOString()) - x)
                const color = sp.state === 'failed' ? C.crit : sp.state === 'running' ? C.cyan : sp.state === 'waiting_approval' ? C.warn : agentColor(g.agentId)
                return (
                  <span
                    key={i}
                    title={`${sp.task} — ${new Date(sp.start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
                    className={sp.state === 'running' ? 'app-pulse' : undefined}
                    style={{ position: 'absolute', top: 2, height: 10, left: `${x}%`, width: `${w}%`, borderRadius: 3, background: color, opacity: sp.state === 'done' ? 0.8 : 1 }}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </Card>
    </>
  )
}
