import { useEffect, useRef } from 'react'
import type { AppPage, OpsBoard } from '@shared/protocol'
import { useApi } from '../api/useApi'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { enterApp, exitApp } from './nav'

// Sidebar (Sidebar.dc.html): aparece ao encostar o mouse na borda esquerda; fixável; drawer no celular.

export const SIDEBAR_W = 248

const ICON: Record<AppPage, string> = {
  overview: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  ops: 'M4 6h16M4 12h10M4 18h6M18 15l3 3-3 3',
  agents: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6M2 20c0-3 3-5 6-5s6 2 6 5M16 15c3 0 6 2 6 5',
  runs: 'M5 4l14 8-14 8z',
  missions: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8l5.5-.8z',
  workflows: 'M6 3v6M6 15v6M18 9v6M6 9a3 3 0 1 0 0 6M18 9a3 3 0 1 0 0-6M9 12h6',
  schedule: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  projects: 'M3 7h7l2 2h9v10H3z',
  browser: 'M3 5h18v14H3zM3 9h18M7 7h.01M10 7h.01',
  terminal: 'M4 5h16v14H4zM8 10l2 2-2 2M12 15h4',
  claude: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  tools: 'M14 7l3-3 3 3-3 3M4 20l9-9M10 4a4 4 0 0 0 5 5',
  inbox: 'M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  infra: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
}

type Item = { id: AppPage; label: string; count?: number; warn?: boolean }

export function openPage(page: AppPage) {
  const s = useYui.getState()
  if (s.shellMode === 'app') {
    s.set({ appPage: page, appParams: {}, sidebarOpen: s.sidebarPinned && !s.narrow ? s.sidebarOpen : false })
  } else enterApp(page)
}

let closeTimer: ReturnType<typeof setTimeout> | undefined

export function Sidebar() {
  const app = useYui((s) => s.shellMode === 'app')
  const page = useYui((s) => s.appPage)
  const open = useYui((s) => s.sidebarOpen)
  const pinned = useYui((s) => s.sidebarPinned)
  const narrow = useYui((s) => s.narrow)
  const inbox = useYui((s) => s.inbox)
  const working = useYui((s) => s.agentsWorking)
  const status = useYui((s) => s.status)
  const userName = useYui((s) => s.userName)
  const missions = useYui((s) => s.missions)
  const coarse = useRef(typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)
  const docked = app && pinned && !narrow
  const visible = docked || open
  const board = useApi<OpsBoard>(visible ? '/api/ops/board' : null, [visible], 15000)

  const set = useYui((s) => s.set)
  const show = () => {
    clearTimeout(closeTimer)
    if (!useYui.getState().sidebarOpen) set({ sidebarOpen: true })
  }
  const hideSoon = () => {
    clearTimeout(closeTimer)
    if (docked) return
    closeTimer = setTimeout(() => set({ sidebarOpen: false }), 300)
  }

  // gesto de borda no toque: arrastar da borda esquerda abre
  useEffect(() => {
    let startX = -1, startY = 0
    const ts = (e: TouchEvent) => {
      const t = e.touches[0]
      startX = t.clientX < 18 ? t.clientX : -1
      startY = t.clientY
    }
    const tm = (e: TouchEvent) => {
      if (startX < 0) return
      const t = e.touches[0]
      if (t.clientX - startX > 40 && Math.abs(t.clientY - startY) < 50) {
        startX = -1
        useYui.getState().set({ sidebarOpen: true })
      }
    }
    window.addEventListener('touchstart', ts, { passive: true })
    window.addEventListener('touchmove', tm, { passive: true })
    return () => {
      window.removeEventListener('touchstart', ts)
      window.removeEventListener('touchmove', tm)
    }
  }, [])

  // Esc fecha a sidebar flutuante
  useEffect(() => {
    if (!open || docked) return
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') set({ sidebarOpen: false })
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, docked, set])

  const p = board.data?.pipeline
  const activeMissions = p?.missions ?? Object.values(missions).filter((m) => m.status === 'running' || m.status === 'paused' || m.status === 'blocked').length
  const groups: { name: string; items: Item[] }[] = [
    {
      name: 'Acompanhar',
      items: [
        { id: 'overview', label: 'Visão geral' },
        { id: 'ops', label: 'Operações', count: p ? p.running + p.queued : undefined },
        { id: 'agents', label: 'Agentes', count: working || undefined },
        { id: 'runs', label: 'Execuções' },
        { id: 'inbox', label: 'Aprovações', count: inbox.length || undefined, warn: true },
      ],
    },
    {
      name: 'Organizar',
      items: [
        { id: 'missions', label: 'Missões', count: activeMissions || undefined },
        { id: 'workflows', label: 'Workflows', count: p?.workflows || undefined },
        { id: 'schedule', label: 'Agendamentos' },
        { id: 'projects', label: 'Projetos' },
      ],
    },
    {
      name: 'Ferramentas',
      items: [
        { id: 'browser', label: 'Navegador' },
        { id: 'terminal', label: 'Terminal' },
        { id: 'claude', label: 'Claude Code' },
        { id: 'tools', label: 'Conectores & MCP' },
      ],
    },
    { name: 'Sistema', items: [{ id: 'infra', label: 'Infra & logs' }, { id: 'settings', label: 'Configurações' }] },
  ]

  const togglePin = () => {
    const next = !pinned
    try {
      localStorage.setItem('yui.sidebarPinned', next ? '1' : '0')
    } catch {
      /* armazenamento indisponível */
    }
    set({ sidebarPinned: next, sidebarOpen: next })
  }

  const overlay = open && !docked && (narrow || coarse.current)
  return (
    <>
      {/* zona quente na borda esquerda (desktop) */}
      {!narrow && !visible && <div aria-hidden onMouseEnter={show} onMouseMove={show} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 10, zIndex: 37 }} />}
      {/* alça visível em toque/celular */}
      {(narrow || coarse.current) && !visible && (
        <button
          aria-label="Abrir menu"
          onClick={() => set({ sidebarOpen: true })}
          style={{ position: 'absolute', left: 0, top: '50%', width: 14, height: 56, marginTop: -28, zIndex: 37, border: 'none', borderRadius: '0 10px 10px 0', background: 'rgba(103,216,242,.18)', cursor: 'pointer', padding: 0 }}
        />
      )}
      {overlay && <div onClick={() => set({ sidebarOpen: false })} style={{ position: 'absolute', inset: 0, zIndex: 37, background: 'rgba(4,5,12,.5)', backdropFilter: 'blur(2px)' }} />}
      <nav
        aria-label="Navegação"
        aria-hidden={!visible}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: SIDEBAR_W, zIndex: 38, boxSizing: 'border-box',
          padding: 'calc(18px + env(safe-area-inset-top)) 12px calc(14px + env(safe-area-inset-bottom))',
          display: 'flex', flexDirection: 'column', gap: 4, background: 'rgba(12,14,30,.92)', borderRight: '1px solid rgba(160,170,255,.12)',
          backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
          boxShadow: visible && !docked ? '30px 0 80px rgba(0,0,0,.55)' : 'none',
          transform: visible ? 'translateX(0)' : `translateX(-${SIDEBAR_W + 12}px)`,
          transition: 'transform .42s cubic-bezier(.2,.9,.25,1.08), box-shadow .3s, visibility .42s',
          visibility: visible ? 'visible' : 'hidden', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 14px' }}>
          <button
            onClick={() => exitApp()}
            title="Conversar com a Yui (Ctrl+J)"
            style={{ display: 'flex', alignItems: 'center', gap: 10, border: 'none', background: 'transparent', color: C.text, cursor: 'pointer', padding: 0 }}
          >
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'radial-gradient(circle at 38% 34%, #ffffff, #67d8f2 34%, #a68cf7 78%)', boxShadow: '0 0 18px rgba(103,216,242,.45)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.18em' }}>YUI</span>
            <span className="mono" style={{ fontSize: 11, color: C.t3 }}>console</span>
          </button>
          {!narrow && (
            <button
              aria-label={pinned ? 'Desafixar sidebar' : 'Fixar sidebar'}
              aria-pressed={pinned}
              title={pinned ? 'Desafixar' : 'Fixar aberta'}
              onClick={togglePin}
              style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid rgba(255,255,255,.08)', background: pinned ? 'rgba(103,216,242,.12)' : 'transparent', color: pinned ? C.cyan : C.t3, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M9 4h6l-1 6 3 3H7l3-3z" /><path d="M12 13v7" /></svg>
            </button>
          )}
        </div>
        {groups.map((g) => (
          <div key={g.name} style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 10 }}>
            <div style={{ fontSize: 10, letterSpacing: '.2em', textTransform: 'uppercase', color: C.t3, fontWeight: 600, padding: '0 10px 6px' }}>{g.name}</div>
            {g.items.map((it) => {
              const on = app && it.id === page
              return (
                <button
                  key={it.id}
                  onClick={() => openPage(it.id)}
                  aria-current={on ? 'page' : undefined}
                  className={on ? undefined : 'hov-item'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 11, height: 36, padding: '0 10px', borderRadius: 10, fontSize: 13.5, cursor: 'pointer', textAlign: 'left',
                    color: on ? C.text : C.t2, background: on ? 'rgba(103,216,242,.08)' : 'transparent', border: `1px solid ${on ? 'rgba(103,216,242,.22)' : 'transparent'}`,
                  }}
                >
                  <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: on ? C.cyan : C.t3 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[it.id]} /></svg>
                  </span>
                  <span style={{ flex: 1 }}>{it.label}</span>
                  {it.count !== undefined && (
                    <span
                      style={{
                        minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: it.warn ? 'rgba(245,181,74,.16)' : 'rgba(103,216,242,.14)', color: it.warn ? '#f5c97a' : '#a9e9f8',
                      }}
                    >
                      {it.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
        <div style={{ flex: 1, minHeight: 12 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
          <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#1b2045', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#a9e9f8' }}>
            {(userName || 'Y').slice(0, 1).toUpperCase()}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userName || 'Você'}</span>
            <span style={{ fontSize: 11, color: C.t3 }}>
              Claude {status.claude ? 'ok' : 'off'} · OpenAI {status.openai ? 'ok' : 'off'}
            </span>
          </div>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: status.claude && status.openai ? C.ok : C.warn, boxShadow: `0 0 8px ${status.claude && status.openai ? C.ok : C.warn}` }} />
        </div>
      </nav>
    </>
  )
}
