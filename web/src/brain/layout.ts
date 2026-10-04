import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force'

// Layout do universo: força por galáxia (pasta) puxando cada estrela para o centro da sua galáxia,
// galáxias distribuídas num anel. Posições ficam salvas no navegador para o universo não "pular".

export interface SimNode extends SimulationNodeDatum {
  id: string
  galaxy: string
  r: number
}
export type SimLink = SimulationLinkDatum<SimNode>

const STORE = 'yui.brain.pos'

export function loadPositions(): Record<string, [number, number]> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}')
  } catch {
    return {}
  }
}

export function savePositions(nodes: SimNode[]) {
  const out: Record<string, [number, number]> = {}
  for (const n of nodes) if (n.x !== undefined && n.y !== undefined) out[n.id] = [Math.round(n.x), Math.round(n.y)]
  try {
    localStorage.setItem(STORE, JSON.stringify(out))
  } catch {
    /* sem storage: só não lembra */
  }
}

export function galaxyCenters(galaxies: string[], total: number): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>()
  const R = galaxies.length <= 1 ? 0 : Math.max(220, Math.sqrt(total) * 34)
  galaxies.forEach((g, i) => {
    const a = (i / galaxies.length) * Math.PI * 2 - Math.PI / 2
    m.set(g, { x: Math.cos(a) * R, y: Math.sin(a) * R * 0.78 })
  })
  return m
}

export function createSimulation(nodes: SimNode[], links: SimLink[], centers: Map<string, { x: number; y: number }>, onSettle: () => void): Simulation<SimNode, SimLink> {
  const saved = loadPositions()
  let fresh = 0
  for (const n of nodes) {
    const p = saved[n.id]
    if (n.x !== undefined && n.y !== undefined) continue
    if (p) {
      n.x = p[0]
      n.y = p[1]
    } else {
      const c = centers.get(n.galaxy) ?? { x: 0, y: 0 }
      n.x = c.x + (Math.random() - 0.5) * 80
      n.y = c.y + (Math.random() - 0.5) * 80
      fresh++
    }
  }
  const big = nodes.length > 800
  const sim = forceSimulation<SimNode, SimLink>(nodes)
    .force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(big ? 34 : 48).strength(0.25))
    .force('charge', forceManyBody<SimNode>().strength(big ? -28 : -70).distanceMax(big ? 260 : 420).theta(0.9))
    .force('collide', forceCollide<SimNode>((d) => d.r + 6).iterations(1))
    .force('gx', forceX<SimNode>((d) => centers.get(d.galaxy)?.x ?? 0).strength(0.07))
    .force('gy', forceY<SimNode>((d) => centers.get(d.galaxy)?.y ?? 0).strength(0.07))
    .alphaDecay(0.03)
    .velocityDecay(0.45)
  // tudo já posicionado (cache) → começa quase parado; só o que é novo se acomoda
  sim.alpha(fresh === 0 ? 0.06 : fresh < nodes.length * 0.2 ? 0.35 : 1)
  if (fresh > nodes.length * 0.5) sim.tick(Math.min(220, 40 + Math.round(4000 / Math.max(1, nodes.length))))
  let settled = false
  sim.on('tick', () => {
    if (!settled && sim.alpha() < 0.03) {
      settled = true
      savePositions(nodes)
      onSettle()
    }
  })
  sim.on('end', () => savePositions(nodes))
  return sim
}
