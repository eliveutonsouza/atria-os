import { AMBER, CYAN, GHOST, VIOLET, coreSprite, glowSprite, rgba } from './palette'

// Motor do Cérebro: um único loop rAF em Canvas 2D desenha o espaço (estrelas em 3 camadas com parallax,
// nebulosas, poeira, estrelas cadentes), as rotas entre notas com partículas correndo e as estrelas (notas).
// Serve ao universo (layout por forças) e à Constelação (layout radial fixo, com anéis e o orb central).

export interface ENode {
  id: string
  label: string
  sub?: string // legenda menor (Constelação: tipo de ligação)
  color: string
  color2: string
  r: number
  hub: boolean
  ghost?: boolean
  sug?: boolean // estrela sugerida (Constelação)
  galaxy: string
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
}

export interface ELink {
  s: ENode
  t: ENode
  kind: 'link' | 'embed' | 'tag' | 'sug'
  dir?: 'out' | 'in' | 'both'
  strong?: boolean
}

export interface Nebula {
  x: number
  y: number
  r: number
  color: string
}

export interface EngineOpts {
  onSelect: (id: string | null) => void
  onHover: (id: string | null, sx: number, sy: number) => void
  onOpen: (id: string) => void
  onDrag?: (n: ENode, phase: 'start' | 'move' | 'end') => void
}

interface Particle { li: number; t: number; sp: number; sel: boolean }
interface Star { x: number; y: number; z: number; p: number; r: number }
interface Mote { x: number; y: number; vx: number; vy: number; r: number; c: string; p: number }
interface Shoot { x: number; y: number; vx: number; vy: number; l: number }

const TAU = Math.PI * 2
const K_ELLIPSE = 0.78

export class BrainEngine {
  private cv: HTMLCanvasElement
  private g: CanvasRenderingContext2D
  private opts: EngineOpts
  private w = 0
  private h = 0
  private dpr = 1
  private raf = 0
  private t = 0
  private last = 0
  private prm = false
  private destroyed = false

  nodes: ENode[] = []
  links: ELink[] = []
  private adj = new Map<string, Set<string>>()
  private byId = new Map<string, ENode>()
  private qt: Map<string, ENode[]> | null = null
  private qtAge = 0

  mode: 'universe' | 'constellation' = 'universe'
  rings: number[] = []
  centerId: string | null = null
  nebulae: Nebula[] = []
  selected: string | null = null
  hover: string | null = null
  hidden = new Set<string>()
  dimmed = new Set<string>()
  highlight = new Set<string>()
  suggestions: string[] = []
  pathIds: string[] = []
  particles = true
  labels = true
  showSug = true

  cam = { x: 0, y: 0, k: 1 }
  private camTo: { x: number; y: number; k: number; from: { x: number; y: number; k: number }; t0: number; dur: number } | null = null

  private stars: Star[] = []
  private motes: Mote[] = []
  private parts: Particle[] = []
  private shoot: Shoot | null = null

  // ponteiros (pan, arrasto de estrela, pinça)
  private ptrs = new Map<number, { x: number; y: number }>()
  private drag: { kind: 'pan' | 'node'; node?: ENode; sx: number; sy: number; cx: number; cy: number; moved: boolean } | null = null
  private pinch: { d: number; k: number; mx: number; my: number } | null = null
  private ro: ResizeObserver
  private onVis = () => {
    if (document.hidden) cancelAnimationFrame(this.raf)
    else this.loop()
  }

  constructor(cv: HTMLCanvasElement, opts: EngineOpts) {
    this.cv = cv
    this.g = cv.getContext('2d')!
    this.opts = opts
    this.prm = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    for (let i = 0; i < 320; i++) this.stars.push({ x: rnd(), y: rnd(), z: i % 3, p: rnd() * TAU, r: 0.3 + rnd() * (i % 3 === 2 ? 1.5 : 1) })
    for (let i = 0; i < 70; i++) {
      this.motes.push({ x: rnd(), y: rnd(), vx: (rnd() - 0.5) * 0.00004, vy: -0.00002 - rnd() * 0.00005, r: 0.5 + rnd() * 1.6, c: rnd() < 0.55 ? '103,216,242' : '166,140,247', p: rnd() * TAU })
    }
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(cv)
    this.resize()
    cv.style.touchAction = 'none'
    cv.addEventListener('pointerdown', this.down)
    cv.addEventListener('pointermove', this.move)
    cv.addEventListener('pointerup', this.up)
    cv.addEventListener('pointercancel', this.up)
    cv.addEventListener('pointerleave', this.leave)
    cv.addEventListener('wheel', this.wheel, { passive: false })
    cv.addEventListener('dblclick', this.dbl)
    document.addEventListener('visibilitychange', this.onVis)
    this.loop()
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    document.removeEventListener('visibilitychange', this.onVis)
    const cv = this.cv
    cv.removeEventListener('pointerdown', this.down)
    cv.removeEventListener('pointermove', this.move)
    cv.removeEventListener('pointerup', this.up)
    cv.removeEventListener('pointercancel', this.up)
    cv.removeEventListener('pointerleave', this.leave)
    cv.removeEventListener('wheel', this.wheel)
    cv.removeEventListener('dblclick', this.dbl)
  }

  // ---------- dados ----------

  setScene(nodes: ENode[], links: ELink[]) {
    this.nodes = nodes
    this.links = links
    this.byId = new Map(nodes.map((n) => [n.id, n]))
    this.adj = new Map()
    for (const l of links) {
      if (l.kind === 'sug') continue
      if (!this.adj.has(l.s.id)) this.adj.set(l.s.id, new Set())
      if (!this.adj.has(l.t.id)) this.adj.set(l.t.id, new Set())
      this.adj.get(l.s.id)!.add(l.t.id)
      this.adj.get(l.t.id)!.add(l.s.id)
    }
    this.qt = null
    this.rebuildParticles()
  }

  neighbors(id: string): Set<string> {
    return this.adj.get(id) ?? new Set()
  }

  node(id: string) {
    return this.byId.get(id)
  }

  setSelected(id: string | null) {
    this.selected = id
    this.rebuildParticles()
  }

  private rebuildParticles() {
    this.parts = []
    if (this.prm) return
    const n = Math.min(320, Math.round(this.links.length * 0.45))
    for (let i = 0; i < n; i++) {
      const li = Math.floor(Math.random() * this.links.length)
      if (this.links[li]?.kind === 'sug') continue
      this.parts.push({ li, t: Math.random(), sp: 0.12 + Math.random() * 0.18, sel: false })
    }
    if (this.selected) {
      this.links.forEach((l, li) => {
        if (l.kind === 'sug' || (l.s.id !== this.selected && l.t.id !== this.selected)) return
        for (let k = 0; k < 2; k++) this.parts.push({ li, t: Math.random(), sp: 0.28 + Math.random() * 0.2, sel: true })
      })
    }
  }

  // ---------- câmera ----------

  private resize() {
    const r = this.cv.getBoundingClientRect()
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.w = r.width
    this.h = r.height
    this.cv.width = Math.max(1, Math.round(r.width * this.dpr))
    this.cv.height = Math.max(1, Math.round(r.height * this.dpr))
  }

  toScreen(x: number, y: number) {
    return { x: (x - this.cam.x) * this.cam.k + this.w / 2, y: (y - this.cam.y) * this.cam.k + this.h / 2 }
  }

  toWorld(sx: number, sy: number) {
    return { x: (sx - this.w / 2) / this.cam.k + this.cam.x, y: (sy - this.h / 2) / this.cam.k + this.cam.y }
  }

  flyTo(x: number, y: number, k = this.cam.k, dur = 700) {
    if (this.prm) dur = 0
    this.camTo = { x, y, k, from: { ...this.cam }, t0: performance.now(), dur }
  }

  flyToNode(id: string, k = Math.max(this.cam.k, 1.5)) {
    const n = this.byId.get(id)
    if (n?.x !== undefined && n.y !== undefined) this.flyTo(n.x, n.y, k)
  }

  zoomBy(f: number) {
    const k = Math.max(0.15, Math.min(4, (this.camTo?.k ?? this.cam.k) * f))
    this.flyTo(this.camTo?.x ?? this.cam.x, this.camTo?.y ?? this.cam.y, k, 260)
  }

  // Enquadra as estrelas visíveis. `pad` em px de tela (ex.: painel lateral à direita).
  fit(pad = { l: 40, r: 40, t: 140, b: 60 }, animate = true) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const n of this.nodes) {
      if (this.hidden.has(n.id) || n.x === undefined || n.y === undefined) continue
      x0 = Math.min(x0, n.x)
      y0 = Math.min(y0, n.y)
      x1 = Math.max(x1, n.x)
      y1 = Math.max(y1, n.y)
    }
    if (!isFinite(x0)) return
    const aw = Math.max(80, this.w - pad.l - pad.r)
    const ah = Math.max(80, this.h - pad.t - pad.b)
    const k = Math.max(0.15, Math.min(1.8, Math.min(aw / Math.max(1, x1 - x0 + 120), ah / Math.max(1, y1 - y0 + 120))))
    // centro do retângulo útil, compensando o padding assimétrico
    const cx = (x0 + x1) / 2 - (pad.l - pad.r) / 2 / k
    const cy = (y0 + y1) / 2 - (pad.t - pad.b) / 2 / k
    if (animate) this.flyTo(cx, cy, k)
    else this.cam = { x: cx, y: cy, k }
  }

  // ---------- interação ----------

  // Grade espacial (células de 40 unidades do mundo) para achar a estrela sob o cursor.
  private pick(sx: number, sy: number): ENode | null {
    const CELL = 40
    if (!this.qt || this.qtAge++ > 8) {
      const grid = new Map<string, ENode[]>()
      for (const n of this.nodes) {
        if (this.hidden.has(n.id) || n.x === undefined || n.y === undefined) continue
        const key = `${Math.floor(n.x / CELL)},${Math.floor(n.y / CELL)}`
        const list = grid.get(key)
        if (list) list.push(n)
        else grid.set(key, [n])
      }
      this.qt = grid
      this.qtAge = 0
    }
    const p = this.toWorld(sx, sy)
    const radius = Math.max(14, 22 / this.cam.k)
    const span = Math.ceil(radius / CELL)
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL)
    let best: ENode | null = null
    let bd = radius * radius
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        for (const n of this.qt.get(`${cx + i},${cy + j}`) ?? []) {
          const d = (n.x! - p.x) ** 2 + (n.y! - p.y) ** 2
          if (d <= bd) {
            bd = d
            best = n
          }
        }
      }
    }
    return best
  }

  private local(e: PointerEvent | WheelEvent | MouseEvent) {
    const r = this.cv.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private down = (e: PointerEvent) => {
    const p = this.local(e)
    this.ptrs.set(e.pointerId, p)
    this.cv.setPointerCapture(e.pointerId)
    this.camTo = null
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()]
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: this.cam.k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
      this.drag = null
      return
    }
    const n = this.pick(p.x, p.y)
    if (n) {
      this.drag = { kind: 'node', node: n, sx: p.x, sy: p.y, cx: this.cam.x, cy: this.cam.y, moved: false }
    } else {
      this.drag = { kind: 'pan', sx: p.x, sy: p.y, cx: this.cam.x, cy: this.cam.y, moved: false }
    }
  }

  private move = (e: PointerEvent) => {
    const p = this.local(e)
    if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, p)
    if (this.pinch && this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      this.zoomAt(this.pinch.mx, this.pinch.my, (this.pinch.k * d) / Math.max(1, this.pinch.d))
      return
    }
    const d = this.drag
    if (d) {
      const dx = p.x - d.sx, dy = p.y - d.sy
      if (!d.moved && Math.hypot(dx, dy) > 4) {
        d.moved = true
        if (d.kind === 'node' && d.node) this.opts.onDrag?.(d.node, 'start')
      }
      if (!d.moved) return
      if (d.kind === 'pan') {
        this.cam.x = d.cx - dx / this.cam.k
        this.cam.y = d.cy - dy / this.cam.k
      } else if (d.node) {
        const w = this.toWorld(p.x, p.y)
        d.node.fx = w.x
        d.node.fy = w.y
        d.node.x = w.x
        d.node.y = w.y
        this.qt = null
        this.opts.onDrag?.(d.node, 'move')
      }
      return
    }
    const n = this.pick(p.x, p.y)
    const id = n?.id ?? null
    this.cv.style.cursor = n ? 'pointer' : 'grab'
    if (id !== this.hover) this.hover = id
    this.opts.onHover(id, p.x, p.y)
  }

  private up = (e: PointerEvent) => {
    this.ptrs.delete(e.pointerId)
    if (this.pinch) {
      if (this.ptrs.size < 2) this.pinch = null
      this.drag = null
      return
    }
    const d = this.drag
    this.drag = null
    if (!d) return
    if (d.moved) {
      if (d.kind === 'node' && d.node) this.opts.onDrag?.(d.node, 'end')
      return
    }
    this.opts.onSelect(d.kind === 'node' && d.node ? d.node.id : null)
  }

  private leave = () => {
    if (this.hover) {
      this.hover = null
      this.opts.onHover(null, 0, 0)
    }
  }

  private dbl = (e: MouseEvent) => {
    const p = this.local(e)
    const n = this.pick(p.x, p.y)
    if (n && !n.ghost) this.opts.onOpen(n.id)
  }

  private zoomAt(sx: number, sy: number, k: number) {
    k = Math.max(0.15, Math.min(4, k))
    const before = this.toWorld(sx, sy)
    this.cam.k = k
    const after = this.toWorld(sx, sy)
    this.cam.x += before.x - after.x
    this.cam.y += before.y - after.y
  }

  private wheel = (e: WheelEvent) => {
    e.preventDefault()
    this.camTo = null
    const p = this.local(e)
    this.zoomAt(p.x, p.y, this.cam.k * Math.exp(-e.deltaY * 0.0015))
  }

  // ---------- desenho ----------

  private loop = () => {
    cancelAnimationFrame(this.raf)
    if (this.destroyed || document.hidden) return
    this.raf = requestAnimationFrame((ts) => {
      const dt = this.last ? Math.min(50, ts - this.last) : 16
      this.last = ts
      this.t += dt / 1000
      try {
        this.frame(dt)
      } catch (err) {
        console.warn('brain frame', err)
      }
      this.loop()
    })
  }

  private stepCamera() {
    const c = this.camTo
    if (!c) return
    const u = c.dur ? Math.min(1, (performance.now() - c.t0) / c.dur) : 1
    const e = 1 - Math.pow(1 - u, 3)
    this.cam.x = c.from.x + (c.x - c.from.x) * e
    this.cam.y = c.from.y + (c.y - c.from.y) * e
    this.cam.k = c.from.k + (c.k - c.from.k) * e
    if (u >= 1) this.camTo = null
  }

  private frame(dt: number) {
    this.stepCamera()
    const g = this.g
    const { w, h, cam } = this
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    this.drawSpace(dt)

    // mundo
    g.save()
    g.translate(w / 2, h / 2)
    g.scale(cam.k, cam.k)
    g.translate(-cam.x, -cam.y)
    this.drawNebulae()
    if (this.mode === 'constellation') this.drawRings()
    this.drawLinks()
    this.drawParticles(dt)
    g.restore()

    // estrelas e rótulos em espaço de tela (tamanho legível em qualquer zoom)
    this.drawNodes()
    this.drawMotes(dt)
  }

  private drawSpace(dt: number) {
    const g = this.g
    const { w, h, cam } = this
    for (const s of this.stars) {
      const f = [0.02, 0.05, 0.1][s.z]
      let x = (s.x * w - cam.x * cam.k * f) % w
      let y = (s.y * h - cam.y * cam.k * f) % h
      if (x < 0) x += w
      if (y < 0) y += h
      const tw = this.prm ? 0.6 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.t * (0.6 + s.z * 0.5) + s.p))
      g.fillStyle = `rgba(200,210,255,${(tw * (0.3 + s.z * 0.25)).toFixed(3)})`
      g.beginPath()
      g.arc(x, y, s.r, 0, TAU)
      g.fill()
    }
    if (!this.particles || this.prm) return
    if (!this.shoot && Math.random() < 0.0035) this.shoot = { x: Math.random() * w * 0.7, y: Math.random() * h * 0.45, vx: 0.45 + Math.random() * 0.4, vy: 0.16 + Math.random() * 0.2, l: 0 }
    const s = this.shoot
    if (s) {
      s.l += dt
      const x = s.x + s.vx * s.l, y = s.y + s.vy * s.l
      const gr = g.createLinearGradient(x, y, x - s.vx * 140, y - s.vy * 140)
      gr.addColorStop(0, 'rgba(255,255,255,0.9)')
      gr.addColorStop(1, 'rgba(103,216,242,0)')
      g.strokeStyle = gr
      g.lineWidth = 1.3
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x - s.vx * 140, y - s.vy * 140)
      g.stroke()
      if (s.l > 1500) this.shoot = null
    }
  }

  private drawMotes(dt: number) {
    if (!this.particles || this.prm) return
    const g = this.g
    const { w, h } = this
    for (const m of this.motes) {
      m.x += m.vx * dt
      m.y += m.vy * dt
      if (m.y < -0.02) {
        m.y = 1.02
        m.x = Math.random()
      }
      if (m.x < -0.02) m.x = 1.02
      if (m.x > 1.02) m.x = -0.02
      const a = 0.25 + 0.25 * Math.sin(this.t * 2 + m.p)
      const x = m.x * w, y = m.y * h, R = m.r * 5
      const gr = g.createRadialGradient(x, y, 0, x, y, R)
      gr.addColorStop(0, `rgba(${m.c},${a.toFixed(3)})`)
      gr.addColorStop(1, `rgba(${m.c},0)`)
      g.fillStyle = gr
      g.beginPath()
      g.arc(x, y, R, 0, TAU)
      g.fill()
    }
  }

  private drawNebulae() {
    const g = this.g
    for (const n of this.nebulae) {
      const gr = g.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r)
      gr.addColorStop(0, rgba(n.color, 0.11))
      gr.addColorStop(0.5, rgba(n.color, 0.04))
      gr.addColorStop(1, rgba(n.color, 0))
      g.fillStyle = gr
      g.beginPath()
      g.arc(n.x, n.y, n.r, 0, TAU)
      g.fill()
    }
  }

  private drawRings() {
    const g = this.g
    const c = this.centerId ? this.byId.get(this.centerId) : null
    const cx = c?.x ?? 0, cy = c?.y ?? 0
    const cols = ['rgba(103,216,242,0.30)', 'rgba(166,140,247,0.24)', 'rgba(203,188,255,0.14)']
    g.save()
    g.setLineDash([4, 6])
    g.lineWidth = 1 / this.cam.k
    this.rings.forEach((R, i) => {
      g.strokeStyle = cols[i] ?? cols[2]
      g.beginPath()
      g.ellipse(cx, cy, R, R * K_ELLIPSE, 0, 0, TAU)
      g.stroke()
      g.fillStyle = cols[i] ?? cols[2]
      g.font = `600 ${10 / this.cam.k}px 'JetBrains Mono', monospace`
      g.fillText(`${i + 1}º GRAU`, cx + 6 / this.cam.k, cy - R * K_ELLIPSE - 6 / this.cam.k)
    })
    g.restore()
  }

  private nodeAlpha(n: ENode): number {
    if (this.dimmed.has(n.id)) return 0.12
    if (this.highlight.size && !this.highlight.has(n.id)) return 0.22
    if (this.selected && n.id !== this.selected && !this.neighbors(this.selected).has(n.id) && !this.pathIds.includes(n.id)) return 0.4
    return n.ghost ? 0.55 : 1
  }

  private linkTouches(l: ELink) {
    return !!this.selected && (l.s.id === this.selected || l.t.id === this.selected)
  }

  private onPath(l: ELink) {
    const p = this.pathIds
    if (p.length < 2) return false
    for (let i = 0; i < p.length - 1; i++) if ((p[i] === l.s.id && p[i + 1] === l.t.id) || (p[i] === l.t.id && p[i + 1] === l.s.id)) return true
    return false
  }

  private drawLinks() {
    const g = this.g
    const k = this.cam.k
    // rotas comuns em lote por cor (uma path por cor)
    const batches = new Map<string, ELink[]>()
    const strong: ELink[] = []
    const sug: ELink[] = []
    for (const l of this.links) {
      if (this.hidden.has(l.s.id) || this.hidden.has(l.t.id) || l.s.x === undefined || l.t.x === undefined) continue
      if (l.kind === 'sug') {
        if (this.showSug) sug.push(l)
        continue
      }
      if (this.linkTouches(l) || this.onPath(l) || l.strong) {
        strong.push(l)
        continue
      }
      const key = l.s.color
      if (!batches.has(key)) batches.set(key, [])
      batches.get(key)!.push(l)
    }
    const dimAll = !!this.selected || this.highlight.size > 0
    g.lineWidth = Math.max(0.6, 1 / k)
    for (const [color, list] of batches) {
      g.strokeStyle = rgba(color, dimAll ? 0.12 : 0.3)
      g.beginPath()
      for (const l of list) {
        if (this.dimmed.has(l.s.id) || this.dimmed.has(l.t.id)) continue
        if (l.kind === 'embed') continue
        g.moveTo(l.s.x!, l.s.y!)
        g.lineTo(l.t.x!, l.t.y!)
      }
      g.stroke()
      // embeds: tracejado fino
      g.save()
      g.setLineDash([3 / k, 4 / k])
      g.beginPath()
      for (const l of list) {
        if (l.kind !== 'embed' || this.dimmed.has(l.s.id) || this.dimmed.has(l.t.id)) continue
        g.moveTo(l.s.x!, l.s.y!)
        g.lineTo(l.t.x!, l.t.y!)
      }
      g.stroke()
      g.restore()
    }
    // rotas da estrela selecionada / caminho: gradiente e mais grossas
    g.lineWidth = Math.max(1.2, 1.7 / k)
    for (const l of strong) {
      let c1 = l.s.color, c2 = l.t.color
      if (this.mode === 'constellation' && l.dir) {
        if (l.dir === 'out') c1 = c2 = CYAN
        else if (l.dir === 'in') c1 = c2 = VIOLET
        else {
          c1 = CYAN
          c2 = VIOLET
        }
        if (l.kind === 'tag') c1 = c2 = '#f78cc8'
      }
      const gr = g.createLinearGradient(l.s.x!, l.s.y!, l.t.x!, l.t.y!)
      const a = this.onPath(l) ? 1 : 0.9
      gr.addColorStop(0, rgba(c1, a))
      gr.addColorStop(1, rgba(c2, a * 0.75))
      g.strokeStyle = gr
      g.beginPath()
      g.moveTo(l.s.x!, l.s.y!)
      g.lineTo(l.t.x!, l.t.y!)
      g.stroke()
    }
    // sugestões da Yui: tracejado âmbar andando
    if (sug.length) {
      g.save()
      g.setLineDash([6 / k, 5 / k])
      g.lineDashOffset = this.prm ? 0 : (-this.t * 18) / k
      g.strokeStyle = rgba(AMBER, 0.85)
      g.lineWidth = Math.max(1, 1.4 / k)
      g.beginPath()
      for (const l of sug) {
        g.moveTo(l.s.x!, l.s.y!)
        g.lineTo(l.t.x!, l.t.y!)
      }
      g.stroke()
      g.restore()
    }
  }

  private drawParticles(dt: number) {
    if (!this.particles || this.prm || !this.parts.length) return
    const g = this.g
    const k = this.cam.k
    const dimAll = !!this.selected
    for (const p of this.parts) {
      const l = this.links[p.li]
      if (!l || l.s.x === undefined || l.t.x === undefined || this.hidden.has(l.s.id) || this.hidden.has(l.t.id)) continue
      if (this.dimmed.has(l.s.id) || this.dimmed.has(l.t.id)) continue
      p.t += (p.sp * dt) / 1000
      if (p.t > 1) p.t -= 1
      if (dimAll && !p.sel) continue
      const x = l.s.x + (l.t.x - l.s.x) * p.t
      const y = l.s.y! + (l.t.y! - l.s.y!) * p.t
      const fade = Math.sin(p.t * Math.PI)
      const r = (p.sel ? 3.2 : 2.2) / Math.sqrt(k)
      g.globalAlpha = fade * (p.sel ? 1 : 0.75)
      g.drawImage(glowSprite(l.t.color), x - r * 3, y - r * 3, r * 6, r * 6)
      g.fillStyle = '#ffffff'
      g.beginPath()
      g.arc(x, y, r * 0.45, 0, TAU)
      g.fill()
    }
    g.globalAlpha = 1
  }

  private drawOrb(sx: number, sy: number, R: number) {
    const g = this.g
    const t = this.prm ? 0 : this.t
    const halo = g.createRadialGradient(sx, sy, 0, sx, sy, R * 3.6)
    halo.addColorStop(0, `rgba(103,216,242,${0.38 + 0.08 * Math.sin(t * 1.3)})`)
    halo.addColorStop(0.45, 'rgba(166,140,247,0.16)')
    halo.addColorStop(1, 'rgba(166,140,247,0)')
    g.fillStyle = halo
    g.beginPath()
    g.arc(sx, sy, R * 3.6, 0, TAU)
    g.fill()
    const ring = (rx: number, tilt: number, flat: number, speed: number, col: string, dot: string) => {
      g.save()
      g.translate(sx, sy)
      g.rotate(tilt)
      g.scale(1, flat)
      g.strokeStyle = col
      g.lineWidth = 1 / flat
      g.beginPath()
      g.arc(0, 0, rx, 0, TAU)
      g.stroke()
      const a = t * speed
      g.fillStyle = dot
      g.beginPath()
      g.arc(Math.cos(a) * rx, Math.sin(a) * rx, 3 / flat, 0, TAU)
      g.fill()
      g.restore()
    }
    ring(R * 2.6, -0.31, 0.36, 0.7, 'rgba(103,216,242,0.6)', '#ffffff')
    ring(R * 2.05, 0.49, 0.3, -0.48, 'rgba(166,140,247,0.55)', '#cbbcff')
    const core = g.createRadialGradient(sx - R * 0.25, sy - R * 0.3, 0, sx, sy, R)
    core.addColorStop(0, '#ffffff')
    core.addColorStop(0.34, '#67d8f2')
    core.addColorStop(0.78, 'rgba(166,140,247,0.92)')
    core.addColorStop(1, 'rgba(166,140,247,0.7)')
    g.shadowColor = 'rgba(103,216,242,0.7)'
    g.shadowBlur = 40
    g.fillStyle = core
    g.beginPath()
    g.arc(sx, sy, R, 0, TAU)
    g.fill()
    g.shadowBlur = 0
  }

  private drawNodes() {
    const g = this.g
    const { w, h, cam } = this
    const zoomScale = Math.max(0.55, Math.min(1.6, Math.sqrt(cam.k)))
    const nb = this.selected ? this.neighbors(this.selected) : null
    const labelsQ: { x: number; y: number; text: string; sub?: string; color: string; size: number; bold: boolean; a: number }[] = []
    const t = this.prm ? 0 : this.t
    for (const n of this.nodes) {
      if (this.hidden.has(n.id) || n.x === undefined || n.y === undefined) continue
      const s = this.toScreen(n.x, n.y)
      if (s.x < -60 || s.y < -60 || s.x > w + 60 || s.y > h + 60) continue
      const isSel = n.id === this.selected
      const isCenter = this.mode === 'constellation' && n.id === this.centerId
      const a = this.nodeAlpha(n)
      const r = (n.r + (isSel ? 3 : 0)) * zoomScale
      if (isCenter) {
        this.drawOrb(s.x, s.y, Math.max(22, 30 * zoomScale))
        labelsQ.push({ x: s.x, y: s.y + 44 * zoomScale + 8, text: n.label, sub: n.sub, color: '#ffffff', size: 16, bold: true, a: 1 })
        continue
      }
      g.globalAlpha = a
      // glow
      const halo = r * (n.hub ? 7 : isSel ? 6.5 : 4.5) * (1 + (this.prm ? 0 : 0.08 * Math.sin(t * 1.4 + n.r)))
      const glowColor = n.sug ? AMBER : n.color
      g.drawImage(glowSprite(glowColor), s.x - halo / 2, s.y - halo / 2, halo, halo)
      // anel orbital nas estrelas-hub (como o logo da Yui)
      if ((n.hub || isSel) && !n.ghost) {
        g.save()
        g.translate(s.x, s.y)
        g.rotate(-0.28)
        g.scale(1, 0.36)
        g.strokeStyle = rgba(n.color, 0.5)
        g.lineWidth = 1 / 0.36
        const rr = r * 3.1
        g.beginPath()
        g.arc(0, 0, rr, 0, TAU)
        g.stroke()
        const ang = t * (0.6 + (n.r % 3) * 0.15)
        g.fillStyle = '#ffffff'
        g.beginPath()
        g.arc(Math.cos(ang) * rr, Math.sin(ang) * rr, 2.2 / 0.36, 0, TAU)
        g.fill()
        g.restore()
      }
      if (n.ghost) {
        g.save()
        g.setLineDash([2, 3])
        g.strokeStyle = rgba(GHOST.c, 0.9)
        g.lineWidth = 1
        g.beginPath()
        g.arc(s.x, s.y, r, 0, TAU)
        g.stroke()
        g.restore()
      } else {
        g.drawImage(coreSprite(n.color, n.color2), s.x - r, s.y - r, r * 2, r * 2)
      }
      if (n.sug) {
        g.save()
        g.setLineDash([3, 3])
        g.strokeStyle = rgba(AMBER, 0.9)
        g.beginPath()
        g.arc(s.x, s.y, r + 4, 0, TAU)
        g.stroke()
        g.restore()
      }
      if (isSel) {
        g.save()
        g.translate(s.x, s.y)
        g.rotate(t * 0.45)
        g.setLineDash([3, 4])
        g.strokeStyle = 'rgba(255,255,255,0.4)'
        g.beginPath()
        g.arc(0, 0, r + 22, 0, TAU)
        g.stroke()
        g.setLineDash([])
        g.fillStyle = CYAN
        g.beginPath()
        g.arc(r + 22, 0, 3, 0, TAU)
        g.fill()
        g.fillStyle = VIOLET
        g.beginPath()
        g.arc(-(r + 22) * 0.7, -(r + 22) * 0.7, 2.2, 0, TAU)
        g.fill()
        g.restore()
      }
      if (this.highlight.has(n.id)) {
        g.strokeStyle = 'rgba(255,255,255,0.75)'
        g.lineWidth = 1.2
        g.beginPath()
        g.arc(s.x, s.y, r + 5, 0, TAU)
        g.stroke()
      }
      g.globalAlpha = 1
      const near = nb?.has(n.id) ?? false
      const show =
        this.mode === 'constellation' ||
        isSel ||
        n.hub ||
        near ||
        this.highlight.has(n.id) ||
        n.id === this.hover ||
        this.pathIds.includes(n.id) ||
        (this.labels && cam.k > 1.25)
      if (show && a > 0.2) {
        labelsQ.push({
          x: s.x,
          y: s.y + r + 13,
          text: n.label,
          sub: n.sub,
          color: n.sug ? '#f5c97a' : isSel ? '#ffffff' : n.hub ? '#e8eaf4' : '#b4b9cf',
          size: n.hub || isSel ? 12.5 : 10.5,
          bold: n.hub || isSel,
          a: Math.min(1, a + 0.2),
        })
      }
    }
    g.globalAlpha = 1
    // rótulos por cima de tudo
    g.textAlign = 'center'
    g.shadowColor = '#05060c'
    g.shadowBlur = 8
    let count = 0
    for (const l of labelsQ) {
      if (count++ > 320) break
      g.globalAlpha = l.a
      g.font = `${l.bold ? 700 : 500} ${l.size}px Manrope, system-ui, sans-serif`
      g.fillStyle = l.color
      const text = l.text.length > 42 ? `${l.text.slice(0, 40)}…` : l.text
      g.fillText(text, l.x, l.y)
      if (l.sub) {
        g.font = `500 9.5px 'JetBrains Mono', monospace`
        g.fillStyle = '#8c92ad'
        g.fillText(l.sub, l.x, l.y + 13)
      }
    }
    g.shadowBlur = 0
    g.globalAlpha = 1
    g.textAlign = 'start'
  }
}

