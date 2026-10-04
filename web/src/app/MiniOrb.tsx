import { useEffect, useRef, useState } from 'react'
import { submitText } from '../lib/actions'
import { C } from '../lib/colors'
import { dockInput, STATE_META } from '../shell/parts'
import { useYui } from '../store/yui'
import { orbTarget } from '../yui/orbEngine'
import { exitApp } from './nav'

// Yui minimizada (modo app): o orb continua vivo no canvas; aqui ficam o botão sobre ele,
// o selo de pendências, a bolha com a última fala e um mini campo de texto (Ctrl+L).
export function MiniOrb() {
  const app = useYui((s) => s.shellMode === 'app')
  const narrow = useYui((s) => s.narrow)
  const msg = useYui((s) => s.msg)
  const yst = useYui((s) => s.yst)
  const inbox = useYui((s) => s.inbox)
  const transcript = useYui((s) => s.liveTranscript)
  const drawer = useYui((s) => s.sidebarOpen && s.narrow)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [bubble, setBubble] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [hover, setHover] = useState(false)
  const lastMsg = useRef(msg)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const r = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', r)
    return () => window.removeEventListener('resize', r)
  }, [])

  // fala nova da Yui com ela minimizada → bolha por ~8 s
  useEffect(() => {
    if (msg === lastMsg.current) return
    lastMsg.current = msg
    if (!app || !msg) return
    setBubble(msg)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setBubble(null), 8000)
  }, [msg, app])
  useEffect(() => {
    if (!app) setBubble(null)
  }, [app])

  if (!app) return null
  const T = orbTarget('center', narrow, size.w, size.h, true)
  const [label, color] = STATE_META[yst] ?? STATE_META.idle
  const showInput = focused || !!text
  const live = transcript && (yst === 'listening' || yst === 'thinking')
  const send = () => {
    const t = text.trim()
    if (!t) return
    setText('')
    submitText(t)
  }
  const right = size.w - T.x + 40
  const bottom = size.h - T.y - 22
  return (
    <>
      {(bubble || live || hover) && !showInput && !drawer && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute', right, bottom, zIndex: 46, maxWidth: narrow ? 'calc(100vw - 110px)' : 300, padding: '10px 14px',
            borderRadius: '14px 14px 4px 14px', background: 'rgba(16,20,42,.92)', border: '1px solid rgba(160,170,255,.16)', backdropFilter: 'blur(14px)',
            boxShadow: '0 18px 50px rgba(0,0,0,.4)', fontSize: 12.5, lineHeight: 1.45, color: '#c9cde0', animation: 'yui-pop .28s var(--ease)',
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: '.22em', color, fontWeight: 600, marginBottom: 4 }}>YUI · {label.toUpperCase()}</div>
          {live ? <span style={{ color: C.t2 }}>“{transcript}”</span> : bubble ?? 'Clique para conversar · Ctrl+L para digitar · segure Espaço para falar'}
        </div>
      )}
      <div
        style={{
          position: 'absolute', right, bottom: bottom - 4, zIndex: 46, display: 'flex', alignItems: 'center', gap: 6,
          width: showInput ? (narrow ? 'calc(100vw - 100px)' : 320) : 0, opacity: showInput ? 1 : 0, overflow: 'hidden', transition: 'width .3s var(--ease), opacity .2s',
          padding: showInput ? 6 : 0, borderRadius: 14, background: 'rgba(16,20,42,.94)', border: showInput ? '1px solid rgba(103,216,242,.35)' : 'none',
        }}
      >
        <input
          ref={(el) => {
            dockInput.miniEl = el
          }}
          aria-label="Mensagem para Yui (minimizada)"
          placeholder="Fale com a Yui…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
          }}
          style={{ flex: 1, minWidth: 0, height: 32, border: 'none', outline: 'none', background: 'transparent', color: C.text, fontSize: 14, fontFamily: 'var(--sans)', padding: '0 6px' }}
        />
        <button aria-label="Enviar" onClick={send} style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#67d8f2,#a68cf7)', color: '#0a0c1d', fontWeight: 700, cursor: 'pointer' }}>
          ↑
        </button>
      </div>
      <button
        aria-label="Falar com a Yui"
        title="Falar com a Yui (Ctrl+J)"
        onClick={() => exitApp()}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        style={{ position: 'absolute', left: T.x - 34, top: T.y - 34, width: 68, height: 68, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', zIndex: 46 }}
      >
        {inbox.length > 0 && (
          <span
            aria-label={`${inbox.length} pendências`}
            style={{ position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: C.warn, color: '#241a06', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {inbox.length}
          </span>
        )}
      </button>
    </>
  )
}
