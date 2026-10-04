import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { C } from '../../../lib/colors'

// Terminal pequeno embutido nas Configurações (conectar Claude / GitHub sem sair da página).
// Usa a mesma sessão tmux "shell" do workspace que a página Terminal.

const THEME = {
  background: 'rgba(0,0,0,0)',
  foreground: '#d6d9e8',
  cursor: C.cyan,
  cursorAccent: '#06070d',
  selectionBackground: 'rgba(203,188,255,.28)',
  black: '#0a0c1d', red: '#f06272', green: '#4fe0b0', yellow: '#f5b54a', blue: '#67a8f2', magenta: '#a68cf7', cyan: '#67d8f2', white: '#d6d9e8',
  brightBlack: '#4c5270', brightRed: '#f6b3ba', brightGreen: '#8af0cc', brightYellow: '#f5c97a', brightBlue: '#9cc7f7', brightMagenta: '#cbbcff', brightCyan: '#a9e9f8', brightWhite: '#ffffff',
}

export function EmbeddedTerminal({ command, height = 300, onClose }: { command: string; height?: number; onClose?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'connecting' | 'open' | 'closed'>('connecting')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.25, cursorBlink: true, allowTransparency: true, scrollback: 3000, theme: THEME })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    fit.fit()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/api/terminal?${new URLSearchParams({ kind: 'shell', cols: String(term.cols), rows: String(term.rows) })}`)
    ws.onopen = () => {
      setState('open')
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      term.focus()
      // Ctrl+C limpa qualquer coisa pendente na linha antes de rodar o comando do botão.
      setTimeout(() => ws.readyState === WebSocket.OPEN && ws.send(`\x03${command}\r`), 700)
    }
    ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer))
    ws.onclose = () => setState('closed')
    const sub = term.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(d))
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      } catch {
        /* oculto */
      }
    })
    ro.observe(host)
    return () => {
      ro.disconnect()
      sub.dispose()
      ws.close()
      term.dispose()
    }
  }, [command])

  return (
    <div style={{ borderRadius: 14, background: 'rgba(0,0,0,.45)', border: '1px solid rgba(103,216,242,.22)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.06)', fontSize: 12, color: C.t2 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: state === 'open' ? C.ok : state === 'connecting' ? C.warn : C.crit }} />
        <span className="mono" style={{ color: '#a9e9f8' }}>$ {command}</span>
        <span style={{ flex: 1 }} />
        {onClose && (
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', color: C.t2, cursor: 'pointer', fontSize: 12 }}>
            Fechar
          </button>
        )}
      </div>
      <div className="yui-terminal" style={{ height, padding: '8px 10px' }}>
        <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  )
}
