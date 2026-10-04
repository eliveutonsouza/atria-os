import { TerminalView } from '../../views/TerminalView'

// Terminal em página cheia (Claude interativo + shell, sessões tmux persistentes).
// Mantém os viewParams vindos de quem abriu (kind/project/cmd), ex.: "Claude no projeto".
export function TerminalPage() {
  return (
    <div style={{ height: 'calc(100dvh - 170px)', minHeight: 440, display: 'flex', flexDirection: 'column' }}>
      <TerminalView />
    </div>
  )
}
