import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { AgentInfo, MissionInfo, MissionStep } from '@shared/protocol'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { openApp } from '../app/pages/common'
import { C } from '../lib/colors'
import { dropMission } from '../lib/actions'
import { MissionCanvas } from '../mission/MissionCanvas'
import { StepPanel } from '../mission/StepPanel'
import { blankStep, say } from '../mission/steps'
import { useYui } from '../store/yui'
import { depsText, missionNextId, missionNumbers, missionRemove } from '../workflow/graph'
import { BottomSheet } from './Sheet'
import { ConfirmDeleteModal, useHeader } from './ui'

// Nova missão / rascunho: pedido à esquerda (objetivo, projeto, detalhes, "pedir meu OK"), plano à direita
// (quadro de etapas + painel da etapa). Planeja com a Yui ou monta à mão; só executa ao "Iniciar missão".
// restricted: missão pausada/bloqueada — só as etapas pendentes são editáveis.

const APPROVALS = [
  ['deploy', 'publicar / fazer deploy'],
  ['enviar', 'enviar mensagem ou e-mail'],
] as const

type Busy = '' | 'plan' | 'manual' | 'save' | 'start' | 'del'

export function MissionEditor(props: { mission: MissionInfo | null; restricted?: boolean; onClose?: () => void }) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  )
}

const stepInput = (s: MissionStep) => ({ id: s.id, title: s.title, agentId: s.agentId, instruction: s.instruction, dependsOn: s.dependsOn, risky: s.risky, display: s.display })

function remember(m: MissionInfo) {
  const s = useYui.getState()
  s.set({ missions: { ...s.missions, [m.id]: m } })
}

function Editor({ mission, restricted = false, onClose }: { mission: MissionInfo | null; restricted?: boolean; onClose?: () => void }) {
  const device = useYui((s) => s.device)
  const coarse = useYui((s) => s.coarse)
  const projects = useYui((s) => s.projects)
  const phone = device === 'phone'
  const tablet = device === 'tablet'
  const agents = useApi<AgentInfo[]>('/api/agents').data ?? []

  const [mid, setMid] = useState<string | null>(mission?.id ?? null)
  const [title, setTitle] = useState(mission?.title ?? '')
  const [goal, setGoal] = useState(mission?.goal ?? '')
  const [project, setProject] = useState<string | null>(mission ? mission.project : (useYui.getState().activeProject ?? null))
  const [details, setDetails] = useState(mission?.details ?? '')
  const [approval, setApproval] = useState<string[]>(mission?.approvalBefore ?? [])
  const [steps, setStepsState] = useState<MissionStep[]>(mission?.steps ?? [])
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>('')
  const [ptab, setPtab] = useState<'pedido' | 'etapas' | 'fluxo'>(restricted || mission?.steps.length ? 'etapas' : 'pedido')
  const [sheet, setSheet] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [delStep, setDelStep] = useState<MissionStep | null>(null)

  const isLocked = useCallback((s: MissionStep) => restricted && s.status !== 'pending', [restricted])
  const setSteps = useCallback((fn: (s: MissionStep[]) => MissionStep[]) => setStepsState(fn), [])

  const payload = () =>
    restricted
      ? { steps: steps.map(stepInput) }
      : { title: title.trim() || undefined, goal: goal.trim(), project, details: details.trim() || null, approvalBefore: approval, steps: steps.map(stepInput) }
  const key = JSON.stringify(payload())
  const [savedKey, setSavedKey] = useState(() => (mission ? key : ''))
  const dirty = !mid || key !== savedKey

  // adota a versão do servidor (depois de criar, salvar ou planejar)
  const adopt = (m: MissionInfo, resetLayout = false) => {
    remember(m)
    setMid(m.id)
    setTitle(m.title)
    setGoal(m.goal)
    setProject(m.project)
    setDetails(m.details ?? '')
    setApproval(m.approvalBefore ?? [])
    setStepsState(m.steps)
    if (resetLayout) setPositions({})
    setSavedKey(
      JSON.stringify(
        restricted
          ? { steps: m.steps.map(stepInput) }
          : { title: m.title || undefined, goal: m.goal, project: m.project, details: m.details || null, approvalBefore: m.approvalBefore ?? [], steps: m.steps.map(stepInput) },
      ),
    )
  }

  const request = { goal: goal.trim(), project, details: details.trim() || null, approvalBefore: approval }
  const needGoal = () => {
    if (goal.trim()) return false
    say('Descreva o objetivo da missão primeiro.')
    if (phone) setPtab('pedido')
    return true
  }

  // cria o rascunho (sem planejador) se ainda não existe
  const ensureDraft = async (): Promise<string | null> => {
    if (mid) return mid
    if (needGoal()) return null
    const m = await api.post<MissionInfo>('/api/missions', { ...request, mode: 'manual' })
    adopt(m)
    return m.id
  }

  const save = async (): Promise<string | null> => {
    if (!restricted && needGoal()) return null
    const bad = steps.find((s) => !s.title.trim() || !s.agentId)
    if (bad) {
      setSelected(bad.id)
      say(`A etapa ${missionNumbers(steps).get(bad.id)} precisa de título e agente.`)
      return null
    }
    setBusy('save')
    try {
      const id = await ensureDraft()
      if (!id) return null
      adopt(await api.put<MissionInfo>(`/api/missions/${encodeURIComponent(id)}`, payload()))
      return id
    } catch (e) {
      say(`Não consegui salvar: ${(e as Error).message}.`)
      return null
    } finally {
      setBusy('')
    }
  }

  const plan = async () => {
    if (needGoal()) return
    setBusy('plan')
    try {
      let m: MissionInfo
      if (!mid) m = await api.post<MissionInfo>('/api/missions', { ...request, mode: 'ai' })
      else {
        // o pedido atual vale para o replanejamento; as etapas são substituídas
        await api.put(`/api/missions/${encodeURIComponent(mid)}`, { title: title.trim() || undefined, ...request })
        m = await api.post<MissionInfo>(`/api/missions/${encodeURIComponent(mid)}/replan`)
      }
      adopt(m, true)
      setSelected(null)
      if (phone) setPtab('etapas')
      say(`Plano pronto: ${m.steps.length} etapas. Revise e ajuste antes de iniciar.`)
    } catch (e) {
      say(`Não consegui planejar: ${(e as Error).message}.`)
    } finally {
      setBusy('')
    }
  }

  const addStep = () => {
    if (!agents.length) return say('Nenhum agente disponível para a etapa.')
    const id = missionNextId(steps)
    const sel = steps.find((s) => s.id === selected)
    setStepsState((ss) => [...ss, blankStep(id, agents, sel ? [sel.id] : [])])
    if (sel) setPositions((p) => ({ ...p, [id]: { x: (p[sel.id]?.x ?? 0) + 260, y: p[sel.id]?.y ?? 0 } }))
    setSelected(id)
    if (phone) setSheet(true)
  }

  const manual = async () => {
    if (!mid) {
      setBusy('manual')
      try {
        if (!(await ensureDraft())) return
      } catch (e) {
        return say(`Não consegui criar o rascunho: ${(e as Error).message}.`)
      } finally {
        setBusy('')
      }
    }
    if (phone) setPtab('etapas')
    addStep()
  }

  const start = async () => {
    if (!steps.length) return say('Adicione pelo menos uma etapa (ou planeje com a Yui) antes de iniciar.')
    const id = dirty ? await save() : mid
    if (!id) return
    setBusy('start')
    try {
      const m = await api.post<MissionInfo>(`/api/missions/${encodeURIComponent(id)}/start`)
      remember(m)
      say(`Missão "${m.title}" iniciada: ${m.steps.length} etapas.`)
      if (useYui.getState().appParams.id === 'new') openApp('missions', m.id)
    } catch (e) {
      say(`Não consegui iniciar: ${(e as Error).message}.`)
    } finally {
      setBusy('')
    }
  }

  const saveSteps = async () => {
    if (await save()) {
      say('Etapas atualizadas.')
      onClose?.()
    }
  }

  const discard = async () => {
    if (!mid) return
    setBusy('del')
    try {
      await api.del(`/api/missions/${encodeURIComponent(mid)}`)
      dropMission(mid)
      say('Rascunho descartado.')
      setDiscardOpen(false)
      if (useYui.getState().appParams.id === 'new') openApp('missions')
    } catch (e) {
      say(`Não consegui descartar: ${(e as Error).message}.`)
    } finally {
      setBusy('')
    }
  }

  // ações do cabeçalho chamam sempre a versão atual (o useHeader guarda as funções)
  const act = useRef({ save, start, saveSteps })
  useLayoutEffect(() => {
    act.current = { save, start, saveSteps }
  })
  useHeader(
    restricted ? 'Missão · editar etapas' : 'Missão · rascunho',
    title.trim() || 'Nova missão',
    restricted
      ? [
          { label: busy === 'save' ? 'Salvando…' : 'Salvar etapas', fn: () => void act.current.saveSteps(), primary: true },
          { label: 'Fechar sem salvar', fn: () => onClose?.() },
        ]
      : [
          { label: 'Descartar', fn: () => (mid ? setDiscardOpen(true) : openApp('missions')), danger: true },
          { label: busy === 'save' ? 'Salvando…' : dirty ? 'Salvar rascunho' : 'Rascunho salvo', fn: () => void act.current.save() },
          { label: busy === 'start' ? 'Iniciando…' : phone ? 'Iniciar' : 'Iniciar missão', fn: () => void act.current.start(), primary: true },
        ],
    [restricted, busy, dirty, mid, phone],
  )

  const sel = steps.find((s) => s.id === selected) ?? null
  const patchStep = (id: string, p: Partial<MissionStep>) => setStepsState((ss) => ss.map((s) => (s.id === id ? { ...s, ...p } : s)))
  const removeStep = (s: MissionStep) => {
    setStepsState((ss) => missionRemove(ss, s.id))
    setSelected(null)
    setSheet(false)
    setDelStep(null)
  }
  const nums = useMemo(() => missionNumbers(steps), [steps])
  const agentCount = new Set(steps.map((s) => s.agentId)).size
  const openStep = (id: string) => {
    setSelected(id)
    setSheet(true)
  }

  const h = coarse ? 48 : 44
  const pedido = (
    <>
      {mid && !phone && (
        <label style={lbl}>
          Título
          <input className="wf-input" value={title} onChange={(e) => setTitle(e.target.value)} style={inp(coarse)} />
        </label>
      )}
      <label style={lbl}>
        Objetivo
        <textarea className="wf-input" rows={5} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Ex.: landing page para a clínica Fisioforma com serviços, depoimentos e agendamento pelo WhatsApp. Publicar na Vercel." style={ta} />
      </label>
      <label style={lbl}>
        Projeto
        <select className="wf-input" value={project ?? ''} onChange={(e) => setProject(e.target.value || null)} style={inp(coarse)}>
          <option value="">Sem projeto (pasta temporária)</option>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
          {project && !projects.some((p) => p.slug === project) && <option value={project}>{project}</option>}
        </select>
      </label>
      <label style={lbl}>
        <span>
          Detalhes e referências <span style={{ color: C.t3 }}>(público, tom, cores, links, o que evitar)</span>
        </span>
        <textarea className="wf-input" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} style={ta} />
      </label>
      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: coarse ? 0 : 8 }}>
        <legend style={{ ...lbl, marginBottom: 6 }}>Pedir meu OK antes de</legend>
        {APPROVALS.map(([k, label]) => (
          <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.text, minHeight: coarse ? 44 : undefined }}>
            <input type="checkbox" checked={approval.includes(k)} onChange={(e) => setApproval((a) => (e.target.checked ? [...a, k] : a.filter((x) => x !== k)))} />
            {label}
          </label>
        ))}
      </fieldset>
      {!phone && <span style={{ flex: 1 }} />}
      <button className="wf-btn primary" disabled={!!busy} onClick={() => void plan()} style={{ height: h }}>
        {busy === 'plan' ? 'Planejando…' : mid && steps.length ? 'Replanejar com a Yui' : 'Planejar com a Yui'}
      </button>
      {phone ? (
        <button className="wf-btn" disabled={!!busy} onClick={() => void manual()} style={{ height: h }}>
          {busy === 'manual' ? 'Criando…' : 'Montar etapas à mão'}
        </button>
      ) : (
        <span style={{ fontSize: 12, color: C.t3, textAlign: 'center' }}>
          Ou{' '}
          <button onClick={() => void manual()} disabled={!!busy} style={{ border: 'none', background: 'none', padding: 0, color: '#7fdcf5', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>
            monte as etapas à mão
          </button>{' '}
          {tablet ? 'no quadro abaixo.' : 'no quadro ao lado.'}
        </span>
      )}
    </>
  )

  const canvas = (
    <MissionCanvas
      steps={steps}
      setSteps={setSteps}
      selected={selected}
      onSelect={setSelected}
      onOpen={phone ? openStep : undefined}
      positions={positions}
      setPositions={setPositions}
      isLocked={isLocked}
    />
  )
  const emptyHint = steps.length === 0 && (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', fontSize: 13, color: C.t3, pointerEvents: 'none' }}>
      {busy === 'plan' ? 'A Yui está montando o plano…' : 'Ainda sem etapas. Planeje com a Yui ou use “+ Etapa”.'}
    </div>
  )
  const panel = (s: MissionStep) => (
    <StepPanel step={s} steps={steps} agents={agents} locked={isLocked(s)} touch={coarse} onChange={(p) => patchStep(s.id, p)} onDelete={() => setDelStep(s)} />
  )
  const modals = (
    <>
      {discardOpen && (
        <ConfirmDeleteModal
          title={`Descartar o rascunho "${title || 'Nova missão'}"?`}
          text="O pedido e as etapas montadas somem. Nada foi executado ainda."
          rows={[{ label: 'Etapas', value: String(steps.length) }]}
          busy={busy === 'del'}
          onCancel={() => setDiscardOpen(false)}
          onConfirm={() => void discard()}
        />
      )}
      {delStep && (
        <ConfirmDeleteModal
          title={`Excluir a etapa "${delStep.title}"?`}
          text="As etapas que dependiam dela perdem essa dependência. Só vale depois de salvar."
          rows={[{ label: 'Agente', value: delStep.agent || '—' }]}
          onCancel={() => setDelStep(null)}
          onConfirm={() => removeStep(delStep)}
        />
      )}
    </>
  )

  if (phone) {
    const TABS = (restricted ? [['etapas', 'Etapas'], ['fluxo', 'Fluxo']] : [['pedido', 'Pedido'], ['etapas', 'Etapas'], ['fluxo', 'Fluxo']]) as [typeof ptab, string][]
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div role="tablist" aria-label="Seções da missão" style={{ display: 'flex', padding: 4, borderRadius: 12, background: 'rgba(255,255,255,.04)' }}>
          {TABS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={ptab === id}
              onClick={() => setPtab(id)}
              style={{ flex: 1, minHeight: 40, borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, fontFamily: 'Manrope, sans-serif', background: ptab === id ? 'rgba(103,216,242,.14)' : 'transparent', color: ptab === id ? '#fff' : '#9aa0bb' }}
            >
              {label}{id === 'etapas' && steps.length ? ` · ${steps.length}` : ''}
            </button>
          ))}
        </div>
        {ptab === 'pedido' && <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{pedido}</div>}
        {ptab === 'etapas' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {steps.length === 0 && <div style={{ fontSize: 13, color: C.t3, padding: '8px 2px' }}>Ainda sem etapas. Planeje com a Yui na aba Pedido ou adicione à mão.</div>}
            {steps.map((s) => (
              <button
                key={s.id}
                onClick={() => openStep(s.id)}
                style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 62, padding: '10px 12px', borderRadius: 14, background: 'rgba(255,255,255,.035)', border: `1px solid ${selected === s.id ? 'rgba(103,216,242,.4)' : 'rgba(255,255,255,.07)'}`, color: C.text, textAlign: 'left', cursor: 'pointer', opacity: isLocked(s) ? 0.6 : 1 }}
              >
                <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(103,216,242,.12)', color: '#67d8f2', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{nums.get(s.id)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: s.risky ? C.warn : C.t2, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[s.agent || 'sem agente', depsText(s, nums), s.risky ? 'pede seu OK' : '', isLocked(s) ? 'já saiu da fila' : ''].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span aria-hidden style={{ color: C.t3, fontSize: 20 }}>›</span>
              </button>
            ))}
            <button className="wf-btn" onClick={() => void (mid ? addStep() : manual())} disabled={!!busy} style={{ height: 48, borderStyle: 'dashed' }}>+ Etapa</button>
          </div>
        )}
        {ptab === 'fluxo' && (
          <>
            <div className="wf-canvas" style={{ position: 'relative', height: 'calc(var(--vvh) - 280px)', minHeight: 320, borderRadius: 16, border: '1px solid rgba(255,255,255,.06)', background: 'rgba(6,7,13,.7)', overflow: 'hidden' }}>
              {canvas}
              {emptyHint}
            </div>
            <div style={{ fontSize: 12, color: C.t3 }}>Toque numa etapa para editar. Arraste do ponto da direita de uma etapa até outra para criar dependência.</div>
          </>
        )}
        {sheet && sel && (
          <BottomSheet label={`Etapa ${nums.get(sel.id)}: ${sel.title}`} onClose={() => setSheet(false)}>
            {panel(sel)}
            <button className="wf-btn primary" onClick={() => setSheet(false)} style={{ height: 48, flexShrink: 0 }}>Pronto</button>
          </BottomSheet>
        )}
        {modals}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: tablet ? 'column' : 'row', gap: 16, alignItems: 'stretch', minWidth: 0 }}>
      {!restricted && (
        <Card label="Pedido" style={{ width: tablet ? undefined : 380, flexShrink: 0 }}>
          <b style={{ fontSize: 14, fontWeight: 600 }}>1. O que você quer</b>
          {pedido}
        </Card>
      )}
      <Card label="Plano" style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14, fontWeight: 600 }}>
            {restricted ? 'Etapas' : '2. Revise o plano'}{' '}
            <span style={{ fontWeight: 400, color: '#9aa0bb' }}>· {steps.length} etapa{steps.length === 1 ? '' : 's'} · {agentCount} agente{agentCount === 1 ? '' : 's'}</span>
          </b>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="wf-btn" disabled={!!busy} onClick={() => void (mid ? addStep() : manual())} style={{ height: 38 }}>+ Etapa</button>
            {!restricted && mid && steps.length > 0 && (
              <button className="wf-btn" disabled={!!busy} onClick={() => void plan()} style={{ height: 38 }}>{busy === 'plan' ? 'Planejando…' : 'Replanejar'}</button>
            )}
          </div>
        </div>
        {restricted && <div style={{ fontSize: 12.5, color: C.t3 }}>Só as etapas que ainda estão na fila podem mudar; as que já rodaram aparecem apagadas.</div>}
        <div style={{ flex: 1, display: 'flex', gap: 14, minHeight: tablet ? 420 : 520 }}>
          <div className="wf-canvas" style={{ flex: 1, position: 'relative', minWidth: 0, borderRadius: 14, background: 'rgba(6,7,13,.7)', border: '1px solid rgba(255,255,255,.06)', overflow: 'hidden' }}>
            {canvas}
            {emptyHint}
            {steps.length > 1 && <span style={{ position: 'absolute', right: 14, bottom: 12, fontSize: 11.5, color: C.t3, pointerEvents: 'none' }}>Arraste de uma etapa para outra para criar dependência</span>}
          </div>
          <aside aria-label="Etapa selecionada" style={{ width: tablet ? 280 : 300, flexShrink: 0, overflowY: 'auto' }}>
            {sel ? panel(sel) : <div style={{ fontSize: 13, color: C.t3, lineHeight: 1.5 }}>Selecione uma etapa no quadro para editar título, agente, instrução e dependências.</div>}
          </aside>
        </div>
      </Card>
      {modals}
    </div>
  )
}

const lbl: CSSProperties = { fontSize: 12, color: '#9aa0bb', display: 'flex', flexDirection: 'column', gap: 6 }
const ta: CSSProperties = { fontSize: 14, borderRadius: 12, padding: '10px 12px' }
const inp = (coarse: boolean): CSSProperties => ({ height: coarse ? 44 : 42, borderRadius: 12, fontSize: 14 })

function Card({ label, style, children }: { label: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <section aria-label={label} style={{ borderRadius: 18, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.07)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14, ...style }}>
      {children}
    </section>
  )
}
