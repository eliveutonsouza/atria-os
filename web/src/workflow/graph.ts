import type { Edge, Node } from '@xyflow/react'
import type { StepStatus, WorkflowNode, WorkflowRunInfo } from '@shared/protocol'

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
