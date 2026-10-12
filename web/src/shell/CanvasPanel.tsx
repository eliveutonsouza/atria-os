import { useState, type CSSProperties } from 'react'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { pickPrimary } from '../app/PageFrame'
import { ActionSheet, type SheetAction } from '../views/Sheet'
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
import { MissionView } from '../views/MissionView'
import { CustomView } from '../views/CustomView'
import { ToolsView } from '../views/ToolsView'
import { AgentDetailView } from '../views/AgentDetailView'
import { WorkflowView } from '../views/WorkflowView'
import { WorkflowsView } from '../views/WorkflowsView'
import { RoutinesView } from '../views/RoutinesView'
import { ClaudeGuideView } from '../views/ClaudeGuideView'

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
    case 'mission': return <MissionView />
    case 'custom': return <CustomView />
    case 'tools': return <ToolsView />
    case 'agent': return <AgentDetailView />
    case 'workflow': return <WorkflowView />
    case 'workflows': return <WorkflowsView />
    case 'routines': return <RoutinesView />
    case 'claude': return <ClaudeGuideView />
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
  const key = `${view}:${params.project ?? ''}:${params.artifactId ?? ''}:${params.missionId ?? ''}:${params.customId ?? ''}:${params.agentId ?? ''}:${params.workflowId ?? ''}`
  return (
    <section
      aria-label={header.title || 'Canvas'}
      aria-hidden={isC}
      style={{
        position: 'absolute', top: `calc(${isF ? 16 : 68}px + env(safe-area-inset-top))`, bottom: `calc(${isF ? 16 : 104}px + var(--sab) + var(--kb))`, left: isF ? 'calc(16px + var(--sal))' : narrow ? 'calc(8px + var(--sal))' : '24%', right: isF ? 'calc(16px + var(--sar))' : narrow ? 'calc(8px + var(--sar))' : 28,
        zIndex: 10, opacity: isC ? 0 : 1, transform: isC ? (narrow ? 'scale(.98)' : 'translateX(48px) scale(.98)') : 'none', pointerEvents: isC ? 'none' : 'auto', visibility: isC ? 'hidden' : 'visible',
        transition: 'all .55s cubic-bezier(.2,.8,.2,1)', background: 'linear-gradient(180deg, rgba(20,24,50,.62), rgba(12,14,32,.62))',
        border: '1px solid rgba(160,170,255,.11)', borderRadius: 20, backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.4)',
      }}
    >
      {narrow ? (
        <PhoneCanvasHeader isF={isF} />
      ) : (
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
            <button key={a.label} onClick={a.fn} disabled={a.disabled} className={`app-btn${a.primary ? ' primary' : a.danger ? ' danger' : ''}`}>
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
      )}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', padding: narrow ? 14 : 24, minWidth: 0 }}>
        {nonce > 0 && <ViewBody key={key} />}
      </div>
    </section>
  )
}

// Celular: ‹ (fecha), título numa linha, ação principal e ⋯ com o resto (prancha Phone-Acoes).
function PhoneCanvasHeader({ isF }: { isF: boolean }) {
  const header = useYui((s) => s.header)
  const [menu, setMenu] = useState(false)
  const primary = pickPrimary(header.actions)
  const rest: SheetAction[] = [
    ...header.actions.filter((a) => a !== primary).map((a) => ({ label: a.label, fn: a.fn, danger: a.danger, disabled: a.disabled })),
    { label: isF ? 'Sair da tela cheia' : 'Tela cheia', fn: () => useYui.getState().setFocus(!isF) },
  ]
  const ib = { width: 44, height: 44, flexShrink: 0, borderRadius: 12, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.04)', color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' } as const
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 10px 10px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
      <button aria-label="Voltar" onClick={() => useYui.getState().close()} style={ib}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', color: C.cyan, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{header.eyebrow}</div>
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{header.title}</h1>
      </div>
      {primary && (
        <button onClick={primary.fn} disabled={primary.disabled} className="app-btn primary" style={{ height: 44, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }}>
          {primary.label}
        </button>
      )}
      <button aria-label="Mais ações" onClick={() => setMenu(true)} style={ib}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg>
      </button>
      {menu && <ActionSheet title={header.title} actions={rest} onClose={() => setMenu(false)} />}
    </div>
  )
}
