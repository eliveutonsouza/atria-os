import type { ReactNode } from 'react'
import type { AgentInfo, MissionStep } from '@shared/protocol'
import { C } from '../lib/colors'
import { missionConnect, missionNumbers } from '../workflow/graph'

// Painel da etapa selecionada no editor de missão: título, agente, instrução, dependências e "pedir meu OK".

const lbl = { fontSize: 12, color: '#9aa0bb', display: 'flex', flexDirection: 'column', gap: 6 } as const

export function StepPanel({ step, steps, agents, locked, touch, onChange, onDelete }: {
  step: MissionStep
  steps: MissionStep[]
  agents: AgentInfo[]
  locked?: boolean
  touch?: boolean
  onChange: (p: Partial<MissionStep>) => void
  onDelete: () => void
}) {
  const nums = missionNumbers(steps)
  const deps = steps.filter((s) => step.dependsOn.includes(s.id))
  // candidatas a dependência: as que não criariam ciclo
  const options = steps.filter((s) => s.id !== step.id && !step.dependsOn.includes(s.id) && missionConnect(steps, s.id, step.id))
  const h = touch ? 44 : 38
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 11, letterSpacing: '.14em', color: step.risky ? C.warn : C.cyan, fontWeight: 700, textTransform: 'uppercase' }}>
        Etapa {nums.get(step.id)}{locked ? ' · já saiu da fila' : ''}
      </span>
      <Field label="Título">
        <input className="wf-input" disabled={locked} value={step.title} onChange={(e) => onChange({ title: e.target.value })} style={{ height: h }} />
      </Field>
      <Field label="Agente">
        <select
          className="wf-input"
          disabled={locked}
          value={step.agentId}
          onChange={(e) => onChange({ agentId: e.target.value, agent: agents.find((a) => a.id === e.target.value)?.name ?? e.target.value })}
          style={{ height: h }}
        >
          {!step.agentId && <option value="">— escolha —</option>}
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name} · {a.group}</option>
          ))}
          {step.agentId && !agents.some((a) => a.id === step.agentId) && <option value={step.agentId}>{step.agent || step.agentId} (não encontrado)</option>}
        </select>
      </Field>
      <Field label="Instrução">
        <textarea className="wf-input" disabled={locked} rows={6} value={step.instruction} onChange={(e) => onChange({ instruction: e.target.value })} placeholder="O que o agente deve fazer nesta etapa, em detalhe (ele não vê esta conversa)." />
      </Field>
      <div style={lbl}>
        Depende de
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {deps.length === 0 && <span style={{ fontSize: 12.5, color: C.t3 }}>nenhuma — começa logo</span>}
          {deps.map((d) => (
            <span key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '0 4px 0 10px', minHeight: touch ? 36 : 28, borderRadius: 8, background: 'rgba(103,216,242,.08)', border: '1px solid rgba(103,216,242,.18)', color: 'var(--cyan-soft)', maxWidth: '100%' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nums.get(d.id)} · {d.title}</span>
              {!locked && (
                <button
                  aria-label={`Remover dependência de ${d.title}`}
                  onClick={() => onChange({ dependsOn: step.dependsOn.filter((x) => x !== d.id) })}
                  style={{ width: touch ? 32 : 22, height: touch ? 32 : 22, border: 'none', background: 'transparent', color: 'var(--cyan-soft)', cursor: 'pointer', fontSize: 12, padding: 0 }}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
        {!locked && options.length > 0 && (
          <select
            className="wf-input"
            aria-label="Adicionar dependência"
            value=""
            onChange={(e) => e.target.value && onChange({ dependsOn: [...step.dependsOn, e.target.value] })}
            style={{ height: h }}
          >
            <option value="">+ depender de outra etapa…</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>{nums.get(s.id)} · {s.title}</option>
            ))}
          </select>
        )}
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.text, minHeight: touch ? 44 : undefined }}>
        <input type="checkbox" disabled={locked} checked={step.risky} onChange={(e) => onChange({ risky: e.target.checked })} />
        Pedir meu OK antes desta etapa
      </label>
      {!locked && (
        <button className="wf-btn" onClick={onDelete} style={{ height: h, color: 'var(--crit-soft)', borderColor: 'rgba(240,98,114,.3)' }}>
          Excluir etapa
        </button>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={lbl}>
      {label}
      {children}
    </label>
  )
}
