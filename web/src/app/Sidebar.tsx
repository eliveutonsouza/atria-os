import { useEffect } from 'react'
import type { AppPage } from '@shared/protocol'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { enterApp, exitApp } from './nav'
import { NavIcon, useNavGroups } from './navItems'

// Sidebar (Sidebar.dc.html): aparece ao encostar o mouse na borda esquerda; fixável; drawer no celular.

export const SIDEBAR_W = 248


export function openPage(page: AppPage) {
  const s = useYui.getState()
  if (s.shellMode === 'app') {
    s.set({ appPage: page, appParams: {}, sidebarOpen: s.sidebarPinned && s.device === 'desktop' ? s.sidebarOpen : false })
  } else enterApp(page)
}

let closeTimer: ReturnType<typeof setTimeout> | undefined

export function Sidebar() {
  const app = useYui((s) => s.shellMode === 'app')
  const page = useYui((s) => s.appPage)
  const open = useYui((s) => s.sidebarOpen)
  const pinned = useYui((s) => s.sidebarPinned)
  const device = useYui((s) => s.device)
  const coarse = useYui((s) => s.coarse)
  const desktop = device === 'desktop'
  const status = useYui((s) => s.status)
  const userName = useYui((s) => s.userName)
  // fixada só no desktop; no tablet abre pelo "Mais" do rail, no celular há a aba "Mais"
  const docked = app && pinned && desktop
  const visible = docked || open

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

  // Esc fecha a sidebar flutuante
  useEffect(() => {
    if (!open || docked) return
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') set({ sidebarOpen: false })
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, docked, set])

  const groups = useNavGroups(visible)

  const togglePin = () => {
    const next = !pinned
    try {
      localStorage.setItem('yui.sidebarPinned', next ? '1' : '0')
    } catch {
      /* armazenamento indisponível */
    }
    set({ sidebarPinned: next, sidebarOpen: next })
  }

  const overlay = open && !docked && (!desktop || coarse)
  return (
    <>
      {/* zona quente na borda esquerda (desktop) */}
      {desktop && !coarse && !visible && <div aria-hidden onMouseEnter={show} onMouseMove={show} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 10, zIndex: 37 }} />}
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
          {desktop && (
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
                    display: 'flex', alignItems: 'center', gap: 11, height: coarse ? 44 : 36, padding: '0 10px', borderRadius: 10, fontSize: 13.5, cursor: 'pointer', textAlign: 'left',
                    color: on ? C.text : C.t2, background: on ? 'rgba(103,216,242,.08)' : 'transparent', border: `1px solid ${on ? 'rgba(103,216,242,.22)' : 'transparent'}`,
                  }}
                >
                  <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: on ? C.cyan : C.t3 }}>
                    <NavIcon id={it.id} />
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
