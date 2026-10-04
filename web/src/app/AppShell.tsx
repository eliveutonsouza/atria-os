import { useYui } from '../store/yui'
import { PAGES } from './pages'

// Stub — Frente 1 implementa sidebar, transição e cabeçalho de página.
export function AppShell() {
  const shellMode = useYui((s) => s.shellMode)
  const page = useYui((s) => s.appPage)
  if (shellMode !== 'app') return null
  const Page = PAGES[page]
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 15, padding: 24, overflow: 'auto' }}>
      <Page />
    </div>
  )
}
