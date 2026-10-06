import type { Edge, Node } from '@xyflow/react'
import type { MissionStep, StepStatus, WorkflowNode, WorkflowRunInfo } from '@shared/protocol'

// Conversão entre WorkflowNode[] (fonte = markdown) e nós/arestas do @xyflow/react.

export interface FlowData extends Record<string, unknown> {
  step: WorkflowNode
  status?: StepStatus
  decision?: string | null
  agentName?: string
  active?: boolean
}

export type FlowNode = Node<FlowData, 'step'>

const COL = 240
const ROW = 150

// Layout em camadas (BFS a partir do primeiro passo) para nós sem posição salva.
export function autoLayout(steps: WorkflowNode[]): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {}
  if (!steps.length) return pos
  const depth = new Map<string, number>()
  const queue: string[] = [steps[0].id]
  depth.set(steps[0].id, 0)
  while (queue.length) {
    const id = queue.shift()!
    const s = steps.find((n) => n.id === id)
    const d = depth.get(id)!
    for (const t of [...(s?.next ?? []), ...(s?.branches ?? []).map((b) => b.to)]) {
      if (!depth.has(t)) {
        depth.set(t, d + 1)
        queue.push(t)
      }
    }
  }
  let maxD = Math.max(0, ...depth.values())
  for (const s of steps) if (!depth.has(s.id)) depth.set(s.id, ++maxD)
  const perRow = new Map<number, string[]>()
  for (const s of steps) {
    const d = depth.get(s.id)!
    perRow.set(d, [...(perRow.get(d) ?? []), s.id])
  }
  for (const [d, ids] of perRow) {
    ids.forEach((id, i) => {
      pos[id] = { x: (i - (ids.length - 1) / 2) * COL, y: d * ROW }
    })
  }
  return pos
}

export function toFlow(
  steps: WorkflowNode[],
  opts: { run?: WorkflowRunInfo | null; agentNames?: Record<string, string>; selected?: string | null } = {},
): { nodes: FlowNode[]; edges: Edge[] } {
  const auto = autoLayout(steps)
  const nodes: FlowNode[] = steps.map((s) => {
    const st = opts.run?.nodes[s.id]
    return {
      id: s.id,
      type: 'step',
      position: s.position ?? auto[s.id] ?? { x: 0, y: 0 },
      selected: opts.selected === s.id,
      data: {
        step: s,
        status: st?.status,
        decision: st?.decision ?? null,
        agentName: s.agent ? (opts.agentNames?.[s.agent] ?? s.agent) : undefined,
        active: opts.run?.current === s.id && (opts.run.status === 'running' || opts.run.status === 'waiting_approval'),
      },
    }
  })
  const edges: Edge[] = []
  for (const s of steps) {
    for (const t of s.next ?? []) {
      edges.push({ id: `${s.id}->${t}`, source: s.id, target: t, type: 'smoothstep', animated: opts.run?.current === t })
    }
    for (const b of s.branches ?? []) {
      const taken = opts.run?.nodes[s.id]?.decision === b.label
      edges.push({
        id: `${s.id}=>${b.label}->${b.to}`,
        source: s.id,
        target: b.to,
        type: 'smoothstep',
        label: b.label,
        data: { branch: b.label },
        animated: taken,
        style: taken ? { stroke: '#cbbcff', strokeWidth: 2 } : undefined,
      })
    }
  }
  return { nodes, edges }
}

export const nextId = (steps: WorkflowNode[]) => String(Math.max(0, ...steps.map((s) => Number(s.id) || 0)) + 1)

// Remove um passo e todas as referências a ele.
export function removeStep(steps: WorkflowNode[], id: string): WorkflowNode[] {
  return steps
    .filter((s) => s.id !== id)
    .map((s) => ({
      ...s,
      next: s.next?.filter((t) => t !== id),
      branches: s.branches?.filter((b) => b.to !== id),
    }))
}

// Liga a → b. Decisão ganha um ramo novo ("sim", depois "não", depois "ramo N").
export function connect(steps: WorkflowNode[], a: string, b: string): WorkflowNode[] {
  if (a === b) return steps
  return steps.map((s) => {
    if (s.id !== a) return s
    if (s.type === 'end') return s
    if (s.type === 'decision') {
      const branches = s.branches ?? []
      if (branches.some((x) => x.to === b)) return s
      const used = new Set(branches.map((x) => x.label))
      const label = !used.has('sim') ? 'sim' : !used.has('não') ? 'não' : `ramo ${branches.length + 1}`
      return { ...s, branches: [...branches, { label, to: b }] }
    }
    const next = s.next ?? []
    if (next.includes(b)) return s
    // tarefa/aprovação seguem para um passo; início e paralelo podem abrir vários ramos
    return { ...s, next: s.type === 'parallel' || s.type === 'start' ? [...next, b] : [b] }
  })
}

export function disconnect(steps: WorkflowNode[], edgeId: string): WorkflowNode[] {
  const m = /^(.+?)(?:=>(.+))?->(.+)$/.exec(edgeId)
  if (!m) return steps
  const [, src, label, tgt] = m
  return steps.map((s) => {
    if (s.id !== src) return s
    if (label !== undefined) return { ...s, branches: s.branches?.filter((b) => !(b.label === label && b.to === tgt)) }
    return { ...s, next: s.next?.filter((t) => t !== tgt) }
  })
}

// ---------- missões: dependsOn ⇄ arestas (esquerda → direita, colunas por profundidade) ----------

export interface MissionFlowData extends Record<string, unknown> {
  mstep: MissionStep
  n: number // posição na lista (1, 2…)
  depsLabel: string // "depois de 1 e 2"
  locked: boolean // etapa que já saiu da fila (não editável)
}

export type MissionFlowNode = Node<MissionFlowData, 'mission'>

const MCOL = 260
const MROW = 120

export function missionLayout(steps: MissionStep[]): Record<string, { x: number; y: number }> {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const depth = new Map<string, number>()
  const walk = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const deps = byId.get(id)?.dependsOn.filter((d) => byId.has(d)) ?? []
    const d = deps.length ? 1 + Math.max(...deps.map((x) => walk(x, seen))) : 0
    depth.set(id, d)
    return d
  }
  steps.forEach((s) => walk(s.id, new Set()))
  const cols = new Map<number, string[]>()
  for (const s of steps) cols.set(depth.get(s.id)!, [...(cols.get(depth.get(s.id)!) ?? []), s.id])
  const pos: Record<string, { x: number; y: number }> = {}
  for (const [d, ids] of cols) ids.forEach((id, i) => (pos[id] = { x: d * MCOL, y: (i - (ids.length - 1) / 2) * MROW }))
  return pos
}

export const missionNumbers = (steps: MissionStep[]) => new Map(steps.map((s, i) => [s.id, i + 1]))

export function depsText(step: MissionStep, nums: Map<string, number>): string {
  const n = step.dependsOn.map((d) => String(nums.get(d) ?? d))
  return n.length ? `depois de ${n.length > 1 ? `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}` : n[0]}` : ''
}

export function missionToFlow(
  steps: MissionStep[],
  opts: { selected?: string | null; positions?: Record<string, { x: number; y: number }>; isLocked?: (s: MissionStep) => boolean } = {},
): { nodes: MissionFlowNode[]; edges: Edge[] } {
  const auto = missionLayout(steps)
  const nums = missionNumbers(steps)
  const nodes: MissionFlowNode[] = steps.map((s) => ({
    id: s.id,
    type: 'mission',
    position: opts.positions?.[s.id] ?? auto[s.id] ?? { x: 0, y: 0 },
    selected: opts.selected === s.id,
    data: { mstep: s, n: nums.get(s.id) ?? 0, depsLabel: depsText(s, nums), locked: !!opts.isLocked?.(s) },
  }))
  const edges: Edge[] = steps.flatMap((s) =>
    s.dependsOn.filter((d) => nums.has(d)).map((d) => ({ id: `${d}->${s.id}`, source: d, target: s.id, type: 'smoothstep', animated: s.status === 'running' })),
  )
  return { nodes, edges }
}

// a depende (direta ou indiretamente) de b?
function reaches(steps: MissionStep[], a: string, b: string, seen = new Set<string>()): boolean {
  if (a === b) return true
  if (seen.has(a)) return false
  seen.add(a)
  return (steps.find((s) => s.id === a)?.dependsOn ?? []).some((d) => reaches(steps, d, b, seen))
}

// Ligar a → b = b passa a depender de a. Devolve null se criaria um ciclo.
export function missionConnect(steps: MissionStep[], a: string, b: string): MissionStep[] | null {
  if (a === b || reaches(steps, a, b)) return null
  return steps.map((s) => (s.id === b && !s.dependsOn.includes(a) ? { ...s, dependsOn: [...s.dependsOn, a] } : s))
}

export function missionDisconnect(steps: MissionStep[], edgeId: string): MissionStep[] {
  const [src, tgt] = edgeId.split('->')
  return steps.map((s) => (s.id === tgt ? { ...s, dependsOn: s.dependsOn.filter((d) => d !== src) } : s))
}

export function missionRemove(steps: MissionStep[], id: string): MissionStep[] {
  return steps.filter((s) => s.id !== id).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== id) }))
}

export const missionNextId = (steps: MissionStep[]) => `s${Math.max(0, ...steps.map((s) => Number(s.id.replace(/^s/, '')) || 0)) + 1}`
