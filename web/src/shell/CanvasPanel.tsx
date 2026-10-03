import type { CSSProperties } from 'react'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { AgentsView } from '../views/AgentsView'
import { ArtifactsView } from '../views/ArtifactsView'
import { BriefView } from '../views/BriefView'
import { DashboardView } from '../views/DashboardView'
import { InfraView } from '../views/InfraView'
import { LogsView } from '../views/LogsView'
import { ProjectView } from '../views/ProjectView'
import { ReportView } from '../views/ReportView'
import { RunsView } from '../views/RunsView'
import { WebsiteView } from '../views/WebsiteView'
import { TerminalView } from '../views/TerminalView'

function ViewBody() {
  const view = useYui((s) => s.view)
  switch (view) {
    case 'brief': return <BriefView />
    case 'dashboard': return <DashboardView />
    case 'agents': return <AgentsView />
    case 'runs': return <RunsView />
    case 'project': return <ProjectView />
    case 'logs': return <LogsView />
    case 'report': return <ReportView />
    case 'website': return <WebsiteView />
    case 'infra': return <InfraView />
    case 'artifact': return <ArtifactsView />
    case 'terminal': return <TerminalView />
    default: return null
  }
}

const btn: CSSProperties = { height: 34, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'transparent', color: C.t2, fontSize: 13, cursor: 'pointer' }

export function CanvasPanel() {
  const mode = useYui((s) => s.mode)
  const narrow = useYui((s) => s.narrow)
  const header = useYui((s) => s.header)
  const view = useYui((s) => s.view)
  const params = useYui((s) => s.viewParams)
  const nonce = useYui((s) => s.viewNonce)
  const isC = mode === 'center', isF = mode === 'focus'
  const key = `${view}:${params.project ?? ''}:${params.artifactId ?? ''}`
  return (
    <section
      aria-label={header.title || 'Canvas'}
      aria-hidden={isC}
      style={{
        position: 'absolute', top: isF ? 16 : 68, bottom: isF ? 16 : 104, left: isF ? 16 : narrow ? 12 : '24%', right: isF ? 16 : narrow ? 12 : 28,
        zIndex: 10, opacity: isC ? 0 : 1, transform: isC ? 'translateX(48px) scale(.98)' : 'none', pointerEvents: isC ? 'none' : 'auto',
        transition: 'all .55s cubic-bezier(.2,.8,.2,1)', background: 'linear-gradient(180deg, rgba(20,24,50,.62), rgba(12,14,32,.62))',
        border: '1px solid rgba(160,170,255,.11)', borderRadius: 20, backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.4)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '16px 20px 16px 24px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: C.cyan, fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.cyan, boxShadow: `0 0 10px ${C.cyan}` }} />
            {header.eyebrow}
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-.01em' }}>{header.title}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {header.actions.map((a) => (
            <button key={a.label} onClick={a.fn} className="hov-bg2" style={{ height: 34, padding: '0 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.03)', color: '#dfe3f3', fontSize: 13, cursor: 'pointer' }}>
              {a.label}
            </button>
          ))}
          <button onClick={() => useYui.getState().setFocus(!isF)} className="hov-txt" style={btn}>
            {isF ? 'Sair da tela cheia' : 'Tela cheia'}
          </button>
          <button onClick={() => useYui.getState().close()} title="Fechar (Esc)" className="hov-txt" style={{ ...btn, display: 'flex', alignItems: 'center', gap: 8 }}>
            Voltar <span className="mono" style={{ fontSize: 10, color: C.t3 }}>ESC</span>
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: 24, minWidth: 0 }}>
        {nonce > 0 && <ViewBody key={key} />}
      </div>
    </section>
  )
}
