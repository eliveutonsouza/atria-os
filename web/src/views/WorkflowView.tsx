import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../workflow/workflow.css'
import type { AgentInfo, WorkflowDef, WorkflowNode, WorkflowNodeType, WorkflowRunInfo } from '@shared/protocol'
import { parseWorkflowMarkdown, serializeWorkflow, slugify, toMermaid, validateWorkflow } from '@shared/workflowMarkdown'
import { MermaidDiagram } from '../lib/MermaidDiagram'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { connect, disconnect, nextId, removeStep, toFlow, type FlowNode } from '../workflow/graph'
import { nodeTypes, TYPE_META } from '../workflow/StepNode'
import { DeleteWorkflowModal } from '../workflow/DeleteWorkflow'
import { CRON_PRESETS, describeCron, send } from '../workflow/http'
import { ErrorNote, Skeleton, useHeader } from './ui'

// Editor de workflow: fluxograma (@xyflow/react) ⇄ markdown canônico, com execução ao vivo.

type Draft = Omit<WorkflowDef, 'markdown' | 'updatedAt'>

const BLANK: Draft = {
  slug: '',
  name: 'Novo workflow',
  description: '',
  trigger: { type: 'manual' },
  project: null,
  team: [],
  nodes: [
    { id: '1', type: 'task', title: 'Primeiro passo', instruction: '', next: ['2'] },
    { id: '2', type: 'end', title: 'Fim' },
  ],
}

const say = (t: string) => useYui.getState().say(t)

export function WorkflowView() {
  const slug = useYui((s) => s.viewParams.workflowId ?? null)
  const runParam = useYui((s) => s.viewParams.workflowRunId ?? null)
  const { data, loading, error } = useApi<WorkflowDef>(slug ? `/api/workflows/${encodeURIComponent(slug)}` : null, [slug])
  if (slug && loading && !data) return <Skeleton kpis={0} rows={6} />
  if (slug && (error || !data)) return <ErrorNote text="Não encontrei esse workflow." />
  return (
    <ReactFlowProvider>
      <Editor key={slug ?? 'new'} initial={data ?? null} runParam={runParam} />
    </ReactFlowProvider>
  )
}

function Editor({ initial, runParam }: { initial: WorkflowDef | null; runParam: string | null }) {
  const [draft, setDraft] = useState<Draft>(() => (initial ? stripDef(initial) : BLANK))
  const [savedMd, setSavedMd] = useState(initial?.markdown ?? '')
  const [mdText, setMdText] = useState(() => serializeWorkflow(initial ? stripDef(initial) : BLANK))
  const [mdError, setMdError] = useState<string | null>(null)
  const [tab, setTab] = useState<'props' | 'md' | 'mmd' | 'runs'>('props')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [runId, setRunId] = useState<string | null>(runParam)
  const [schedOpen, setSchedOpen] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const agents = useApi<AgentInfo[]>('/api/agents').data ?? []
  const agentNames = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name])), [agents])
  const liveRun = useYui((s) => (runId ? s.workflowRuns[runId] : undefined))
  const runs = useApi<WorkflowRunInfo[]>(draft.slug ? `/api/workflows/${encodeURIComponent(draft.slug)}/runs` : null, [draft.slug, liveRun?.status], 0)
  const run = liveRun ?? (runId ? runs.data?.find((r) => r.id === runId) : undefined) ?? null
  const isNew = !initial
  const md = useMemo(() => serializeWorkflow(draft), [draft])
  const dirty = md !== savedMd
  const errors = useMemo(() => validateWorkflow(draft), [draft])
  const mdFocus = useRef(false)

  // markdown acompanha o grafo (exceto enquanto o usuário edita o texto)
  useEffect(() => {
    if (!mdFocus.current) setMdText(md)
  }, [md])

  // última execução ativa aparece ao abrir
  useEffect(() => {
    if (!runId && runs.data?.[0] && (runs.data[0].status === 'running' || runs.data[0].status === 'waiting_approval')) setRunId(runs.data[0].id)
  }, [runs.data, runId])

  const flow = useMemo(() => toFlow(draft.nodes, { run, agentNames, selected }), [draft.nodes, run, agentNames, selected])

  const update = useCallback((fn: (nodes: WorkflowNode[]) => WorkflowNode[]) => setDraft((d) => ({ ...d, nodes: fn(d.nodes) })), [])
  const patchStep = (id: string, p: Partial<WorkflowNode>) => update((ns) => ns.map((n) => (n.id === id ? clean({ ...n, ...p }) : n)))

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      for (const c of changes) {
        if (c.type === 'position' && c.position && !c.dragging) {
          const pos = { x: Math.round(c.position.x), y: Math.round(c.position.y) }
          update((ns) => ns.map((n) => (n.id === c.id ? { ...n, position: pos } : n)))
        } else if (c.type === 'position' && c.position) {
          const pos = { x: c.position.x, y: c.position.y }
          update((ns) => ns.map((n) => (n.id === c.id ? { ...n, position: pos } : n)))
        } else if (c.type === 'remove') {
          update((ns) => removeStep(ns, c.id))
          setSelected((s) => (s === c.id ? null : s))
        } else if (c.type === 'select' && c.selected) setSelected(c.id)
      }
    },
    [update],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      for (const c of changes) if (c.type === 'remove') update((ns) => disconnect(ns, c.id))
    },
    [update],
  )
  const onConnect = useCallback((c: Connection) => update((ns) => connect(ns, c.source, c.target)), [update])

  const addStep = (type: WorkflowNodeType) => {
    const id = nextId(draft.nodes)
    const sel = draft.nodes.find((n) => n.id === selected)
    const base = sel?.position ?? { x: 0, y: draft.nodes.length * 150 }
    const step: WorkflowNode = clean({
      id,
      type,
      title: type === 'decision' ? 'Condição atendida?' : type === 'approval' ? 'Revisão humana' : type === 'end' ? 'Fim' : type === 'parallel' ? 'Em paralelo' : 'Novo passo',
      ...(type === 'task' ? { agent: agents[0]?.id, instruction: '' } : {}),
      ...(type === 'decision' ? { condition: '' } : {}),
      position: { x: base.x + 40, y: base.y + 150 },
    })
    update((ns) => {
      const added = [...ns, step]
      return sel && sel.type !== 'end' ? connect(added, sel.id, id) : added
    })
    setSelected(id)
    setTab('props')
  }

  const applyMarkdown = (text: string, adopt = true) => {
    try {
      const parsed = parseWorkflowMarkdown(text, draft.slug || undefined)
      if (!parsed.nodes.length) throw new Error('nenhum passo "## N. Título" encontrado')
      setMdError(null)
      if (adopt) setDraft({ ...parsed, slug: draft.slug || parsed.slug })
      return true
    } catch (e) {
      setMdError((e as Error).message)
      return false
    }
  }

  const save = async (): Promise<string | null> => {
    const s = draft.slug || slugify(draft.name)
    if (!s) return null
    setBusy(true)
    try {
      const w = await send<WorkflowDef & { errors: string[] }>('PUT', `/api/workflows/${encodeURIComponent(s)}`, { markdown: serializeWorkflow(draft) })
      setDraft(stripDef(w))
      setSavedMd(w.markdown)
      if (isNew || s !== draft.slug) useYui.getState().show('workflow', { workflowId: w.slug })
      say(w.errors.length ? `Salvei, mas há ajustes: ${w.errors[0]}.` : `Workflow "${w.name}" salvo.`)
      return w.slug
    } catch (e) {
      say(`Não consegui salvar: ${(e as Error).message}.`)
      return null
    } finally {
      setBusy(false)
    }
  }

  const runNow = async () => {
    if (errors.length) return say(`Antes de rodar: ${errors[0]}.`)
    const s = dirty || isNew ? await save() : draft.slug
    if (!s) return
    try {
      const r = await send<WorkflowRunInfo>('POST', `/api/workflows/${encodeURIComponent(s)}/run`, {})
      useYui.getState().set({ workflowRuns: { ...useYui.getState().workflowRuns, [r.id]: r } })
      setRunId(r.id)
      setTab('runs')
      say(`Rodando "${draft.name}". Acompanhe os passos acendendo no fluxograma.`)
    } catch (e) {
      say(`Não consegui rodar: ${(e as Error).message}.`)
    }
  }

  const schedule = async (cron: string | null) => {
    setSchedOpen(false)
    const s = dirty || isNew ? await save() : draft.slug
    if (!s) return
    try {
      const w = await send<WorkflowDef>('POST', `/api/workflows/${encodeURIComponent(s)}/schedule`, { cron })
      setDraft(stripDef(w))
      setSavedMd(w.markdown)
      say(cron ? `Agendado: ${describeCron(cron)}.` : 'Agendamento removido; o workflow fica manual.')
    } catch (e) {
      say(`Agendamento inválido: ${(e as Error).message}.`)
    }
  }

  const copyMd = async () => {
    try {
      await navigator.clipboard.writeText(md)
      say('Markdown copiado.')
    } catch {
      setTab('md')
      say('Não consegui acessar a área de transferência — o markdown está na aba Markdown para copiar.')
    }
  }
  const pasteMd = async () => {
    try {
      const t = await navigator.clipboard.readText()
      setMdText(t)
      if (applyMarkdown(t)) say('Workflow colado. Confira o fluxograma e salve.')
      setTab('md')
    } catch {
      setTab('md')
      say('Cole o markdown na aba Markdown (Ctrl+V) — o fluxograma atualiza sozinho.')
    }
  }

  const cancelRun = async () => {
    if (!run) return
    await api.post(`/api/workflow-runs/${run.id}/cancel`).catch(() => {})
  }

  const running = run && (run.status === 'running' || run.status === 'waiting_approval')
  useHeader(
    isNew ? 'Novo workflow' : `Workflow · ${describeCron(draft.trigger.type === 'cron' ? draft.trigger.cron : null)}`,
    draft.name,
    [
      { label: busy ? 'Salvando…' : dirty || isNew ? 'Salvar' : 'Salvo', fn: () => void save() },
      running ? { label: 'Parar execução', fn: () => void cancelRun() } : { label: 'Rodar agora', fn: () => void runNow() },
      { label: 'Agendar', fn: () => setSchedOpen((o) => !o) },
      { label: 'Todos os workflows', fn: () => useYui.getState().show('workflows') },
      ...(isNew ? [] : [{ label: 'Excluir workflow', fn: () => setDelOpen(true) }]),
    ],
    [busy, dirty, isNew, running, draft.name, draft.trigger.cron, errors.length],
  )

  const sel = draft.nodes.find((n) => n.id === selected) ?? null

  return (
    <div style={{ height: '100%', minHeight: 540, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* barra: nome, paleta de nós, markdown */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="wf-input"
          aria-label="Nome do workflow"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          style={{ maxWidth: 260, fontWeight: 600 }}
        />
        <span style={{ width: 1, height: 22, background: 'rgba(255,255,255,.08)', margin: '0 4px' }} />
        {(['task', 'decision', 'approval', 'parallel', 'end'] as WorkflowNodeType[]).map((t) => (
          <button key={t} className="wf-btn" onClick={() => addStep(t)} title={`Adicionar ${TYPE_META[t].label.toLowerCase()}${selected ? ' depois do passo selecionado' : ''}`}>
            <span style={{ color: TYPE_META[t].color, marginRight: 6 }}>{TYPE_META[t].icon}</span>
            {TYPE_META[t].label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="wf-btn ghost" onClick={() => void copyMd()}>Copiar markdown</button>
        <button className="wf-btn ghost" onClick={() => void pasteMd()}>Colar markdown</button>
      </div>

      {schedOpen && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 14, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)' }}>
          <span className="wf-label" style={{ margin: '0 6px 0 0' }}>Agendar</span>
          {CRON_PRESETS.map((p) => (
            <button key={p.label} className="wf-btn" onClick={() => void schedule(p.cron)} aria-pressed={draft.trigger.cron === p.cron}>
              {p.label}
            </button>
          ))}
          <CustomCron initial={draft.trigger.cron ?? ''} onApply={(c) => void schedule(c)} />
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ fontSize: 12.5, color: '#f5c97a', padding: '8px 12px', borderRadius: 10, background: 'rgba(245,181,74,.06)', border: '1px solid rgba(245,181,74,.2)' }}>
          {errors.slice(0, 3).join(' · ')}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="wf-canvas" style={{ flex: '1 1 480px', minHeight: 440, borderRadius: 16, border: '1px solid rgba(255,255,255,.06)', background: 'rgba(0,0,0,.22)', overflow: 'hidden' }}>
          <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={() => setSelected(null)}
            colorMode="dark"
            fitView
            fitViewOptions={{ padding: 0.25 }}
            deleteKeyCode={['Delete', 'Backspace']}
            proOptions={{ hideAttribution: true }}
            minZoom={0.3}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(160,170,255,.18)" />
            <Controls showInteractive={false} />
            {draft.nodes.length > 8 && <MiniMap pannable zoomable style={{ width: 150, height: 96 }} nodeColor={(n) => TYPE_META[(n as FlowNode).data.step.type].color} maskColor="rgba(6,7,13,.6)" />}
          </ReactFlow>
        </div>

        <aside style={{ flex: '0 1 340px', minWidth: 280, display: 'flex', flexDirection: 'column', borderRadius: 16, border: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.02)', minHeight: 440 }}>
          <div role="tablist" style={{ display: 'flex', gap: 16, padding: '10px 16px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <button role="tab" className="wf-tab" aria-selected={tab === 'props'} onClick={() => setTab('props')}>Propriedades</button>
            <button role="tab" className="wf-tab" aria-selected={tab === 'md'} onClick={() => setTab('md')}>Markdown</button>
            <button role="tab" className="wf-tab" aria-selected={tab === 'mmd'} onClick={() => setTab('mmd')}>Mermaid</button>
            <button role="tab" className="wf-tab" aria-selected={tab === 'runs'} onClick={() => setTab('runs')}>Execuções</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16 }}>
            {tab === 'props' && (sel ? <StepProps step={sel} steps={draft.nodes} agents={agents} onChange={(p) => patchStep(sel.id, p)} onDelete={() => { update((ns) => removeStep(ns, sel.id)); setSelected(null) }} /> : <WorkflowProps draft={draft} setDraft={setDraft} />)}
            {tab === 'md' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
                <div style={{ fontSize: 12, color: C.t3 }}>Edite ou cole o markdown — o fluxograma atualiza. É o mesmo texto que os agentes leem.</div>
                <textarea
                  className="wf-input wf-mono"
                  aria-label="Markdown do workflow"
                  spellCheck={false}
                  value={mdText}
                  onFocus={() => (mdFocus.current = true)}
                  onBlur={() => {
                    mdFocus.current = false
                    if (mdText !== md) applyMarkdown(mdText)
                  }}
                  onChange={(e) => {
                    setMdText(e.target.value)
                    applyMarkdown(e.target.value)
                  }}
                  style={{ flex: 1, minHeight: 360 }}
                />
                {mdError && <div style={{ fontSize: 12, color: C.crit }}>{mdError}</div>}
              </div>
            )}
            {tab === 'mmd' && <MermaidTab draft={draft} run={run} />}
            {tab === 'runs' && <RunsPanel runs={runs.data ?? []} current={run} onPick={(id) => setRunId(id)} steps={draft.nodes} />}
          </div>
        </aside>
      </div>
      {delOpen && initial && (
        <DeleteWorkflowModal
          slug={initial.slug}
          name={initial.name}
          rows={[
            { label: 'Passos', value: String(initial.nodes.length) },
            { label: 'Gatilho', value: describeCron(initial.trigger.type === 'cron' ? initial.trigger.cron : null) },
            ...(running ? [{ label: 'Em execução agora', value: 'será interrompida' }] : []),
          ]}
          onClose={() => setDelOpen(false)}
          onDeleted={() => useYui.getState().show('workflows')}
        />
      )}
    </div>
  )
}

// Fluxo em Mermaid (o mesmo bloco do arquivo); com execução aberta, marca feitos e o passo atual.
function MermaidTab({ draft, run }: { draft: Draft; run: WorkflowRunInfo | null }) {
  const [copied, setCopied] = useState(false)
  const status: Record<string, 'done' | 'skipped' | 'failed'> = {}
  for (const [id, st] of Object.entries(run?.nodes ?? {})) {
    if (st.status === 'done') status[id] = 'done'
    else if (st.status === 'skipped') status[id] = 'skipped'
    else if (st.status === 'failed' || st.status === 'cancelled') status[id] = 'failed'
  }
  const code = toMermaid(draft, run ? { current: run.current, status } : {})
  const copy = () => {
    void navigator.clipboard?.writeText(toMermaid(draft)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 12, color: C.t3 }}>{run ? 'Execução aberta: passo atual destacado, concluídos em verde.' : 'É assim que a Yui e os agentes enxergam o fluxo.'}</span>
        <button className="wf-btn ghost" onClick={copy}>{copied ? 'Copiado' : 'Copiar Mermaid'}</button>
      </div>
      <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.06)', background: '#0a0c1a', padding: 10 }}>
        <MermaidDiagram code={code} minHeight={240} />
      </div>
      <pre className="wf-mono" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: C.t2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{toMermaid(draft)}</pre>
    </div>
  )
}

function stripDef(w: WorkflowDef): Draft {
  return { slug: w.slug, name: w.name, description: w.description, trigger: w.trigger, project: w.project, team: w.team, nodes: w.nodes }
}

// Remove campos vazios para o markdown não ganhar linhas inúteis.
function clean(n: WorkflowNode): WorkflowNode {
  const out = { ...n }
  for (const k of ['agent', 'instruction', 'output', 'condition'] as const) if (out[k] === '') delete out[k]
  for (const k of ['skills', 'mcp', 'next', 'branches'] as const) if (Array.isArray(out[k]) && !(out[k] as unknown[]).length) delete out[k]
  if (out.type === 'decision') delete out.next
  if (out.type !== 'decision') delete out.branches
  if (out.type !== 'task') {
    delete out.agent
    delete out.skills
    delete out.mcp
    delete out.output
  }
  if (out.type === 'end') delete out.next
  if (out.type !== 'approval' || !out.ask) delete out.ask
  return out
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span className="wf-label">{label}</span>
      {children}
    </label>
  )
}

const listText = (xs?: string[]) => (xs ?? []).join(', ')
const textList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

function StepProps({ step, steps, agents, onChange, onDelete }: { step: WorkflowNode; steps: WorkflowNode[]; agents: AgentInfo[]; onChange: (p: Partial<WorkflowNode>) => void; onDelete: () => void }) {
  const others = steps.filter((s) => s.id !== step.id)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: TYPE_META[step.type].color, fontWeight: 700 }}>
          Passo {step.id}
        </span>
        <select className="wf-input" aria-label="Tipo do passo" value={step.type} onChange={(e) => onChange({ type: e.target.value as WorkflowNodeType })} style={{ width: 'auto' }}>
          {(Object.keys(TYPE_META) as WorkflowNodeType[]).map((t) => (
            <option key={t} value={t}>{TYPE_META[t].label}</option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button className="wf-btn ghost" onClick={onDelete} style={{ color: '#f39aa4' }}>Excluir</button>
      </div>
      <Field label="Título">
        <input className="wf-input" value={step.title} onChange={(e) => onChange({ title: e.target.value })} />
      </Field>
      {step.type === 'task' && (
        <>
          <Field label="Agente">
            <select className="wf-input" value={step.agent ?? ''} onChange={(e) => onChange({ agent: e.target.value })}>
              <option value="">— escolha —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name} · {a.group}</option>
              ))}
              {step.agent && !agents.some((a) => a.id === step.agent) && <option value={step.agent}>{step.agent} (não encontrado)</option>}
            </select>
          </Field>
          <Field label="Instrução">
            <textarea className="wf-input" rows={6} value={step.instruction ?? ''} onChange={(e) => onChange({ instruction: e.target.value })} placeholder="O que o agente deve fazer neste passo, em detalhe." />
          </Field>
          <Field label="Conectores / MCP (vírgula)">
            <input className="wf-input" value={listText(step.mcp)} onChange={(e) => onChange({ mcp: textList(e.target.value) })} placeholder="Gmail, Google Drive, Firecrawl" />
          </Field>
          <Field label="Skills (vírgula)">
            <input className="wf-input" value={listText(step.skills)} onChange={(e) => onChange({ skills: textList(e.target.value) })} placeholder="deep-research, design" />
          </Field>
          <Field label="Nome da saída">
            <input className="wf-input" value={step.output ?? ''} onChange={(e) => onChange({ output: e.target.value })} placeholder="legenda" />
          </Field>
        </>
      )}
      {step.type === 'approval' && (
        <>
          <Field label="O que revisar">
            <textarea className="wf-input" rows={3} value={step.instruction ?? ''} onChange={(e) => onChange({ instruction: e.target.value })} />
          </Field>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: C.t2, lineHeight: 1.45, marginBottom: 10 }}>
            <input type="checkbox" checked={!!step.ask} onChange={(e) => onChange({ ask: e.target.checked })} style={{ marginTop: 2 }} />
            <span>
              <b style={{ color: C.text, fontWeight: 600 }}>Sempre me perguntar</b>
              <br />
              Desmarcado, a Yui decide sozinha com base nas suas decisões anteriores e só te chama quando não tiver certeza.
            </span>
          </label>
        </>
      )}
      {step.type === 'decision' && (
        <>
          <Field label="Condição (linguagem natural)">
            <textarea className="wf-input" rows={3} value={step.condition ?? ''} onChange={(e) => onChange({ condition: e.target.value })} placeholder="A legenda está pronta para publicar?" />
          </Field>
          <span className="wf-label">Ramos</span>
          {(step.branches ?? []).map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input
                className="wf-input"
                aria-label="Rótulo do ramo"
                value={b.label}
                onChange={(e) => onChange({ branches: (step.branches ?? []).map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                style={{ flex: '0 0 90px' }}
              />
              <select
                className="wf-input"
                aria-label="Destino do ramo"
                value={b.to}
                onChange={(e) => onChange({ branches: (step.branches ?? []).map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })}
              >
                {others.map((s) => (
                  <option key={s.id} value={s.id}>{s.id}. {s.title}</option>
                ))}
              </select>
              <button className="wf-btn ghost" aria-label="Remover ramo" onClick={() => onChange({ branches: (step.branches ?? []).filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <button
            className="wf-btn"
            disabled={!others.length}
            onClick={() => onChange({ branches: [...(step.branches ?? []), { label: (step.branches ?? []).length ? 'não' : 'sim', to: others[0]?.id ?? '' }] })}
          >
            + Ramo
          </button>
          <div style={{ marginTop: 10, fontSize: 12, color: C.t3 }}>Dica: arraste do ponto inferior do losango até outro passo para criar um ramo.</div>
        </>
      )}
      {(step.type === 'task' || step.type === 'approval' || step.type === 'start' || step.type === 'parallel') && (
        <Field label={step.type === 'parallel' || step.type === 'start' ? 'Próximos (em paralelo)' : 'Próximo passo'}>
          <select
            className="wf-input"
            multiple={step.type === 'parallel' || step.type === 'start'}
            value={step.type === 'parallel' || step.type === 'start' ? (step.next ?? []) : (step.next?.[0] ?? '')}
            onChange={(e) => {
              const vals = Array.from(e.target.selectedOptions).map((o) => o.value).filter(Boolean)
              onChange({ next: vals })
            }}
          >
            {!(step.type === 'parallel' || step.type === 'start') && <option value="">— nenhum (fim) —</option>}
            {others.map((s) => (
              <option key={s.id} value={s.id}>{s.id}. {s.title}</option>
            ))}
          </select>
        </Field>
      )}
    </div>
  )
}

function WorkflowProps({ draft, setDraft }: { draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>> }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.t3, marginBottom: 14 }}>Selecione um passo no fluxograma para editar. Configurações gerais:</div>
      <Field label="Descrição">
        <textarea className="wf-input" rows={3} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
      </Field>
      <Field label="Projeto (slug, opcional)">
        <input className="wf-input" value={draft.project ?? ''} onChange={(e) => setDraft((d) => ({ ...d, project: e.target.value.trim() || null }))} placeholder="eliveuton-instagram" />
      </Field>
      <Field label="Time de agentes">
        <input className="wf-input" value={listText(draft.team)} onChange={(e) => setDraft((d) => ({ ...d, team: textList(e.target.value) }))} />
      </Field>
      <Field label="Gatilho">
        <div style={{ fontSize: 13, color: C.text }}>{draft.trigger.type === 'cron' ? `${describeCron(draft.trigger.cron)} · ${draft.trigger.cron}` : 'Manual (use Agendar)'}</div>
      </Field>
      <div style={{ fontSize: 12, color: C.t3, lineHeight: 1.6 }}>
        Passos: {draft.nodes.length} · tarefas {draft.nodes.filter((n) => n.type === 'task').length} · decisões {draft.nodes.filter((n) => n.type === 'decision').length} · aprovações{' '}
        {draft.nodes.filter((n) => n.type === 'approval').length}
      </div>
    </div>
  )
}

const RUN_STATUS: Record<WorkflowRunInfo['status'], { t: string; c: string }> = {
  running: { t: 'rodando', c: C.cyan },
  waiting_approval: { t: 'aguardando aprovação', c: C.warn },
  done: { t: 'concluído', c: C.ok },
  failed: { t: 'falhou', c: C.crit },
  cancelled: { t: 'cancelado', c: C.t3 },
}

function RunsPanel({ runs, current, onPick, steps }: { runs: WorkflowRunInfo[]; current: WorkflowRunInfo | null; onPick: (id: string) => void; steps: WorkflowNode[] }) {
  const list = current && !runs.some((r) => r.id === current.id) ? [current, ...runs] : runs
  if (!list.length) return <div style={{ fontSize: 13, color: C.t3 }}>Ainda não há execuções. Use “Rodar agora”.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.map((r) => {
        const st = RUN_STATUS[r.status]
        const open = current?.id === r.id
        return (
          <div key={r.id} style={{ borderRadius: 12, border: `1px solid ${open ? 'rgba(103,216,242,.25)' : 'rgba(255,255,255,.06)'}`, background: open ? 'rgba(255,255,255,.04)' : 'transparent' }}>
            <button onClick={() => onPick(r.id)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 12px', border: 'none', background: 'transparent', color: C.text, cursor: 'pointer', fontSize: 12.5, textAlign: 'left' }}>
              <span>{new Date(r.startedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              <span style={{ color: st.c }}>{st.t}</span>
            </button>
            {open && (
              <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {steps.map((s) => {
                  const ns = r.nodes[s.id]
                  if (!ns || ns.status === 'pending' || ns.status === 'skipped') return null
                  return (
                    <div key={s.id} style={{ fontSize: 12, lineHeight: 1.45 }}>
                      <span style={{ color: ns.status === 'done' ? C.ok : ns.status === 'failed' ? C.crit : ns.status === 'running' ? C.cyan : C.warn }}>
                        {s.id}. {s.title}
                      </span>
                      {ns.decision && <span style={{ color: C.lav }}> → {ns.decision}</span>}
                      {ns.result && <div style={{ color: C.t2, whiteSpace: 'pre-wrap' }}>{ns.result.length > 280 ? `${ns.result.slice(0, 280)}…` : ns.result}</div>}
                      {ns.decidedBy === 'yui' && <YuiDecisionFeedback runId={r.id} nodeId={s.id} approved={ns.decision === 'aprovado'} feedback={ns.feedback ?? null} />}
                      {ns.runId && (
                        <button className="wf-btn ghost" style={{ height: 24, padding: '0 6px', fontSize: 11 }} onClick={() => useYui.getState().show('runs', { runId: ns.runId! })}>
                          ver execução do agente
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Aprovação decidida pela Yui: Concordo/Discordo vira lição para as próximas (não desfaz a execução).
function YuiDecisionFeedback({ runId, nodeId, approved, feedback }: { runId: string; nodeId: string; approved: boolean; feedback: 'agree' | 'disagree' | null }) {
  const [note, setNote] = useState('')
  const [writing, setWriting] = useState(false)
  const [busy, setBusy] = useState(false)
  const send_ = async (agree: boolean) => {
    setBusy(true)
    try {
      const r = await send<WorkflowRunInfo>('POST', `/api/workflow-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/feedback`, { approved: agree ? approved : !approved, note: note.trim() || undefined })
      useYui.getState().set({ workflowRuns: { ...useYui.getState().workflowRuns, [r.id]: r } })
      useYui.getState().say(agree ? 'Anotado, sigo assim.' : 'Anotado: da próxima vez decido diferente.')
      setWriting(false)
    } catch (e) {
      useYui.getState().say(`Não consegui registrar: ${(e as Error).message}.`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, padding: '8px 10px', borderRadius: 10, background: 'rgba(166,140,247,.07)', border: '1px solid rgba(166,140,247,.18)' }}>
      <span style={{ fontSize: 11.5, color: C.lav }}>
        Decidido pela Yui{feedback === 'agree' ? ' · você concordou' : feedback === 'disagree' ? ' · você discordou (ela aprendeu)' : ''}
      </span>
      {!feedback && !writing && (
        <span style={{ display: 'flex', gap: 6 }}>
          <button className="wf-btn ghost" disabled={busy} style={{ height: 26, fontSize: 11.5 }} onClick={() => void send_(true)}>Concordo</button>
          <button className="wf-btn ghost" disabled={busy} style={{ height: 26, fontSize: 11.5, color: '#f39aa4' }} onClick={() => setWriting(true)}>Discordo</button>
        </span>
      )}
      {writing && (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input className="wf-input" autoFocus aria-label="Por que você discorda" placeholder={approved ? 'Por que não deveria ter aprovado? (opcional)' : 'Por que deveria ter aprovado? (opcional)'} value={note} onChange={(e) => setNote(e.target.value)} />
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="wf-btn" disabled={busy} style={{ height: 26, fontSize: 11.5 }} onClick={() => void send_(false)}>Ensinar a Yui</button>
            <button className="wf-btn ghost" disabled={busy} style={{ height: 26, fontSize: 11.5 }} onClick={() => setWriting(false)}>Voltar</button>
          </span>
        </span>
      )}
    </div>
  )
}

function CustomCron({ initial, onApply }: { initial: string; onApply: (c: string) => void }) {
  const [v, setV] = useState(initial)
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input className="wf-input wf-mono" aria-label="Cron personalizado" value={v} onChange={(e) => setV(e.target.value)} placeholder="min hora dia mês semana" style={{ width: 170 }} />
      <button className="wf-btn" disabled={!v.trim()} onClick={() => onApply(v.trim())}>
        Aplicar
      </button>
    </span>
  )
}
