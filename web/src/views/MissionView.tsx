import { useState } from 'react'
import type { MissionInfo, MissionStep, StepStatus } from '@shared/protocol'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { Empty, ErrorNote, Eyebrow, Skeleton, useHeader } from './ui'

// Missão: plano de execução multi-agente (PRD §94/§36) — grafo de etapas + lista com estado ao vivo.

const ST: Record<StepStatus, { icon: string; c: string; label: string }> = {
  pending: { icon: '○', c: C.t3, label: 'na fila' },
  waiting_approval: { icon: '◐', c: C.warn, label: 'aguardando seu OK' },
  running: { icon: '●', c: C.cyan, label: 'trabalhando' },
  done: { icon: '✓', c: C.ok, label: 'concluída' },
  failed: { icon: '⚠', c: C.crit, label: 'falhou' },
  skipped: { icon: '–', c: C.t3, label: 'pulada' },
  cancelled: { icon: '×', c: C.t3, label: 'cancelada' },
}

const MST: Record<MissionInfo['status'], { c: string; label: string }> = {
  running: { c: C.cyan, label: 'Em execução' },
  paused: { c: C.t2, label: 'Pausada' },
  blocked: { c: C.warn, label: 'Precisa de você' },
  done: { c: C.ok, label: 'Concluída' },
  failed: { c: C.crit, label: 'Com falhas' },
  cancelled: { c: C.t3, label: 'Cancelada' },
}

export function MissionView() {
  const id = useYui((s) => s.viewParams.missionId)
  const live = useYui((s) => (id ? s.missions[id] : undefined))
  const { data, loading, error, reload } = useApi<MissionInfo>(id ? `/api/missions/${encodeURIComponent(id)}` : null, [id])
  const m = live ?? data
  const act = (a: 'pause' | 'resume' | 'cancel' | 'retry') => () => {
    if (!id) return
    api.post<MissionInfo>(`/api/missions/${id}/${a}`).then((r) => {
      if (r) useYui.getState().set({ missions: { ...useYui.getState().missions, [r.id]: r } })
      reload()
    }).catch(() => {})
  }
  const actions = !m
    ? []
    : m.status === 'running'
      ? [{ label: 'Pausar', fn: act('pause') }, { label: 'Cancelar', fn: act('cancel') }]
      : m.status === 'paused'
        ? [{ label: 'Retomar', fn: act('resume') }, { label: 'Cancelar', fn: act('cancel') }]
        : m.status === 'blocked' || m.status === 'failed'
          ? [{ label: 'Tentar de novo', fn: act('retry') }, ...(m.status === 'blocked' ? [{ label: 'Cancelar', fn: act('cancel') }] : [])]
          : []
  useHeader('Mission', m?.title ?? 'Missão', actions, [m?.status, m?.id])
  if (!id) return <Empty text="Nenhuma missão aberta." hint="Peça algo grande: “Yui, cria uma landing page para uma clínica.”" />
  if (loading && !m) return <Skeleton kpis={0} rows={5} />
  if (error || !m) return <ErrorNote text="Não encontrei essa missão." />

  const done = m.steps.filter((s) => s.status === 'done').length
  const pct = Math.round((done / Math.max(1, m.steps.length)) * 100)
  const ms = MST[m.status]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: ms.c, fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ms.c, boxShadow: `0 0 10px ${ms.c}` }} />
            {ms.label}
          </span>
          <span style={{ fontSize: 13, color: C.t3 }}>{done}/{m.steps.length} etapas{m.project ? ` · ${m.project}` : ''}</span>
        </div>
        <div style={{ fontSize: 15, color: '#c9cde0', lineHeight: 1.6, maxWidth: 820, textWrap: 'pretty' }}>{m.goal}</div>
        <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,.07)', overflow: 'hidden', maxWidth: 820 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: m.status === 'failed' ? C.crit : `linear-gradient(90deg, ${C.cyan}, ${C.violet})`, transition: 'width .4s' }} />
        </div>
      </div>
      <Graph steps={m.steps} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Eyebrow style={{ marginBottom: 6 }}>Etapas</Eyebrow>
        {m.steps.map((s, i) => <StepRow key={s.id} step={s} n={i + 1} />)}
      </div>
    </div>
  )
}

// ---------- grafo: colunas por profundidade de dependência ----------

function levels(steps: MissionStep[]): Map<string, number> {
  const lv = new Map<string, number>()
  const byId = new Map(steps.map((s) => [s.id, s]))
  const depth = (id: string, seen = new Set<string>()): number => {
    if (lv.has(id)) return lv.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const s = byId.get(id)
    const d = s && s.dependsOn.length ? 1 + Math.max(...s.dependsOn.map((x) => depth(x, seen))) : 0
    lv.set(id, d)
    return d
  }
  steps.forEach((s) => depth(s.id))
  return lv
}

function Graph({ steps }: { steps: MissionStep[] }) {
  const lv = levels(steps)
  const cols = Math.max(...steps.map((s) => lv.get(s.id) ?? 0)) + 1
  const byCol: MissionStep[][] = Array.from({ length: cols }, () => [])
  steps.forEach((s) => byCol[lv.get(s.id) ?? 0].push(s))
  const rows = Math.max(...byCol.map((c) => c.length))
  const W = 190, H = 64, GX = 56, GY = 18
  const width = cols * W + (cols - 1) * GX
  const height = rows * H + (rows - 1) * GY
  const pos = new Map<string, { x: number; y: number }>()
  byCol.forEach((col, ci) => {
    const off = ((rows - col.length) * (H + GY)) / 2
    col.forEach((s, ri) => pos.set(s.id, { x: ci * (W + GX), y: off + ri * (H + GY) }))
  })
  return (
    <div style={{ overflowX: 'auto', padding: '6px 2px' }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafo de etapas da missão" style={{ display: 'block', minWidth: width }}>
        {steps.flatMap((s) =>
          s.dependsOn.map((d) => {
            const a = pos.get(d), b = pos.get(s.id)
            if (!a || !b) return null
            const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2
            const active = steps.find((x) => x.id === d)?.status === 'done'
            return <path key={`${d}-${s.id}`} d={`M${x1},${y1} C${x1 + GX / 2},${y1} ${x2 - GX / 2},${y2} ${x2},${y2}`} fill="none" stroke={active ? 'rgba(103,216,242,.55)' : 'rgba(255,255,255,.12)'} strokeWidth="1.2" />
          }),
        )}
        {steps.map((s) => {
          const p = pos.get(s.id)!
          const st = ST[s.status]
          return (
            <g key={s.id} transform={`translate(${p.x},${p.y})`}>
              <rect width={W} height={H} rx="14" fill={s.status === 'running' ? 'rgba(103,216,242,.08)' : 'rgba(255,255,255,.03)'} stroke={s.status === 'running' ? 'rgba(103,216,242,.4)' : 'rgba(255,255,255,.08)'} />
              <circle cx="18" cy={H / 2} r="4.5" fill={s.status === 'pending' || s.status === 'skipped' || s.status === 'cancelled' ? 'none' : st.c} stroke={st.c}>
                {s.status === 'running' && <animate attributeName="opacity" values="1;.35;1" dur="1.6s" repeatCount="indefinite" />}
              </circle>
              <text x="32" y={H / 2 - 5} fill="#e8eaf4" fontSize="13" fontWeight="600" fontFamily="Manrope, sans-serif">{clip(s.title, 20)}</text>
              <text x="32" y={H / 2 + 13} fill={C.t2} fontSize="11.5" fontFamily="Manrope, sans-serif">{clip(`${s.agent} · ${st.label}`, 26)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function StepRow({ step, n }: { step: MissionStep; n: number }) {
  const [open, setOpen] = useState(step.status === 'failed')
  const st = ST[step.status]
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
      <button
        onClick={() => setOpen(!open)}
        className="hov-row"
        style={{ width: '100%', display: 'grid', gridTemplateColumns: '28px 20px minmax(0,1fr) auto', alignItems: 'center', gap: 12, padding: '13px 0', border: 'none', background: 'transparent', color: C.text, textAlign: 'left', cursor: 'pointer' }}
      >
        <span className="mono" style={{ fontSize: 12, color: C.t3 }}>{String(n).padStart(2, '0')}</span>
        <span style={{ color: st.c, textAlign: 'center' }}>{st.icon}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{step.title}{step.risky && <span style={{ marginLeft: 8, fontSize: 11, color: C.warn, fontWeight: 500 }}>precisa de OK</span>}</span>
          <span style={{ fontSize: 13, color: C.t2 }}>{step.agent}{step.dependsOn.length ? ` · depois de ${step.dependsOn.join(', ')}` : ''}</span>
        </span>
        <span style={{ fontSize: 12, color: st.c, whiteSpace: 'nowrap' }}>{st.label}</span>
      </button>
      {open && (
        <div style={{ padding: '0 0 16px 60px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, color: '#b4b9cf', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{step.instruction}</div>
          {step.result && (
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.06)', fontSize: 13, color: '#d6d9e8', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{step.result}</div>
          )}
          {step.runId && (
            <button
              onClick={() => useYui.getState().show('runs', { runId: step.runId! })}
              style={{ alignSelf: 'flex-start', height: 30, padding: '0 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.03)', color: '#dfe3f3', fontSize: 12, cursor: 'pointer' }}
            >
              Ver execução
            </button>
          )}
        </div>
      )}
    </div>
  )
}
