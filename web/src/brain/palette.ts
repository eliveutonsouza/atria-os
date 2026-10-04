// Paleta do Cérebro: cada pasta de topo do vault é uma galáxia com cor própria.

export type RGB = [number, number, number]

const GALAXY: Record<string, { c: string; c2: string; name: string }> = {
  '01-projeto': { c: '#67d8f2', c2: '#2f6fd0', name: 'Projeto' },
  '02-decisoes': { c: '#f5b54a', c2: '#b8681a', name: 'Decisões' },
  '03-agentes': { c: '#a68cf7', c2: '#5b3fc4', name: 'Agentes' },
  '04-execucoes': { c: '#4fe0b0', c2: '#178a69', name: 'Execuções' },
  '05-projetos': { c: '#cbbcff', c2: '#7a66d6', name: 'Projetos' },
  '06-ideias': { c: '#f78cc8', c2: '#b4448a', name: 'Ideias' },
  diario: { c: '#dfe3f3', c2: '#6c7399', name: 'Diário' },
  '00-inbox': { c: '#8c92ad', c2: '#4c5270', name: 'Inbox' },
}
const OTHER = { c: '#8c92ad', c2: '#4c5270' }

const key = (folder: string) => folder.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function galaxy(folder: string): { c: string; c2: string; name: string } {
  const g = GALAXY[key(folder)]
  if (g) return g
  return { ...OTHER, name: folder ? folder.replace(/^\d+[-\s·]*/, '') : 'Raiz' }
}

export const GHOST = { c: '#6f7590', c2: '#2a2e45' }
export const AMBER = '#f5b54a'
export const CYAN = '#67d8f2'
export const VIOLET = '#a68cf7'

export function hexRgb(h: string): RGB {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgba(h: string, a: number): string {
  const [r, g, b] = hexRgb(h)
  return `rgba(${r},${g},${b},${a})`
}

// Sprites pré-renderizados (glow e núcleo) por cor: drawImage é muito mais barato que gradiente por estrela.
const glowCache = new Map<string, HTMLCanvasElement>()
const coreCache = new Map<string, HTMLCanvasElement>()
export const SPRITE = 64

function mk(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = SPRITE
  return [c, c.getContext('2d')!]
}

export function glowSprite(color: string): HTMLCanvasElement {
  let s = glowCache.get(color)
  if (s) return s
  const [c, g] = mk()
  const h = SPRITE / 2
  const gr = g.createRadialGradient(h, h, 0, h, h, h)
  gr.addColorStop(0, rgba(color, 0.55))
  gr.addColorStop(0.35, rgba(color, 0.18))
  gr.addColorStop(1, rgba(color, 0))
  g.fillStyle = gr
  g.fillRect(0, 0, SPRITE, SPRITE)
  glowCache.set(color, c)
  s = c
  return s
}

export function coreSprite(color: string, color2: string): HTMLCanvasElement {
  const k = `${color}|${color2}`
  const hit = coreCache.get(k)
  if (hit) return hit
  const [c, g] = mk()
  const h = SPRITE / 2
  const gr = g.createRadialGradient(h * 0.72, h * 0.64, 0, h, h, h)
  gr.addColorStop(0, '#ffffff')
  gr.addColorStop(0.4, color)
  gr.addColorStop(1, color2)
  g.fillStyle = gr
  g.beginPath()
  g.arc(h, h, h - 1, 0, Math.PI * 2)
  g.fill()
  coreCache.set(k, c)
  return c
}
