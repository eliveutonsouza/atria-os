// Port literal do particle engine do design (Yui Console.dc.html: makeParts/initAnim/target/frame).
import type { YuiState } from '@shared/protocol'
import type { Mode } from '../store/yui'
import { useYui } from '../store/yui'
import { getVoiceLevel } from '../voice/audioLevel'

type RGB = [number, number, number]
interface Part { ang: number; rr: number; sp: number; rot: number; flat: number; s: number; hue: number }
interface Star { x: number; y: number; z: number; p: number }
interface Wave { r: number; al: number }
interface Spark { x: number; y: number; vx: number; vy: number; l: number }

// Espaço ocupado embaixo no modo app (barra de abas do celular + safe area, ou o teclado aberto).
let appBottom = 0
export function setOrbAppBottom(px: number) {
  appBottom = px
}

export function orbTarget(mode: Mode, narrow: boolean, w: number, h: number, app = false) {
  // modo app (dashboard): Yui minimizada no canto inferior direito, acima da barra de abas no celular
  if (app) return narrow ? { x: w - 44, y: h - appBottom - 44, r: 18 } : { x: w - 58, y: h - 58, r: 22 }
  if (mode === 'center') {
    const sh = h < 760
    return { x: w / 2, y: sh ? h * 0.24 : h * 0.36, r: sh ? Math.min(56, h * 0.075) : Math.min(76, h * 0.085) }
  }
  if (mode === 'focus') return { x: w - 50, y: h - 50, r: 16 }
  if (narrow) return { x: w - 46, y: h - 128, r: 18 }
  return { x: w * 0.12, y: h * 0.34, r: Math.min(50, w * 0.032) }
}

const PARAMS: Record<YuiState, [number, number]> = {
  idle: [0.55, 1],
  listening: [0.85, 1.2],
  thinking: [1, 2.8],
  delegating: [1, 2.2],
  working: [0.8, 1.6],
  speaking: [0.85, 1.3],
  showing: [0.8, 1.8],
  warning: [0.8, 1],
  success: [1, 1.4],
}

export class OrbEngine {
  private bg: HTMLCanvasElement
  private cv: HTMLCanvasElement
  private w = 0
  private h = 0
  private raf = 0
  private frameErr = false
  private prm = false
  private density: number
  private unsub: () => void
  private a = {
    x: 0, y: 0, r: 60, int: 0.6, spd: 1, t: 0, vx: 0, vy: 0,
    stars: [] as Star[], waves: [] as Wave[], sparks: [] as Spark[], parts: [] as Part[],
    flash: 0, lastWave: 0, col: [103, 216, 242] as RGB, col2: [166, 140, 247] as RGB, init: false,
  }

  constructor(bg: HTMLCanvasElement, cv: HTMLCanvasElement, density = 1) {
    this.bg = bg
    this.cv = cv
    this.density = density
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    this.prm = !!mq?.matches
    for (let i = 0; i < 170; i++) this.a.stars.push({ x: Math.random(), y: Math.random(), z: Math.random(), p: Math.random() * 6.28 })
    this.makeParts()
    let prev = useYui.getState().yst
    this.unsub = useYui.subscribe((s) => {
      if (s.yst !== prev && s.yst === 'success') this.a.flash = 1
      prev = s.yst
    })
    this.resize()
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      try {
        this.frame(dt)
      } catch (e) {
        if (!this.frameErr) {
          this.frameErr = true
          console.warn('yui frame', (e as Error)?.message)
        }
      }
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.unsub()
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.w = this.cv.clientWidth
    this.h = this.cv.clientHeight
    for (const c of [this.cv, this.bg]) {
      c.width = this.w * dpr
      c.height = this.h * dpr
      c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
  }

  private makeParts() {
    const n = Math.round(120 * this.density)
    const parts: Part[] = []
    for (let i = 0; i < n; i++)
      parts.push({
        ang: Math.random() * 6.283,
        rr: 1.2 + Math.random() * 1.6,
        sp: (0.12 + Math.random() * 0.45) * (Math.random() < 0.75 ? 1 : -1),
        rot: (Math.random() - 0.5) * 1.3,
        flat: 0.22 + Math.random() * 0.5,
        s: 0.5 + Math.random() * 1.5,
        hue: Math.random() < 0.6 ? 0 : 1,
      })
    this.a.parts = parts
  }

  private frame(dt: number) {
    const a = this.a, w = this.w, h = this.h
    if (!w) return
    const S = useYui.getState()
    const rm = this.prm, k = rm ? 0.25 : 1
    a.t += dt * k
    const T = orbTarget(S.mode, S.narrow, w, h, S.shellMode === 'app')
    if (!a.init) { a.x = T.x; a.y = T.y; a.r = T.r; a.init = true }
    const e = 1 - Math.exp(-dt * (rm ? 20 : 6))
    // voo até o canto (e de volta) um pouco mais lento e com leve mola: orb "flutua" para o lugar
    const dist = Math.hypot(T.x - a.x, T.y - a.y)
    const ef = dist > 40 && !rm ? 1 - Math.exp(-dt * 4.2) : e
    a.vx = (a.vx ?? 0) * 0.82 + (T.x - a.x) * ef * 0.18
    a.vy = (a.vy ?? 0) * 0.82 + (T.y - a.y) * ef * 0.18
    a.x += (T.x - a.x) * ef + (rm ? 0 : a.vx * 0.35); a.y += (T.y - a.y) * ef + (rm ? 0 : a.vy * 0.35); a.r += (T.r - a.r) * ef
    const st = S.yst
    const P = PARAMS[st] || [0.55, 1]
    a.int += (P[0] - a.int) * e; a.spd += (P[1] - a.spd) * e
    const tc: RGB = st === 'warning' ? [245, 181, 74] : st === 'success' ? [79, 224, 176] : [103, 216, 242]
    for (let i = 0; i < 3; i++) a.col[i] += (tc[i] - a.col[i]) * e
    const rgba = (c: number[], al: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, al)})`
    const R = a.r, t = a.t

    const bg = this.bg.getContext('2d')!
    bg.clearRect(0, 0, w, h)
    const ng = bg.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(w, h) * 0.55)
    ng.addColorStop(0, rgba(a.col2, 0.1 * a.int)); ng.addColorStop(0.4, rgba([40, 60, 140], 0.05)); ng.addColorStop(1, 'rgba(0,0,0,0)')
    bg.fillStyle = ng; bg.fillRect(0, 0, w, h)
    for (const s of a.stars) {
      const x = (((s.x * w + t * 4 * s.z) % w) + w) % w, y = s.y * h
      bg.fillStyle = `rgba(200,210,255,${(0.08 + 0.3 * s.z) * (0.6 + 0.4 * Math.sin(t * 0.8 + s.p))})`
      const sz = 0.4 + s.z * 1.1; bg.fillRect(x, y, sz, sz)
    }

    const c = this.cv.getContext('2d')!
    c.clearRect(0, 0, w, h)
    c.globalCompositeOperation = 'lighter'
    // voiceLevel real (mic/TTS) quando disponível; senão o seno do design
    let v = 0
    const real = getVoiceLevel(st === 'speaking' ? 'remote' : st === 'listening' ? 'local' : null)
    if (real !== null) v = Math.min(1, real * 2.2)
    else if (st === 'listening') v = 0.4 + 0.6 * Math.abs(Math.sin(t * 8.3) * Math.sin(t * 2.1 + 1))
    else if (st === 'speaking') v = Math.abs(Math.sin(t * 6.5)) * 0.8
    const Rc = R * (1 + 0.035 * Math.sin(t * 1.3) + v * 0.08)

    const og = c.createRadialGradient(a.x, a.y, R * 0.2, a.x, a.y, R * 2.8)
    og.addColorStop(0, rgba(a.col, 0.22 * a.int)); og.addColorStop(0.5, rgba(a.col2, 0.07 * a.int)); og.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = og; c.beginPath(); c.arc(a.x, a.y, R * 2.8, 0, 6.283); c.fill()

    c.lineWidth = 1
    for (let i = 0; i < 3; i++) {
      const rr = R * (1.45 + i * 0.3)
      c.strokeStyle = rgba(i === 1 ? a.col2 : a.col, 0.12 + 0.1 * a.int)
      c.beginPath(); c.ellipse(a.x, a.y, rr, rr * (0.3 + 0.1 * i), t * 0.18 * a.spd * (i % 2 ? -1 : 1) + i * 1.1, 0, 6.283); c.stroke()
    }
    c.setLineDash([1.5, 7]); c.lineDashOffset = -t * 18 * a.spd
    c.strokeStyle = rgba(a.col, 0.35 * a.int); c.beginPath(); c.arc(a.x, a.y, R * 1.2, 0, 6.283); c.stroke(); c.setLineDash([])
    if (st === 'thinking' || st === 'delegating') {
      c.lineWidth = 1.5; c.strokeStyle = rgba([255, 255, 255], 0.5)
      for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(a.x, a.y, R * (0.72 + i * 0.12), t * (3 + i) + i * 2, t * (3 + i) + i * 2 + 1.2); c.stroke() }
      c.lineWidth = 1
    }
    for (let i = 0; i < 8; i++) {
      const an = t * 0.12 + i * 0.785, gx = a.x + Math.cos(an) * R * 1.8, gy = a.y + Math.sin(an) * R * 1.8, g = Math.max(1.2, R * 0.03)
      c.fillStyle = rgba(a.col2, 0.45 * a.int)
      c.beginPath(); c.moveTo(gx, gy - g); c.lineTo(gx + g, gy); c.lineTo(gx, gy + g); c.lineTo(gx - g, gy); c.fill()
    }

    const pt: { x: number; y: number; d: number; p: Part }[] = []
    for (const p of a.parts) {
      p.ang += p.sp * dt * a.spd * k * 1.4
      const rr = p.rr * R, ex = Math.cos(p.ang) * rr, ey = Math.sin(p.ang) * rr * p.flat
      const cr = Math.cos(p.rot), sr = Math.sin(p.rot)
      pt.push({ x: a.x + ex * cr - ey * sr, y: a.y + ex * sr + ey * cr, d: Math.sin(p.ang), p })
    }
    const drawP = (q: (typeof pt)[number]) => {
      const al = (0.2 + 0.6 * (q.d * 0.5 + 0.5)) * a.int, sz = q.p.s * Math.max(0.5, R / 70) * (1 + v * 0.5)
      c.fillStyle = rgba(q.p.hue ? a.col2 : a.col, al); c.beginPath(); c.arc(q.x, q.y, sz, 0, 6.283); c.fill()
    }
    pt.forEach((q) => { if (q.d < 0) drawP(q) })

    const cg = c.createRadialGradient(a.x - Rc * 0.22, a.y - Rc * 0.28, Rc * 0.04, a.x, a.y, Rc)
    cg.addColorStop(0, 'rgba(255,255,255,0.95)'); cg.addColorStop(0.28, rgba(a.col, 0.85)); cg.addColorStop(0.7, rgba(a.col2, 0.5)); cg.addColorStop(1, rgba(a.col2, 0))
    c.fillStyle = cg; c.beginPath(); c.arc(a.x, a.y, Rc, 0, 6.283); c.fill()
    c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1
    for (let i = 0; i < 2; i++) { c.beginPath(); c.ellipse(a.x, a.y, Rc * 0.55, Rc * 0.2, t * 0.6 * a.spd + i * 1.57, 0, 6.283); c.stroke() }
    pt.forEach((q) => { if (q.d >= 0) drawP(q) })

    if (st === 'listening' && t - a.lastWave > 0.45 && (real === null || real > 0.03)) { a.waves.push({ r: Rc, al: 0.7 }); a.lastWave = t }
    a.waves = a.waves.filter((wv) => {
      wv.r += dt * R * 1.5; wv.al -= dt * 0.75
      if (wv.al <= 0) return false
      c.strokeStyle = rgba(a.col, wv.al); c.lineWidth = 1.2; c.beginPath(); c.arc(a.x, a.y, wv.r, 0, 6.283); c.stroke()
      return true
    })

    const spawn = st === 'delegating' ? 3 : st === 'working' && Math.random() < 0.08 ? 1 : 0
    for (let i = 0; i < spawn; i++) {
      const an = Math.random() * 6.283, sp = R * (2 + Math.random() * 3)
      a.sparks.push({ x: a.x + Math.cos(an) * R, y: a.y + Math.sin(an) * R, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, l: 1 })
    }
    a.sparks = a.sparks.filter((s) => {
      const px = s.x, py = s.y
      s.x += s.vx * dt; s.y += s.vy * dt; s.l -= dt * 0.9
      if (s.l <= 0) return false
      c.strokeStyle = rgba(a.col, s.l); c.lineWidth = 1.4; c.beginPath(); c.moveTo(px - s.vx * 0.04, py - s.vy * 0.04); c.lineTo(s.x, s.y); c.stroke()
      return true
    })

    const n = Math.min(12, S.agentsWorking)
    const ac: RGB[] = [[103, 216, 242], [203, 188, 255], [79, 224, 176], [166, 140, 247], [245, 181, 74]]
    for (let i = 0; i < n; i++) {
      const an = t * 0.35 * a.spd + i * (6.283 / n), ax = a.x + Math.cos(an) * R * 2.2, ay = a.y + Math.sin(an) * R * 2.2 * 0.42
      c.fillStyle = rgba(ac[i % 5], 0.95); c.beginPath(); c.arc(ax, ay, Math.max(1.6, R * 0.045), 0, 6.283); c.fill()
      c.fillStyle = rgba(ac[i % 5], 0.15); c.beginPath(); c.arc(ax, ay, Math.max(4, R * 0.12), 0, 6.283); c.fill()
    }
    if (a.flash > 0) {
      c.strokeStyle = rgba([79, 224, 176], a.flash); c.lineWidth = 2
      c.beginPath(); c.arc(a.x, a.y, R * (1.15 + (1 - a.flash) * 1.5), 0, 6.283); c.stroke()
      a.flash -= dt * 1.1
    }
    c.globalCompositeOperation = 'source-over'
  }
}
