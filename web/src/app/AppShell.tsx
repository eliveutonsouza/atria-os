import { Component, useEffect, useState, type ReactNode } from 'react'
import type { AppPage } from '@shared/protocol'
import { useYui } from '../store/yui'
import { PAGES } from './pages'
import { PageHeader } from './PageFrame'
import { MiniOrb } from './MiniOrb'
import { Sidebar, SIDEBAR_W } from './Sidebar'
import './nav'
import './app.css'

// Dashboard (modo app): entra com fade + slide enquanto o orb da Yui voa para o canto.

export const PAGE_TITLES: Record<AppPage, [string, string]> = {
  overview: ['Visão geral · ao vivo', 'Visão geral'],
  ops: ['Operações · metodologia de execução', 'Quem está fazendo o quê'],
  agents: ['Agentes', 'Sua equipe'],
  runs: ['Execuções', 'Histórico de execuções'],
  missions: ['Missões', 'Planos de execução'],
  workflows: ['Workflows', 'Rotinas de trabalho'],
  schedule: ['Agendamentos', 'Sua rotina automatizada'],
  projects: ['Projetos', 'Seus repositórios'],
  browser: ['Navegador · ao vivo', 'Navegador'],
  terminal: ['Terminal', 'Terminal'],
  claude: ['Claude Code', 'Central de comandos'],
  tools: ['Ferramentas', 'Conectores, MCP, skills e plugins'],
  inbox: ['Aprovações', 'O que precisa de você'],
  infra: ['Infra & logs', 'Minha VPS'],
  settings: ['Configurações', 'Configurações'],
}

// Cabeçalho padrão ao trocar de página; a página (ou a view reaproveitada) sobrescreve via useHeader.
let lastPage: AppPage | null = null
useYui.subscribe((s) => {
  if (s.shellMode !== 'app') {
    lastPage = null
    return
  }
  if (s.appPage === lastPage) return
  lastPage = s.appPage
  const [eyebrow, title] = PAGE_TITLES[s.appPage]
  s.setHeader({ eyebrow, title, actions: [] })
})

class PageBoundary extends Component<{ children: ReactNode; page: string }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(e: Error) {
    return { err: e.message }
  }
  componentDidUpdate(prev: { page: string }) {
    if (prev.page !== this.props.page && this.state.err) this.setState({ err: null })
  }
  render() {
    if (this.state.err) return <div style={{ padding: 40, color: '#c9cde0', fontSize: 14 }}>Essa página falhou ao abrir. Tente de novo ou peça para a Yui.</div>
    return this.props.children
  }
}

export function AppShell() {
  const app = useYui((s) => s.shellMode === 'app')
  const page = useYui((s) => s.appPage)
  const idKey = useYui((s) => s.appParams.id ?? '')
  const pinned = useYui((s) => s.sidebarPinned)
  const narrow = useYui((s) => s.narrow)
  // mantém montado durante a animação de saída e desmonta depois (páginas não rodam escondidas)
  const [mounted, setMounted] = useState(app)
  const [shown, setShown] = useState(app)
  useEffect(() => {
    if (app) {
      setMounted(true)
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(r)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), 480)
    return () => clearTimeout(t)
  }, [app])

  const Page = PAGES[page]
  const offset = app && pinned && !narrow ? SIDEBAR_W : 0
  return (
    <>
      <Sidebar />
      {mounted && (
        <div
          aria-hidden={!app}
          style={{
            position: 'absolute', inset: 0, zIndex: 15, left: offset, transition: 'left .42s cubic-bezier(.2,.9,.25,1.08), opacity .45s var(--ease), transform .45s var(--ease)',
            opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(24px)', pointerEvents: app ? 'auto' : 'none',
            background: 'radial-gradient(120% 90% at 60% 10%, rgba(15,21,51,.9) 0%, rgba(10,12,29,.93) 45%, rgba(6,7,13,.95) 100%)',
          }}
        >
          <main
            key={`${page}:${idKey}`}
            className="app-scroll app-main"
            style={{
              position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden',
              padding: narrow ? 'calc(14px + env(safe-area-inset-top)) 14px calc(96px + env(safe-area-inset-bottom))' : '22px 28px 100px',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}
          >
            <PageHeader />
            <PageBoundary page={`${page}:${idKey}`}>
              <Page />
            </PageBoundary>
          </main>
        </div>
      )}
      <MiniOrb />
    </>
  )
}
