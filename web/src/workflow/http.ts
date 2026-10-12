import { useYui } from '../store/yui'

// PUT/DELETE simples para a API de workflows/rotinas (o cliente compartilhado só tem get/post/del).
export async function send<T = unknown>(method: 'PUT' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    useYui.getState().set({ authed: false })
    throw new Error('unauthorized')
  }
  const txt = await res.text()
  const data = txt ? JSON.parse(txt) : undefined
  if (!res.ok) throw new Error((data as { error?: string } | undefined)?.error ?? res.statusText)
  return data as T
}

export const CRON_PRESETS: { label: string; cron: string | null }[] = [
  { label: 'Manual', cron: null },
  { label: 'Todo dia 8h', cron: '0 8 * * *' },
  { label: 'Dias úteis 8h', cron: '0 8 * * 1-5' },
  { label: 'Toda segunda 9h', cron: '0 9 * * 1' },
  { label: 'Toda sexta 17h', cron: '0 17 * * 5' },
  { label: 'A cada hora', cron: '0 * * * *' },
  { label: 'Dia 1 do mês 9h', cron: '0 9 1 * *' },
]

const DOW = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

// Texto amigável para um cron simples ("toda segunda às 09:00"); cai para o próprio cron.
export function describeCron(cron: string | null | undefined): string {
  if (!cron) return 'manual'
  const preset = CRON_PRESETS.find((p) => p.cron === cron)
  if (preset) return preset.label.toLowerCase()
  const f = cron.trim().split(/\s+/)
  if (f.length !== 5) return cron
  const [min, hour, dom, mon, dow] = f
  const num = (v: string) => /^\d+$/.test(v)
  if (mon !== '*') return cron
  const every = /^\*\/(\d+)$/
  if (every.test(min) && hour === '*' && dom === '*' && dow === '*') return `a cada ${every.exec(min)![1]} minutos`
  if (num(min) && hour === '*' && dom === '*' && dow === '*') return Number(min) ? `a cada hora (aos ${min} min)` : 'a cada hora'
  if (num(min) && every.test(hour) && dom === '*' && dow === '*') return `a cada ${every.exec(hour)![1]} horas`
  if (!num(min) || !num(hour)) return cron
  const hh = `${Number(hour)}h${Number(min) ? String(min).padStart(2, '0') : ''}`
  if (num(dom) && dow === '*') return `todo dia ${dom} do mês às ${hh}`
  if (dom !== '*') return cron
  if (dow === '*') return `todo dia às ${hh}`
  if (dow === '1-5') return `dias úteis às ${hh}`
  if (dow === '0,6' || dow === '6,0') return `fins de semana às ${hh}`
  if (/^[0-7](,[0-7])*$/.test(dow)) {
    const days = dow.split(',').map((d) => DOW[Number(d) % 7])
    return days.length === 1 ? `toda ${days[0]} às ${hh}` : `${days.slice(0, -1).join(', ')} e ${days.at(-1)} às ${hh}`
  }
  return cron
}

/** Cron em português; se não der para traduzir, "horário personalizado" (mostre o cron só no title). */
export function friendlyCron(cron: string | null | undefined): string {
  const d = describeCron(cron)
  return cron && d === cron ? 'horário personalizado' : d
}

export function hhmm(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(Date.now() + 86400_000)
  if (d.toDateString() === today.toDateString()) return `hoje ${hhmm(iso)}`
  if (d.toDateString() === tomorrow.toDateString()) return `amanhã ${hhmm(iso)}`
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })} ${hhmm(iso)}`
}
