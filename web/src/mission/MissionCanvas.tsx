import { useCallback, useEffect, type CSSProperties } from 'react'
import { Background, BackgroundVariant, Controls, Panel, ReactFlow, useReactFlow, type Connection, type Edge, type EdgeChange, type NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../workflow/workflow.css'
import type { MissionStep } from '@shared/protocol'
import { useYui } from '../store/yui'
import { missionConnect, missionDisconnect, missionToFlow, type MissionFlowNode } from '../workflow/graph'
import { missionNodeTypes } from '../workflow/StepNode'
import { say } from './steps'

// Quadro das etapas da missão (@xyflow/react): arrastar de uma etapa para outra cria dependência.
// Precisa estar dentro de um ReactFlowProvider.

export function MissionCanvas({ steps, setSteps, selected, onSelect, onOpen, positions, setPositions, isLocked }: {
  steps: MissionStep[]
  setSteps: (fn: (s: MissionStep[]) => MissionStep[]) => void
  selected: string | null
  onSelect: (id: string | null) => void
  onOpen?: (id: string) => void // toque (celular): abre a etapa
  positions: Record<string, { x: number; y: number }>
  setPositions: (fn: (p: Record<string, { x: number; y: number }>) => Record<string, { x: number; y: number }>) => void
  isLocked: (s: MissionStep) => boolean
}) {
  const coarse = useYui((s) => s.coarse)
  const flow = missionToFlow(steps, { selected, positions, isLocked })
  // plano novo ou etapa a mais: reenquadra
  const rf = useReactFlow()
  const count = steps.length
  useEffect(() => {
    const t = setTimeout(() => void rf.fitView({ padding: 0.3, maxZoom: 1 }), 60)
    return () => clearTimeout(t)
  }, [count, rf])

  const onNodesChange = useCallback(
    (changes: NodeChange<MissionFlowNode>[]) => {
      for (const c of changes) {
        // exclusão de etapa só pelo botão (com confirmação); aqui só posição e seleção
        if (c.type === 'position' && c.position) {
          const pos = { x: Math.round(c.position.x), y: Math.round(c.position.y) }
          setPositions((p) => ({ ...p, [c.id]: pos }))
        } else if (c.type === 'select' && c.selected) onSelect(c.id)
      }
    },
    [onSelect, setPositions],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      for (const c of changes) {
        if (c.type !== 'remove') continue
        const tgt = steps.find((s) => s.id === c.id.split('->')[1])
        if (tgt && isLocked(tgt)) say('Essa etapa já saiu da fila; as dependências dela não mudam.')
        else setSteps((ss) => missionDisconnect(ss, c.id))
      }
    },
    [steps, isLocked, setSteps],
  )
  const onConnect = useCallback(
    (c: Connection) => {
      const tgt = steps.find((s) => s.id === c.target)
      if (tgt && isLocked(tgt)) return say('Essa etapa já saiu da fila; as dependências dela não mudam.')
      const next = missionConnect(steps, c.source, c.target)
      if (!next) return say('Essa ligação criaria um ciclo: uma etapa acabaria esperando por ela mesma.')
      setSteps(() => next)
    },
    [steps, isLocked, setSteps],
  )

  return (
    <ReactFlow
      nodes={flow.nodes}
      edges={flow.edges}
      nodeTypes={missionNodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={onOpen ? (_, n) => onOpen(n.id) : undefined}
      onPaneClick={() => onSelect(null)}
      colorMode="dark"
      fitView
      fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
      deleteKeyCode={['Delete', 'Backspace']}
      proOptions={{ hideAttribution: true }}
      minZoom={0.3}
      panOnDrag
      zoomOnPinch
      preventScrolling
      connectionRadius={coarse ? 32 : 20}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(160,170,255,.18)" />
      {coarse ? <TouchControls /> : <Controls showInteractive={false} />}
    </ReactFlow>
  )
}

// Zoom/encaixe com alvos de 44px para toque.
function TouchControls() {
  const rf = useReactFlow()
  const btn: CSSProperties = { width: 44, height: 44, border: 'none', background: 'rgba(16,20,42,.92)', color: '#dfe3f3', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }
  return (
    <Panel position="bottom-left" style={{ display: 'flex', flexDirection: 'column', gap: 1, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.08)' }}>
      <button aria-label="Aproximar" style={btn} onClick={() => void rf.zoomIn()}>+</button>
      <button aria-label="Afastar" style={btn} onClick={() => void rf.zoomOut()}>−</button>
      <button aria-label="Encaixar etapas na tela" style={{ ...btn, fontSize: 16 }} onClick={() => void rf.fitView({ padding: 0.3, maxZoom: 1 })}>⤢</button>
    </Panel>
  )
}
