import type { Tone } from '@shared/protocol'

export const C = {
  cyan: '#67d8f2',
  violet: '#a68cf7',
  lav: '#cbbcff',
  ok: '#4fe0b0',
  warn: '#f5b54a',
  crit: '#f06272',
  text: '#e8eaf4',
  t2: '#9aa0bb',
  t3: '#6f7590',
  t4: '#4c5270',
} as const

export function toneColor(t: Tone | undefined, fallback: string = C.text): string {
  switch (t) {
    case 'ok': return C.ok
    case 'warn': return C.warn
    case 'crit': return C.crit
    case 'cyan': return C.cyan
    case 'lav': return C.lav
    case 'muted': return C.t2
    default: return fallback
  }
}

export const glow = (c: string, r = 10) => `0 0 ${r}px ${c}`
