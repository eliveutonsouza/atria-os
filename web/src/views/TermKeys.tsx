import { Fragment, useCallback, useRef, useState, type CSSProperties } from 'react'
import { C } from '../lib/colors'

// Barra de teclas especiais para terminal no toque (Esc, Tab, Ctrl, setas, / e |).
// Ctrl trava: a próxima tecla (da barra ou do teclado do celular) vira Ctrl+tecla.

/** Ctrl+tecla → caractere de controle (Ctrl+C = \x03). Sem mapeamento, devolve como veio. */
export function ctrlOf(d: string): string {
  if (d.length !== 1) return d
  if (d === '?') return '\x7f'
  const c = d.toUpperCase().charCodeAt(0)
  return c >= 64 && c <= 95 ? String.fromCharCode(c & 31) : d
}

/** Estado do Ctrl travado; `apply` é estável e pode ser usado dentro do onData do xterm. */
export function useCtrlLatch() {
  const [on, setOn] = useState(false)
  const ref = useRef(false)
  const set = useCallback((v: boolean) => {
    ref.current = v
    setOn(v)
  }, [])
  const apply = useCallback(
    (d: string) => {
      if (!ref.current) return d
      set(false)
      return ctrlOf(d)
    },
    [set],
  )
  return { on, set, apply }
}

const ARROWS = [
  { k: 'A', label: '↑', aria: 'Seta para cima' },
  { k: 'B', label: '↓', aria: 'Seta para baixo' },
  { k: 'D', label: '←', aria: 'Seta para esquerda' },
  { k: 'C', label: '→', aria: 'Seta para direita' },
] as const

const key: CSSProperties = {
  minWidth: 44, height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)',
  color: 'var(--text-btn)', fontSize: 14, flexShrink: 0, fontFamily: 'var(--mono)', cursor: 'pointer', touchAction: 'manipulation',
}

export function TermKeys({ send, ctrl, appCursor }: { send: (d: string) => void; ctrl: ReturnType<typeof useCtrlLatch>; appCursor?: () => boolean }) {
  const press = (d: string, ctrlSeq?: string) => {
    if (ctrl.on) {
      ctrl.set(false)
      send(ctrlSeq ?? ctrlOf(d))
    } else send(d)
  }
  const arrow = (k: string) => press(appCursor?.() ? `\x1bO${k}` : `\x1b[${k}`, `\x1b[1;5${k}`)
  // pointerdown sem foco: o teclado do celular continua aberto e o xterm segue focado
  const btn = (label: string, fn: () => void, aria?: string, extra?: CSSProperties, pressed?: boolean) => (
    <button
      type="button"
      aria-label={aria}
      aria-pressed={pressed}
      onPointerDown={(e) => e.preventDefault()}
      onClick={fn}
      style={{ ...key, ...extra }}
    >
      {label}
    </button>
  )
  return (
    <div className="h-scroll" role="toolbar" aria-label="Teclas especiais" style={{ gap: 6, padding: '2px 0' }}>
      {btn('Esc', () => press('\x1b'))}
      {btn('Tab', () => press('\t'))}
      {btn('Ctrl', () => ctrl.set(!ctrl.on), 'Ctrl (trava para a próxima tecla)', ctrl.on ? { background: 'rgba(103,216,242,.18)', borderColor: 'rgba(103,216,242,.45)', color: 'var(--cyan-soft)' } : { color: C.t2 }, ctrl.on)}
      {ARROWS.map((a) => (
        <Fragment key={a.k}>{btn(a.label, () => arrow(a.k), a.aria)}</Fragment>
      ))}
      {btn('/', () => press('/'))}
      {btn('|', () => press('|'))}
    </div>
  )
}
