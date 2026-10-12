import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, RunInfo } from '@shared/protocol'
import { api } from '../api/client'
import { C, toneColor } from '../lib/colors'
import { confirmAction, toastErr, toastOk } from '../lib/feedback'
import { useYui } from '../store/yui'

// Seletor de projeto e painel de execuções da tela principal: várias tarefas rodam ao mesmo tempo
// em projetos diferentes; cada projeto tem a própria conversa com a Yui.

const ACTIVE: RunInfo['state'][] = ['running', 'queued', 'waiting_approval']
const unreadKey = (slug: string | null) => slug ?? ''

/** Troca o projeto da conversa (null = Geral) e carrega o histórico dele. */
export async function switchProject(slug: string | null) {
  const s = useYui.getState()
  const unread = { ...s.unread }
  delete unread[unreadKey(slug)]
  s.set({ activeProject: slug, unread, projectsOpen: false })
  try {
    const r = await api.post<{ activeProject: string | null; history: ChatMessage[] }>('/api/projects/active', { slug })
    if (useYui.getState().activeProject === r.activeProject) useYui.getState().set({ hist: r.history })
  } catch {
    useYui.getState().say('Não consegui trocar de projeto agora.')
  }
}

/** Cancela uma execução depois de confirmar; avisa se falhar. */
async function cancelRun(r: RunInfo) {
  const queued = r.state === 'queued'
  const ok = await confirmAction({
    title: queued ? 'Tirar da fila?' : 'Cancelar esta execução?',
    text: queued ? `“${r.task}” sai da fila e não vai rodar.` : `“${r.task}” para agora; o que já foi feito fica como está.`,
    confirmLabel: queued ? 'Tirar da fila' : 'Cancelar execução',
    cancelLabel: 'Voltar',
    danger: true,
  })
  if (!ok) return
  try {
    await api.post(`/api/runs/${r.id}/cancel`)
    toastOk(queued ? 'Tirada da fila.' : 'Execução cancelada.')
  } catch (e) {
    toastErr(e, 'Não consegui cancelar')
  }
}

/** Execuções conhecidas (store) + as do servidor, para o contador e o painel. */
export function useRunsFeed(intervalMs = 20000) {
  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .get<{ runs: RunInfo[] }>('/api/runs')
        .then((d) => {
          if (!alive) return
          const s = useYui.getState()
          s.set({ runs: { ...s.runs, ...Object.fromEntries(d.runs.map((r) => [r.id, r])) } })
        })
        .catch(() => {})
    load()
    const t = setInterval(load, intervalMs)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [intervalMs])
}

export function useRunCounts() {
  const runs = useYui((s) => s.runs)
  return useMemo(() => {
    const all = Object.values(runs)
    const running = all.filter((r) => r.state === 'running').length
    const queued = all.filter((r) => r.state === 'queued').length
    const waiting = all.filter((r) => r.state === 'waiting_approval').length
    const byProject: Record<string, { running: number; queued: number }> = {}
    for (const r of all) {
      if (!ACTIVE.includes(r.state)) continue
      const k = unreadKey(r.project)
      byProject[k] ??= { running: 0, queued: 0 }
      if (r.state === 'queued') byProject[k].queued++
      else byProject[k].running++
    }
    return { running, queued, waiting, byProject }
  }, [runs])
}

function Badge({ n, c = C.violet }: { n: number; c?: string }) {
  return (
    <span style={{ minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: 9, background: c, color: '#0a0c1d', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {n}
    </span>
  )
}

const chevron = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M6 9l6 6 6-6" />
  </svg>
)

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      // cliques na confirmação (modal por cima) não fecham o painel
      if ((e.target as Element | null)?.closest?.('[aria-modal="true"]')) return
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) close()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

// ---------- seletor de projeto ----------
export function ProjectPicker() {
  const activeProject = useYui((s) => s.activeProject)
  const projects = useYui((s) => s.projects)
  const unread = useYui((s) => s.unread)
  const open = useYui((s) => s.projectsOpen)
  const narrow = useYui((s) => s.narrow)
  const coarse = useYui((s) => s.coarse)
  const { byProject } = useRunCounts()
  const [q, setQ] = useState('')
  const close = () => useYui.getState().set({ projectsOpen: false })
  const ref = useOutside(open, close)
  const name = projects.find((p) => p.slug === activeProject)?.name ?? activeProject ?? 'Geral'
  const otherUnread = Object.entries(unread).reduce((n, [k, v]) => (k === unreadKey(activeProject) ? n : n + v), 0)
  const mine = byProject[unreadKey(activeProject)]
  const list = projects.filter((p) => !q || `${p.name} ${p.slug}`.toLowerCase().includes(q.toLowerCase()))
  const h = coarse ? 44 : 36

  useEffect(() => {
    if (!open) setQ('')
  }, [open])

  const row = (slug: string | null, label: string, dot: string) => {
    const k = unreadKey(slug)
    const c = byProject[k]
    const sel = slug === activeProject
    return (
      <button
        key={k}
        role="option"
        aria-selected={sel}
        onClick={() => void switchProject(slug)}
        className="hov-bg"
        style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: coarse ? 48 : 44, padding: '0 12px', borderRadius: 10, border: 'none', background: sel ? 'rgba(103,216,242,.1)' : 'transparent', color: C.text, fontSize: 13, fontWeight: sel ? 600 : 500, textAlign: 'left', cursor: 'pointer', flexShrink: 0 }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {c?.running ? <span style={{ fontSize: 11, color: '#a9e9f8', fontWeight: 500 }}>{c.running} executando</span> : null}
        {c?.queued ? <span style={{ fontSize: 11, color: C.t3, fontWeight: 500 }}>{c.queued} na fila</span> : null}
        {unread[k] ? <Badge n={unread[k]} /> : null}
        {sel && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="2.4" aria-hidden>
            <path d="M5 12l5 5 9-10" />
          </svg>
        )}
      </button>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 0, flex: narrow ? 1 : undefined }}>
      <button
        onClick={() => useYui.getState().set({ projectsOpen: !open, inboxOpen: false, runsOpen: false })}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Projeto atual: ${name}. Trocar projeto (Ctrl P)`}
        title="Trocar projeto (Ctrl P)"
        className="hov-bg"
        style={{
          display: 'flex', alignItems: 'center', gap: 8, height: h, maxWidth: narrow ? '100%' : 360, width: narrow ? '100%' : undefined, padding: '0 12px', borderRadius: 12, cursor: 'pointer',
          border: `1px solid ${open ? 'rgba(103,216,242,.45)' : 'rgba(255,255,255,.08)'}`, background: open ? 'rgba(103,216,242,.08)' : 'rgba(255,255,255,.03)', color: C.t2, fontSize: 12, fontFamily: 'inherit',
        }}
      >
        {!narrow && <span>Projeto</span>}
        <span style={{ color: C.text, fontWeight: 600, fontSize: narrow ? 13 : 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: narrow ? 1 : undefined, textAlign: 'left', minWidth: 0 }}>{name}</span>
        {mine?.running ? <Badge n={mine.running} c="rgba(103,216,242,.85)" /> : null}
        {otherUnread ? <Badge n={otherUnread} /> : null}
        {chevron}
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Escolher projeto"
          style={{
            position: narrow ? 'fixed' : 'absolute', top: narrow ? 'calc(62px + env(safe-area-inset-top))' : h + 8, left: narrow ? 12 : 0, right: narrow ? 12 : undefined, width: narrow ? undefined : 380,
            maxHeight: 'min(70dvh, 560px)', padding: 10, boxSizing: 'border-box', borderRadius: 16, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(14,17,38,.97)',
            backdropFilter: 'blur(16px)', boxShadow: '0 24px 60px rgba(0,0,0,.55)', display: 'flex', flexDirection: 'column', gap: 4, zIndex: 60, overflowY: 'auto',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 12px', borderRadius: 10, background: 'rgba(255,255,255,.04)', color: C.t3, fontSize: 13, flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              autoFocus={!coarse}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && list[0]) void switchProject(list[0].slug)
              }}
              placeholder="Buscar projeto…"
              aria-label="Buscar projeto"
              style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: C.text, fontSize: 14, fontFamily: 'inherit' }}
            />
            {!coarse && <span className="mono" style={{ fontSize: 11 }}>Ctrl P</span>}
          </label>
          <div style={{ padding: '8px 12px 4px', fontSize: 10, letterSpacing: '.24em', color: C.t3, fontWeight: 600 }}>PROJETOS</div>
          {list.map((p) => row(p.slug, p.name, p.health == null ? C.t4 : toneColor(p.tone, C.t4)))}
          {!list.length && <div style={{ padding: '8px 12px', fontSize: 12, color: C.t3 }}>Nenhum projeto encontrado.</div>}
          <div style={{ height: 1, background: 'rgba(255,255,255,.06)', margin: '4px 0', flexShrink: 0 }} />
          {row(null, 'Geral (sem projeto)', C.t3)}
          <div style={{ padding: '6px 12px 2px', fontSize: 11, color: C.t3, lineHeight: 1.5 }}>Cada projeto tem a própria conversa com a Yui. As tarefas dos outros projetos continuam rodando.</div>
        </div>
      )}
    </div>
  )
}

// ---------- painel de execuções ----------
function elapsedLabel(r: RunInfo) {
  if (!r.startedAt) return ''
  const m = Math.max(0, Math.round((Date.now() - new Date(r.startedAt).getTime()) / 60000))
  return m < 1 ? 'agora' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`
}

export function RunsButton() {
  const open = useYui((s) => s.runsOpen)
  const narrow = useYui((s) => s.narrow)
  const coarse = useYui((s) => s.coarse)
  const { running, queued, waiting } = useRunCounts()
  const busy = running + waiting
  const label = narrow ? `${busy}` : busy || queued ? `${busy} executando${queued ? ` · ${queued} na fila` : ''}` : 'Nenhuma execução'
  return (
    <button
      onClick={() => useYui.getState().set({ runsOpen: !open, projectsOpen: false, inboxOpen: false })}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Execuções: ${busy} executando, ${queued} na fila`}
      className="hov-bg"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, height: coarse ? 44 : 32, minWidth: coarse ? 44 : undefined, padding: '0 12px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
        border: `1px solid ${open ? 'rgba(103,216,242,.6)' : busy ? 'rgba(103,216,242,.25)' : 'rgba(255,255,255,.08)'}`,
        background: open ? 'rgba(103,216,242,.14)' : busy ? 'rgba(103,216,242,.06)' : 'transparent', color: busy ? '#a9e9f8' : C.t2, fontSize: 12, fontWeight: 600,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: busy ? C.cyan : C.t3 }} />
      {label}
    </button>
  )
}

export function RunsPopover() {
  const open = useYui((s) => s.runsOpen)
  const runs = useYui((s) => s.runs)
  const projects = useYui((s) => s.projects)
  const approvals = useYui((s) => s.approvals)
  const activeProject = useYui((s) => s.activeProject)
  const narrow = useYui((s) => s.narrow)
  const coarse = useYui((s) => s.coarse)
  const max = useYui((s) => s.maxConcurrent)
  const close = () => useYui.getState().set({ runsOpen: false })
  const ref = useOutside(open, close)
  const { running } = useRunCounts()
  if (!open) return null

  const recent = Date.now() - 10 * 60_000
  const shown = Object.values(runs).filter((r) => ACTIVE.includes(r.state) || (r.finishedAt && new Date(r.finishedAt).getTime() > recent))
  const groups = new Map<string, RunInfo[]>()
  for (const r of shown) {
    const k = unreadKey(r.project)
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  // projeto atual primeiro, depois os com mais execuções ativas
  const order = [...groups.keys()].sort((a, b) => {
    if (a === unreadKey(activeProject)) return -1
    if (b === unreadKey(activeProject)) return 1
    return groups.get(b)!.filter((r) => ACTIVE.includes(r.state)).length - groups.get(a)!.filter((r) => ACTIVE.includes(r.state)).length
  })
  const nameOf = (k: string) => (k ? projects.find((p) => p.slug === k)?.name ?? k : 'Geral')
  const btn = { height: coarse ? 44 : 28, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,.1)', background: 'transparent', color: C.t2, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' } as const
  const openRun = (id: string) => {
    close()
    useYui.getState().show('runs', { runId: id })
  }
  const approvalOf = (runId: string) => Object.values(approvals).find((a) => a.runId === runId)

  return (
    <section
      ref={ref}
      aria-label="Execuções"
      style={{
        position: 'absolute', zIndex: 60, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', background: 'rgba(14,17,38,.97)', backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,.08)', boxShadow: '0 24px 60px rgba(0,0,0,.55)', padding: 16,
        ...(narrow
          ? { left: 0, right: 0, bottom: 0, maxHeight: '72dvh', borderRadius: '22px 22px 0 0', paddingBottom: 'calc(20px + var(--sab))' }
          : { top: 'calc(64px + env(safe-area-inset-top))', right: 20, width: 460, maxHeight: 'calc(100% - 180px)', borderRadius: 18 }),
      }}
    >
      {narrow && <div aria-hidden style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.18)', flexShrink: 0 }} />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Execuções</div>
        <div style={{ fontSize: 12, color: C.t3 }}>{Math.min(running, max)} de {max} vagas em uso</div>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,.06)', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ width: `${Math.min(100, (running / max) * 100)}%`, height: 4, background: 'linear-gradient(90deg,#67d8f2,#a68cf7)', transition: 'width .4s' }} />
      </div>
      {!order.length && <div style={{ fontSize: 13, color: C.t3, padding: '8px 0' }}>Nada rodando agora. Peça à Yui por voz ou texto — tarefas de projetos diferentes rodam ao mesmo tempo.</div>}
      {order.map((k) => {
        const list = groups.get(k)!.sort((a, b) => ACTIVE.indexOf(a.state) - ACTIVE.indexOf(b.state))
        const isCur = k === unreadKey(activeProject)
        return (
          <div key={k || 'geral'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, letterSpacing: '.2em', color: C.t2, fontWeight: 600, textTransform: 'uppercase' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(k)}</span>
              {isCur ? (
                <span style={{ letterSpacing: 0, color: C.t3, fontWeight: 500, textTransform: 'none' }}>· projeto atual</span>
              ) : (
                <button onClick={() => void switchProject(k || null)} style={{ ...btn, marginLeft: 'auto', height: coarse ? 44 : 24, letterSpacing: 0, textTransform: 'none', fontSize: 11, color: '#a9e9f8', border: '1px solid rgba(103,216,242,.25)' }}>
                  Ir para o projeto
                </button>
              )}
            </div>
            {list.map((r) => {
              const appr = r.state === 'waiting_approval' ? approvalOf(r.id) : undefined
              const done = !ACTIVE.includes(r.state)
              if (done)
                return (
                  <button key={r.id} onClick={() => openRun(r.id)} className="hov-bg" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, border: `1px solid ${r.state === 'done' ? 'rgba(166,140,247,.25)' : 'rgba(240,98,114,.25)'}`, background: r.state === 'done' ? 'rgba(166,140,247,.08)' : 'rgba(240,98,114,.06)', color: C.text, fontSize: 12, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <span style={{ color: r.state === 'done' ? C.violet : C.crit }}>{r.state === 'done' ? '✓' : '!'}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.task}</span>
                    <span style={{ fontSize: 11, color: C.t3 }}>{r.state === 'done' ? 'concluída' : r.state === 'cancelled' ? 'cancelada' : 'falhou'}</span>
                  </button>
                )
              if (r.state === 'queued')
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, border: '1px dashed rgba(255,255,255,.12)', fontSize: 12, color: C.t3 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Na fila · {r.task}</span>
                    <button onClick={() => void cancelRun(r)} style={btn}>Cancelar</button>
                  </div>
                )
              return (
                <div key={r.id} style={{ padding: 12, borderRadius: 12, background: appr ? 'rgba(245,181,74,.05)' : 'rgba(255,255,255,.03)', border: `1px solid ${appr || r.state === 'waiting_approval' ? 'rgba(245,181,74,.25)' : 'rgba(255,255,255,.06)'}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.workflowRunId ? 'Workflow · ' : r.missionId ? 'Missão · ' : ''}
                      {r.task}
                    </span>
                    <span style={{ fontSize: 11, color: r.state === 'waiting_approval' ? '#f5c97a' : '#a9e9f8', whiteSpace: 'nowrap' }}>{r.state === 'waiting_approval' ? 'aguarda você' : `${r.agent} · ${elapsedLabel(r)}`}</span>
                  </div>
                  {r.state === 'running' && (
                    <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,.06)' }}>
                      <div style={{ width: `${Math.max(4, r.progress)}%`, height: 3, borderRadius: 2, background: r.workflowRunId ? C.violet : C.cyan, transition: 'width .4s' }} />
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 11, color: C.t3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.currentOp ?? ''}</span>
                    {appr && (
                      <button
                        onClick={() => {
                          close()
                          useYui.getState().set({ approvalOpen: appr.id, yst: 'warning' })
                        }}
                        style={{ ...btn, border: 'none', background: C.warn, color: '#1a1205', fontWeight: 600 }}
                      >
                        Revisar
                      </button>
                    )}
                    <button onClick={() => openRun(r.id)} style={{ ...btn, color: C.cyan }}>Ver</button>
                    <button onClick={() => void cancelRun(r)} style={btn}>Cancelar</button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
      <button
        onClick={() => {
          close()
          useYui.getState().show('runs')
        }}
        style={{ alignSelf: 'center', border: 'none', background: 'transparent', color: C.cyan, fontSize: 12, cursor: 'pointer', padding: 8, fontFamily: 'inherit' }}
      >
        Abrir todas as execuções
      </button>
    </section>
  )
}
