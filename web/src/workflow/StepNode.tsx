import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { NotifyChannel, WorkflowNodeType } from '@shared/protocol'
import { C } from '../lib/colors'
import type { FlowNode, MissionFlowNode } from './graph'

// Nós do fluxograma no idioma visual do design: vidro, bordas 14–16px, brilho na cor do tipo.

export const TYPE_META: Record<WorkflowNodeType, { label: string; color: string; icon: string }> = {
  start: { label: 'Início', color: C.t2, icon: '▶' },
  task: { label: 'Tarefa', color: C.cyan, icon: '●' },
  decision: { label: 'Decisão', color: C.lav, icon: '◆' },
  approval: { label: 'Aprovação', color: C.warn, icon: '✋' },
  parallel: { label: 'Paralelo', color: C.violet, icon: '⫴' },
  input: { label: 'Pedir informação', color: '#7fb6ff', icon: '✎' },
  notify: { label: 'Avisar', color: C.ok, icon: '➤' },
  end: { label: 'Fim', color: C.ok, icon: '■' },
}

const STATUS_BADGE: Record<string, { t: string; c: string }> = {
  done: { t: '✓', c: C.ok },
  failed: { t: '!', c: C.crit },
  cancelled: { t: '×', c: C.t3 },
  skipped: { t: '–', c: C.t4 },
  running: { t: '●', c: C.cyan },
  waiting_approval: { t: '…', c: C.warn },
  waiting_input: { t: '◷', c: '#7fb6ff' },
}

export const CHANNEL_LABEL: Record<NotifyChannel, string> = { telegram: 'Telegram', email: 'E-mail', push: 'Push' }

const handle = { width: 9, height: 9, background: '#0f1229', border: '1px solid rgba(160,170,255,.45)' }

export function StepNode({ data, selected }: NodeProps<FlowNode>) {
  const { step, status, decision, agentName, active } = data
  const meta = TYPE_META[step.type]
  const badge = status ? STATUS_BADGE[status] : undefined
  const pulse = active || status === 'running' || status === 'waiting_approval' || status === 'waiting_input'
  const ring = selected ? `0 0 0 1.5px ${meta.color}, 0 0 22px ${meta.color}55` : pulse ? `0 0 18px ${meta.color}66` : '0 10px 30px rgba(0,0,0,.35)'
  const dim = status === 'skipped' || status === 'cancelled'

  if (step.type === 'decision') {
    return (
      <div className={pulse ? 'wf-pulse' : undefined} style={{ width: 190, height: 112, position: 'relative', opacity: dim ? 0.45 : 1 }}>
        <Handle type="target" position={Position.Top} style={{ ...handle, top: 2 }} />
        <svg width="190" height="112" viewBox="0 0 190 112" style={{ position: 'absolute', inset: 0, filter: selected || pulse ? `drop-shadow(0 0 10px ${meta.color}88)` : undefined }}>
          <polygon points="95,2 188,56 95,110 2,56" fill="rgba(26,24,58,.92)" stroke={meta.color} strokeOpacity={selected ? 1 : 0.55} strokeWidth={selected ? 1.6 : 1} />
        </svg>
        <div style={{ position: 'absolute', inset: '18px 34px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 2 }}>
          <span style={{ fontSize: 9, letterSpacing: '.18em', textTransform: 'uppercase', color: meta.color, fontWeight: 700 }}>
            {step.id} · {meta.label}
          </span>
          <span style={{ fontSize: 12, lineHeight: 1.25, color: C.text, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{step.title}</span>
          {decision && <span style={{ fontSize: 10, color: C.lav }}>→ {decision}</span>}
        </div>
        {badge && <Badge {...badge} />}
        <Handle type="source" position={Position.Bottom} style={{ ...handle, bottom: 2 }} />
      </div>
    )
  }

  return (
    <div
      className={pulse ? 'wf-pulse' : undefined}
      style={{
        width: step.type === 'end' || step.type === 'start' ? 150 : 210,
        padding: '11px 14px 12px',
        borderRadius: step.type === 'end' || step.type === 'start' ? 999 : 15,
        background: 'linear-gradient(180deg, rgba(24,28,58,.94), rgba(14,16,36,.94))',
        border: `1px solid ${selected ? meta.color : 'rgba(160,170,255,.16)'}`,
        boxShadow: ring,
        position: 'relative',
        opacity: dim ? 0.45 : 1,
        textAlign: step.type === 'end' || step.type === 'start' ? 'center' : 'left',
      }}
    >
      {step.type !== 'start' && <Handle type="target" position={Position.Top} style={handle} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: step.type === 'end' || step.type === 'start' ? 'center' : 'flex-start' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, boxShadow: `0 0 8px ${meta.color}` }} />
        <span style={{ fontSize: 9, letterSpacing: '.18em', textTransform: 'uppercase', color: meta.color, fontWeight: 700 }}>
          {step.id} · {meta.label}
        </span>
      </div>
      <div style={{ marginTop: 5, fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{step.title}</div>
      {step.type === 'task' && (
        <div style={{ marginTop: 5, fontSize: 11, color: agentName ? '#a9e9f8' : C.crit }}>{agentName ? `${agentName}` : 'sem agente'}</div>
      )}
      {step.type === 'input' && (
        <div style={{ marginTop: 5, fontSize: 11, color: status === 'waiting_input' ? meta.color : C.t3 }}>
          {status === 'waiting_input' ? 'esperando sua resposta' : `${step.fields?.length ?? 0} campo${step.fields?.length === 1 ? '' : 's'}${step.fields?.some((f) => f.kind === 'audio') ? ' · áudio transcrito' : ''}`}
        </div>
      )}
      {step.type === 'notify' && (step.notifyVia ?? []).length > 0 && (
        <div style={{ marginTop: 5, fontSize: 11, color: C.t3 }}>{(step.notifyVia ?? []).map((c) => CHANNEL_LABEL[c]).join(' + ')}</div>
      )}
      {step.type === 'task' && step.instruction && (
        <div style={{ marginTop: 4, fontSize: 11, color: C.t3, lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{step.instruction}</div>
      )}
      {badge && <Badge {...badge} />}
      {step.type !== 'end' && <Handle type="source" position={Position.Bottom} style={handle} />}
    </div>
  )
}

function Badge({ t, c }: { t: string; c: string }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute', top: -8, right: -8, width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: '#06070d', background: c, boxShadow: `0 0 10px ${c}`,
      }}
    >
      {t}
    </span>
  )
}

export const nodeTypes = { step: StepNode }

// Etapa de missão: cartão compacto ligado da esquerda para a direita (dependências).
export function MissionStepNode({ data, selected }: NodeProps<MissionFlowNode>) {
  const { mstep: s, n, depsLabel, locked } = data
  const color = s.risky ? C.warn : C.cyan
  const badge = s.status !== 'pending' ? STATUS_BADGE[s.status] : undefined
  const hHandle = { ...handle, width: 10, height: 10 }
  return (
    <div
      className={s.status === 'running' ? 'wf-pulse' : undefined}
      style={{
        width: 200, padding: '10px 12px', borderRadius: 12, background: '#121735', position: 'relative', boxSizing: 'border-box',
        border: `1px solid ${selected ? color : s.risky ? 'rgba(245,181,74,.5)' : 'rgba(103,216,242,.35)'}`,
        boxShadow: selected ? `0 0 0 3px ${s.risky ? 'rgba(245,181,74,.22)' : 'rgba(103,216,242,.22)'}` : '0 10px 30px rgba(0,0,0,.35)',
        opacity: locked && s.status !== 'running' ? 0.6 : 1,
      }}
    >
      <Handle type="target" position={Position.Left} style={hHandle} />
      <div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color, fontWeight: 700, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {n} · {s.agent || 'sem agente'}{s.risky ? ' · pede OK' : ''}
      </div>
      <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{s.title}</div>
      {depsLabel && <div style={{ fontSize: 11, color: '#9aa0bb', marginTop: 2 }}>{depsLabel}</div>}
      {badge && <Badge {...badge} />}
      <Handle type="source" position={Position.Right} style={hHandle} />
    </div>
  )
}

export const missionNodeTypes = { mission: MissionStepNode }
