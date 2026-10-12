import { useEffect, useRef, useState } from 'react'
import type { YuiState } from '@shared/protocol'
import { C, glow, toneColor } from '../lib/colors'
import { submitText } from '../lib/actions'
import { useYui } from '../store/yui'
import { OrbEngine, orbTarget } from '../yui/orbEngine'
import { toggleLive } from '../voice/live'
import { ProjectPicker, RunsButton, useRunsFeed } from './ProjectPicker'

const IS_MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)
const PALETTE_KEY = IS_MAC ? '⌘K' : 'Ctrl K'

export const STATE_META: Record<YuiState, [string, string]> = {
  idle: ['Disponível', C.t2],
  listening: ['Ouvindo', C.cyan],
  thinking: ['Pensando', C.lav],
  delegating: ['Delegando', C.violet],
  working: ['Agentes trabalhando', C.cyan],
  speaking: ['Falando', C.cyan],
  showing: ['Mostrando', C.lav],
  warning: ['Atenção', C.warn],
  success: ['Concluído', C.ok],
}

const SUGGESTIONS = [
  'Como estão meus projetos?',
  'Mostra os agentes.',
  'Mostra o que está acontecendo agora.',
  'Me mostra o site.',
  'Prepare meu relatório.',
]

const PEND_LABELS: Record<string, string> = {
  brief: 'Ver resumo',
  dashboard: 'Mostrar visão geral',
  logs: 'Ver logs',
  approval: 'Revisar deploy',
  runs: 'Ver execuções',
  project: 'Abrir projeto',
  report: 'Ver relatório',
  website: 'Ver preview',
  agents: 'Ver agentes',
}

export function openPending() {
  const s = useYui.getState()
  const p = s.pending
  if (!p) return
  if (p.view === 'approval') {
    if (p.approvalId && s.approvals[p.approvalId]) s.set({ approvalOpen: p.approvalId, pending: null, yst: 'warning' })
    else s.set({ inboxOpen: true, pending: null })
    return
  }
  s.show(p.view, p.params ?? {})
}

// ---------- canvases ----------
export function OrbLayer() {
  const bgRef = useRef<HTMLCanvasElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const engRef = useRef<OrbEngine | null>(null)
  useEffect(() => {
    if (!bgRef.current || !cvRef.current) return
    const eng = new OrbEngine(bgRef.current, cvRef.current, 1)
    engRef.current = eng
    const onResize = () => eng.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      eng.destroy()
    }
  }, [])
  return (
    <>
      <canvas ref={bgRef} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }} />
      <canvas ref={cvRef} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 20, pointerEvents: 'none' }} />
    </>
  )
}

export function OrbButton({ w, h }: { w: number; h: number }) {
  const mode = useYui((s) => s.mode)
  const narrow = useYui((s) => s.narrow)
  const app = useYui((s) => s.shellMode === 'app')
  const listening = useYui((s) => s.listening)
  const connecting = useYui((s) => s.liveConnecting)
  const isC = mode === 'center', isF = mode === 'focus'
  if (app) return null
  const T = orbTarget(mode, narrow, w, h)
  // Yui ao centro: tocar no orb liga/desliga a voz (a conversa continua sendo pela voz).
  if (isC) {
    const on = listening || connecting
    const d = Math.round(T.r * 2.4)
    return (
      <button
        onClick={toggleLive}
        className="orb-hit"
        title={on ? 'Encerrar voz' : 'Falar com a Yui'}
        aria-label={on ? 'Encerrar conversa por voz' : 'Falar com a Yui'}
        aria-pressed={on}
        style={{ position: 'absolute', left: T.x, top: T.y, width: d, height: d, margin: `-${d / 2}px 0 0 -${d / 2}px`, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', zIndex: 26 }}
      />
    )
  }
  if (!(isF || narrow)) return null
  return (
    <button
      onClick={() => (isF ? useYui.getState().setFocus(false) : useYui.getState().close())}
      title="Voltar para Yui"
      aria-label="Voltar para Yui"
      style={{ position: 'absolute', left: T.x, top: T.y, width: 64, height: 64, margin: '-32px 0 0 -32px', borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', zIndex: 45 }}
    />
  )
}

// ---------- top bar ----------
function Dot({ c }: { c: string }) {
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, boxShadow: glow(c, 8) }} />
}

export function TopBar() {
  useRunsFeed()
  const inbox = useYui((s) => s.inbox)
  const status = useYui((s) => s.status)
  const narrow = useYui((s) => s.narrow)
  const coarse = useYui((s) => s.coarse)
  const app = useYui((s) => s.shellMode === 'app')
  const bh = coarse ? 44 : 32 // alvos de toque ≥44px
  const set = useYui((s) => s.set)
  return (
    <div
      aria-hidden={app}
      style={{
        position: 'absolute', top: 'env(safe-area-inset-top)', left: 'env(safe-area-inset-left)', right: 'env(safe-area-inset-right)', height: 60, padding: narrow ? '0 12px' : '0 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, zIndex: 30,
        transition: 'opacity .3s, transform .45s var(--ease), visibility .3s', opacity: app ? 0 : 1, transform: app ? 'translateY(-10px)' : 'none', pointerEvents: app ? 'none' : 'auto', visibility: app ? 'hidden' : 'visible',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: narrow ? 8 : 12, minWidth: 0, flex: narrow ? 1 : undefined }}>
        <button
          onClick={() => set({ palette: true, inboxOpen: false })}
          className="hov-bg"
          aria-label={`Abrir comandos (${PALETTE_KEY})`}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, height: coarse ? 44 : 36, minWidth: coarse ? 44 : undefined, flexShrink: 0, padding: narrow ? 0 : '0 12px 0 10px', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.03)', color: C.text, cursor: 'pointer', fontSize: 13, fontWeight: 600, letterSpacing: '.14em' }}
        >
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #fff, #67d8f2 45%, #a68cf7)' }} />
          {!narrow && <span>ATRIA OS</span>}
          {!narrow && <span className="mono" style={{ fontSize: 11, letterSpacing: 0, color: C.t3, fontWeight: 400 }}>{PALETTE_KEY}</span>}
        </button>
        <ProjectPicker />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {!narrow && (
          <button
            onClick={() => set({ shellMode: 'app', appPage: 'settings', appParams: { id: 'models' }, inboxOpen: false, runsOpen: false })}
            className="hov-bg"
            title="Contas e modelos"
            aria-label={`Claude ${status.claude ? 'conectado' : 'desconectado'}, OpenAI ${status.openai ? 'conectado' : 'desconectado'}. Abrir contas e modelos`}
            style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 12px', height: coarse ? 44 : 32, borderRadius: 10, border: 'none', background: 'transparent', fontSize: 12, color: C.t2, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Dot c={status.claude ? C.ok : C.crit} />Claude</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Dot c={status.openai ? C.ok : C.crit} />OpenAI</span>
          </button>
        )}
        <RunsButton />
        {inbox.length > 0 && (
          <button
            onClick={() => set({ inboxOpen: !useYui.getState().inboxOpen })}
            aria-label={`${inbox.length} pendências`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: bh, minWidth: coarse ? 44 : undefined, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(245,181,74,.25)', background: 'rgba(245,181,74,.06)', color: '#f5c97a', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            <span>{inbox.length}</span>
            {!narrow && <span style={{ fontWeight: 500 }}>pendências</span>}
          </button>
        )}
        <button
          onClick={() => {
            const s = useYui.getState()
            if (s.view === 'terminal' && s.mode !== 'center') s.close()
            else s.show('terminal')
          }}
          className="hov-txt"
          title="Terminal (Ctrl+`)"
          style={{ height: bh, minWidth: coarse ? 44 : undefined, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.03)', color: C.t2, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span className="mono" style={{ fontSize: 11, color: C.cyan }}>&gt;_</span>
          {!narrow && 'Terminal'}
        </button>
        <button
          onClick={() => set({ histOpen: !useYui.getState().histOpen, inboxOpen: false })}
          className="hov-txt"
          title="Conversa"
          aria-label="Conversa"
          style={{ height: bh, minWidth: coarse ? 44 : undefined, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.03)', color: C.t2, fontSize: 12, cursor: 'pointer' }}
        >
          {narrow ? '≡' : 'Conversa'}
        </button>
      </div>
    </div>
  )
}

// ---------- Yui central ----------
export function YuiCenter() {
  const mode = useYui((s) => s.mode)
  const yst = useYui((s) => s.yst)
  const msg = useYui((s) => s.msg)
  const short = useYui((s) => s.short)
  const showLines = useYui((s) => s.showLines)
  const brief = useYui((s) => s.brief)
  const liveTranscript = useYui((s) => s.liveTranscript)
  const app = useYui((s) => s.shellMode === 'app')
  const coarse = useYui((s) => s.coarse)
  const isC = mode === 'center' && !app
  const [label, color] = STATE_META[yst] ?? STATE_META.idle
  const showSugg = !(short && showLines)
  return (
    <div
      aria-live="polite"
      style={{
        position: 'absolute', left: 0, right: 0, top: short ? 'calc(24% + 80px)' : 'calc(36% + 104px)', bottom: 'calc(104px + var(--sab) + var(--kb))', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: short ? 10 : 16, textAlign: 'center', padding: '0 calc(24px + var(--sar, 0px)) 0 calc(24px + var(--sal, 0px))', zIndex: 25,
        transition: 'opacity .3s, transform .55s var(--ease), visibility .3s', opacity: isC ? 1 : 0, transform: isC ? 'none' : app ? 'translateY(14px) scale(.97)' : 'translateX(-80px) scale(.96)', pointerEvents: isC ? 'auto' : 'none', visibility: app ? 'hidden' : 'visible',
      }}
    >
      {yst === 'working' || yst === 'delegating' ? (
        <button
          onClick={() => useYui.getState().set({ runsOpen: true, projectsOpen: false, inboxOpen: false })}
          title="Ver execuções"
          style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, letterSpacing: '.32em', color: C.t2, fontWeight: 600, border: 'none', background: 'transparent', cursor: 'pointer', padding: coarse ? '12px 4px' : '4px', fontFamily: 'inherit' }}
        >
          <span>YUI</span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: C.t4 }} />
          <span style={{ color, letterSpacing: '.2em', textDecoration: 'underline', textUnderlineOffset: 4, textDecorationColor: 'rgba(103,216,242,.4)' }}>{label}</span>
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, letterSpacing: '.32em', color: C.t2, fontWeight: 600 }}>
          <span>YUI</span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: C.t4 }} />
          <span style={{ color, letterSpacing: '.2em' }}>{label}</span>
        </div>
      )}
      <div style={{ fontSize: short ? 24 : 30, fontWeight: 300, lineHeight: 1.3, letterSpacing: '-.01em', maxWidth: 680, textWrap: 'pretty' }}>{msg}</div>
      {liveTranscript && <div style={{ fontSize: 14, color: C.t3, maxWidth: 640 }}>“{liveTranscript}”</div>}
      {showLines && brief && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 15, color: '#b4b9cf' }}>
          {brief.lines.map((bl, i) => (
            <div key={i}>
              <span style={{ color: toneColor(bl.tone), fontWeight: 600 }}>{bl.n}</span> {bl.text}
            </div>
          ))}
          <div style={{ marginTop: 8, color: C.text }}>Quer ver?</div>
        </div>
      )}
      {showSugg && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px 18px', marginTop: short ? 8 : 22, maxWidth: 720, fontSize: 13 }}>
          {SUGGESTIONS.map((t) => (
            <button key={t} onClick={() => submitText(t)} className="hov-sugg" style={{ border: 'none', background: 'transparent', color: C.t3, cursor: 'pointer', padding: '4px 2px', fontSize: 13, minHeight: coarse ? 44 : undefined }}>
              “{t}”
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function YuiLeft() {
  const mode = useYui((s) => s.mode)
  const narrow = useYui((s) => s.narrow)
  const yst = useYui((s) => s.yst)
  const msg = useYui((s) => s.msg)
  const pending = useYui((s) => s.pending)
  const view = useYui((s) => s.view)
  const app = useYui((s) => s.shellMode === 'app')
  const coarse = useYui((s) => s.coarse)
  const isC = mode === 'center', isF = mode === 'focus'
  const vis = !isC && !isF && !narrow && !app
  const [label, color] = STATE_META[yst] ?? STATE_META.idle
  const hasPending = !!pending && pending.view !== view
  return (
    <div
      style={{
        position: 'absolute', left: 0, width: '24%', top: 'calc(34% + 72px)', padding: '0 28px 0 calc(28px + var(--sal, 0px))', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        textAlign: 'center', zIndex: 25, transition: 'opacity .45s, transform .55s', opacity: vis ? 1 : 0, transform: isC ? 'translateX(30%)' : 'none', pointerEvents: vis ? 'auto' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, letterSpacing: '.3em', color: C.t2, fontWeight: 600 }}>
        <span>YUI</span>
        <span style={{ width: 3, height: 3, borderRadius: '50%', background: C.t4 }} />
        <span style={{ color, letterSpacing: '.18em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 15, lineHeight: 1.55, color: '#c9cde0', textWrap: 'pretty', maxWidth: 280, maxHeight: '38dvh', overflow: 'hidden' }}>{msg}</div>
      {hasPending && (
        <button
          onClick={openPending}
          style={{ marginTop: 4, height: coarse ? 44 : 32, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(103,216,242,.3)', background: 'rgba(103,216,242,.08)', color: '#a9e9f8', fontSize: 12, cursor: 'pointer' }}
        >
          {pending?.label || PEND_LABELS[pending!.view] || 'Mostrar'}
        </button>
      )}
    </div>
  )
}

// ---------- dock ----------
// Campo de texto ativo da Yui: o Dock (tela cheia) ou o mini campo junto ao orb minimizado (modo app).
export const dockInput = {
  yuiEl: null as HTMLInputElement | null,
  miniEl: null as HTMLInputElement | null,
  get el(): HTMLInputElement | null {
    return useYui.getState().shellMode === 'app' ? this.miniEl : this.yuiEl
  },
  set el(v: HTMLInputElement | null) {
    this.yuiEl = v
  },
}

// Atalhos do "+": pré-preenchem o campo com o começo do pedido; a Yui continua a conversa por texto ou voz.
const QUICK: { label: string; hint: string; text: string }[] = [
  { label: 'Tarefa para um agente', hint: 'delega agora', text: 'Pede para o agente ' },
  { label: 'Novo workflow', hint: 'passos que se repetem', text: 'Cria um workflow que ' },
  { label: 'Rotina', hint: 'roda num horário', text: 'Todo dia às 8h, ' },
  { label: 'Lembrete', hint: 'aviso na hora', text: 'Me lembra ' },
  { label: 'Missão', hint: 'objetivo grande, várias etapas', text: 'Cria uma missão para ' },
  { label: 'Buscar no histórico', hint: 'conversas e execuções', text: 'O que eu te pedi sobre ' },
]

export function Dock() {
  const [quick, setQuick] = useState(false)
  const mode = useYui((s) => s.mode)
  const narrow = useYui((s) => s.narrow)
  const listening = useYui((s) => s.listening)
  const connecting = useYui((s) => s.liveConnecting)
  const muted = useYui((s) => s.liveMuted)
  const voiceMode = useYui((s) => s.voiceMode)
  const pending = useYui((s) => s.pending)
  const app = useYui((s) => s.shellMode === 'app')
  const coarse = useYui((s) => s.coarse)
  const hit = coarse ? 44 : 40 // alvos de toque ≥44px
  const [input, setInput] = useState('')
  const isC = mode === 'center', isF = mode === 'focus'
  const hide = isF || app
  const send = () => {
    const t = input.trim()
    if (!t) return
    setInput('')
    const s = useYui.getState()
    // "sim"/"mostra" com sugestão pendente abre direto (como no design)
    const n = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (s.pending && /^(sim|ok|pode|claro|bora|quero|mostra|me mostra|abre isso|ver)\b/.test(n) && n.split(' ').length <= 3) {
      s.pushHist('user', t)
      openPending()
      return
    }
    submitText(t)
  }
  void pending
  const micOn = listening || connecting
  const pickQuick = (text: string) => {
    setQuick(false)
    setInput(text)
    setTimeout(() => {
      const el = dockInput.yuiEl
      el?.focus()
      el?.setSelectionRange(text.length, text.length)
    }, 20)
  }
  return (
    <div
      style={{
        position: 'absolute', bottom: 'calc(22px + var(--sab) + var(--kb))', left: isC || narrow ? 'calc(16px + var(--sal))' : '24%', right: isC || narrow ? 'calc(16px + var(--sar))' : 28, display: 'flex', justifyContent: 'center', zIndex: 40,
        transition: 'opacity .3s, transform .5s var(--ease), left .55s var(--ease), right .55s var(--ease), visibility .3s', opacity: hide ? 0 : 1, pointerEvents: hide ? 'none' : 'auto',
        transform: app ? 'translateY(16px)' : 'none', visibility: app ? 'hidden' : 'visible',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 760, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 7px 7px 8px', background: 'rgba(16,20,42,.78)',
          border: `1px solid ${micOn ? 'rgba(103,216,242,.45)' : 'rgba(160,170,255,.14)'}`, borderRadius: 18, backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          boxShadow: '0 18px 50px rgba(0,0,0,.35)', transition: 'border-color .3s',
        }}
      >
        <span style={{ position: 'relative', flexShrink: 0 }}>
          <button
            title="Atalhos"
            aria-label="Atalhos de pedido"
            aria-haspopup="menu"
            aria-expanded={quick}
            className="hov-icon"
            onClick={() => setQuick(!quick)}
            style={{ width: hit, height: hit, borderRadius: 12, border: 'none', background: quick ? 'rgba(103,216,242,.12)' : 'transparent', color: quick ? C.cyan : C.t2, fontSize: 22, fontWeight: 300, cursor: 'pointer', transform: quick ? 'rotate(45deg)' : 'none', transition: 'transform .2s' }}
          >
            +
          </button>
          {quick && (
            <>
              <div aria-hidden onClick={() => setQuick(false)} style={{ position: 'fixed', inset: 0, zIndex: 0 }} />
              <div
                role="menu"
                aria-label="Atalhos de pedido"
                onKeyDown={(e) => e.key === 'Escape' && setQuick(false)}
                style={{ position: 'absolute', bottom: 'calc(100% + 12px)', left: -2, zIndex: 1, width: 'min(300px, calc(100vw - 32px))', padding: 6, borderRadius: 14, background: 'rgba(16,20,42,.97)', border: '1px solid rgba(160,170,255,.16)', boxShadow: '0 20px 50px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column' }}
              >
                {QUICK.map((q, i) => (
                  <button
                    key={q.label}
                    role="menuitem"
                    autoFocus={i === 0}
                    onClick={() => pickQuick(q.text)}
                    className="hov-item"
                    style={{ minHeight: 44, padding: '8px 12px', border: 'none', borderRadius: 10, background: 'transparent', color: C.text, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1 }}
                  >
                    <span style={{ fontSize: 14 }}>{q.label}</span>
                    <span style={{ fontSize: 12, color: C.t3 }}>{q.hint}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </span>
        <input
          ref={(el) => {
            dockInput.yuiEl = el
          }}
          aria-label="Mensagem para Yui"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
          }}
          placeholder={
            micOn
              ? connecting
                ? 'Conectando…'
                : muted
                  ? 'Segure espaço para falar · 3× espaço = contínuo'
                  : voiceMode === 'continuous'
                    ? 'Ouvindo (contínuo) · espaço para sair'
                    : 'Ouvindo…'
              : isC
                ? 'Pergunte ou segure espaço para falar…'
                : 'Continue conversando…'
          }
          style={{ flex: 1, minWidth: 0, height: hit, border: 'none', background: 'transparent', color: C.text, fontSize: 15, fontFamily: 'var(--sans)' }}
        />
        <button
          title={micOn ? 'Encerrar voz' : 'Falar'}
          aria-label={micOn ? 'Encerrar conversa por voz' : 'Falar com Yui'}
          aria-pressed={micOn}
          onClick={toggleLive}
          style={{
            width: hit, height: hit, flexShrink: 0, borderRadius: 12, border: `1px solid ${micOn ? 'rgba(103,216,242,.6)' : 'rgba(255,255,255,.08)'}`,
            background: micOn ? 'rgba(103,216,242,.15)' : 'transparent', color: micOn ? C.cyan : C.t2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
          </svg>
        </button>
        <button
          title="Enviar"
          aria-label="Enviar"
          onClick={send}
          style={{ width: hit, height: hit, flexShrink: 0, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#67d8f2,#a68cf7)', color: '#0a0c1d', fontSize: 17, fontWeight: 700, cursor: 'pointer' }}
        >
          ↑
        </button>
      </div>
    </div>
  )
}
