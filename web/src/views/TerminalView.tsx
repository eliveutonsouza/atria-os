import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api/client'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { TermKeys, useCtrlLatch } from './TermKeys'
import { useHeader } from './ui'
import { confirmAction, toastErr } from '../lib/feedback'

// Terminal no container: aba Claude (Claude Code interativo no projeto) e aba Shell (bash).
// Sessões ficam em tmux no servidor — fechar a view só desanexa.

type Kind = 'claude' | 'shell'

const THEME = {
  background: 'rgba(0,0,0,0)',
  foreground: '#d6d9e8',
  cursor: C.cyan,
  cursorAccent: '#06070d',
  selectionBackground: 'rgba(203,188,255,.28)',
  black: '#0a0c1d', red: '#f06272', green: '#4fe0b0', yellow: '#f5b54a', blue: '#67a8f2', magenta: '#a68cf7', cyan: '#67d8f2', white: '#d6d9e8',
  brightBlack: '#4c5270', brightRed: '#f6b3ba', brightGreen: '#8af0cc', brightYellow: '#f5c97a', brightBlue: '#9cc7f7', brightMagenta: '#cbbcff', brightCyan: '#a9e9f8', brightWhite: '#ffffff',
}

const sessionName = (kind: Kind, slug: string | null) => `atria-${kind}-${slug ?? 'workspace'}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)

export function TerminalView() {
  const paramKind = useYui((s) => s.viewParams.kind)
  const paramCmd = useYui((s) => s.viewParams.cmd)
  const sentCmd = useRef<string | null>(null) // comando pré-digitado já enviado (não repete ao reconectar)
  const slug = useYui((s) => s.viewParams.project ?? s.activeProject)
  const [kind, setKind] = useState<Kind>(paramKind ?? 'claude')
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting')
  const [gen, setGen] = useState(0) // força reconexão
  const hostRef = useRef<HTMLDivElement>(null)
  const phone = useYui((s) => s.device === 'phone')
  const coarse = useYui((s) => s.coarse)
  const ctrl = useCtrlLatch()
  const applyCtrl = ctrl.apply
  // teclas da barra de toque vão pelo mesmo caminho do input do xterm
  const sendRef = useRef<(d: string) => void>(() => {})
  const appCursorRef = useRef<() => boolean>(() => false)

  useHeader(
    kind === 'claude' ? 'Terminal · Claude Code' : 'Terminal · Shell',
    slug ?? 'workspace',
    [
      { label: 'Reconectar', fn: () => setGen((g) => g + 1) },
      {
        label: 'Nova sessão',
        fn: async () => {
          const ok = await confirmAction({ title: 'Começar uma sessão nova?', text: 'A sessão atual é encerrada no servidor: o que estiver rodando nela para e o histórico da tela some.', confirmLabel: 'Encerrar e começar nova', danger: true })
          if (!ok) return
          try {
            await api.del(`/api/terminal/sessions/${sessionName(kind, slug)}`)
          } catch (e) {
            toastErr(e, 'Não consegui encerrar a sessão atual')
          }
          setGen((g) => g + 1)
        },
      },
    ],
    [kind, slug],
  )

  useEffect(() => {
    if (paramKind) setKind(paramKind)
  }, [paramKind])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      // xterm desenha em canvas: precisa do valor da fonte, não do var()
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'ui-monospace, monospace',
      fontSize: useYui.getState().device === 'phone' ? 12 : 13,
      lineHeight: 1.25,
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 5000,
      theme: THEME,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    fit.fit()
    setStatus('connecting')

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const qs = new URLSearchParams({ kind, cols: String(term.cols), rows: String(term.rows), ...(slug ? { project: slug } : {}) })
    const ws = new WebSocket(`${proto}://${location.host}/api/terminal?${qs}`)
    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }
    ws.onopen = () => {
      setStatus('open')
      sendResize()
      term.focus()
      // Comando vindo do mapa do Claude/Ferramentas: digitado sem Enter, para você revisar.
      if (paramCmd && sentCmd.current !== paramCmd) {
        sentCmd.current = paramCmd
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(paramCmd)
        }, 900)
      }
    }
    ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer))
    ws.onclose = (e) => {
      setStatus('closed')
      term.write(`\r\n\x1b[90m— desconectado${e.reason ? ` (${e.reason})` : ''}. Use Reconectar; a sessão continua no servidor. —\x1b[0m\r\n`)
    }
    sendRef.current = (d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(d)
    }
    appCursorRef.current = () => term.modes.applicationCursorKeysMode
    const data = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(applyCtrl(d))
    })
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        sendResize()
      } catch {
        /* host oculto durante transição */
      }
    })
    ro.observe(host)
    return () => {
      ro.disconnect()
      data.dispose()
      ws.close()
      term.dispose()
    }
  }, [kind, slug, gen, paramCmd, applyCtrl])

  const tab = (k: Kind, label: string) => (
    <button
      onClick={() => setKind(k)}
      aria-pressed={kind === k}
      style={{
        height: coarse ? 44 : 30, padding: '0 14px', borderRadius: 9, cursor: 'pointer', fontSize: phone ? 12 : 13, flexShrink: 0, whiteSpace: 'nowrap',
        border: `1px solid ${kind === k ? 'rgba(103,216,242,.35)' : 'rgba(255,255,255,.08)'}`,
        background: kind === k ? 'rgba(103,216,242,.1)' : 'transparent', color: kind === k ? C.cyanSoft : C.t2,
      }}
    >
      {label}
    </button>
  )

  return (
    <div style={{ height: '100%', minHeight: phone ? 0 : 420, display: 'flex', flexDirection: 'column', gap: phone ? 8 : 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="h-scroll" style={{ minWidth: 0, flex: '0 1 auto' }}>
          {tab('claude', `Claude · ${slug ?? 'workspace'}`)}
          {tab('shell', 'Shell')}
        </div>
        <span role="status" aria-live="polite" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.t3, flexShrink: 0, whiteSpace: 'nowrap' }}>
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: status === 'open' ? C.ok : status === 'connecting' ? C.warn : C.crit }} />
          {status === 'open' ? 'conectado' : status === 'connecting' ? 'conectando…' : 'desconectado'}
        </span>
        {status === 'closed' && (
          <button className="app-btn small" style={{ flexShrink: 0 }} onClick={() => setGen((g) => g + 1)}>
            Reconectar
          </button>
        )}
      </div>
      <div
        className="atria-terminal"
        style={{ flex: 1, minHeight: 0, padding: phone ? '8px 8px' : '12px 14px', borderRadius: 14, background: 'rgba(0,0,0,.45)', border: '1px solid rgba(255,255,255,.06)', overflow: 'hidden' }}
      >
        <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
      </div>
      {coarse && <TermKeys send={(d) => sendRef.current(d)} ctrl={ctrl} appCursor={() => appCursorRef.current()} />}
    </div>
  )
}
