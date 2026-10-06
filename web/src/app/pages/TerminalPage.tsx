import { useYui } from '../../store/yui'
import { TerminalView } from '../../views/TerminalView'

// Terminal em página cheia (Claude interativo + shell, sessões tmux persistentes).
// Mantém os viewParams vindos de quem abriu (kind/project/cmd), ex.: "Claude no projeto".
// No celular/tablet a altura segue a área visível (--vvh), então encolhe quando o teclado abre.
export function TerminalPage() {
  const device = useYui((s) => s.device)
  const kb = useYui((s) => s.keyboardOpen)
  // topo = padding do main + cabeçalho + gap; no celular sem teclado desconta a barra de abas
  const height =
    device === 'phone'
      ? kb
        ? 'calc(var(--vvh) - var(--sat) - 84px)'
        : 'calc(var(--vvh) - var(--sat) - 84px - var(--tabbar))'
      : device === 'tablet'
        ? 'calc(var(--vvh) - var(--sat) - 110px)'
        : 'calc(100dvh - 170px)'
  return (
    <div style={{ height, minHeight: device === 'desktop' ? 440 : device === 'tablet' ? 320 : 0, flexShrink: device === 'desktop' ? undefined : 0, display: 'flex', flexDirection: 'column' }}>
      <TerminalView />
    </div>
  )
}
