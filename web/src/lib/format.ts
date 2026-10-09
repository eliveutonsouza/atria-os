export function hhmm(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return iso
  const s = Math.max(0, (Date.now() - d) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.floor(s / 60)}min`
  if (s < 86400) return `há ${Math.floor(s / 3600)}h`
  const days = Math.floor(s / 86400)
  return days === 1 ? 'ontem' : `há ${days}d`
}

export function elapsed(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '00:00'
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Bom dia.' : h < 18 ? 'Boa tarde.' : 'Boa noite.'
}

export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** "hoje 09:12", "ontem 16:20" ou "02/10 10:05". */
export function dayTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(new Date()) - day(d)) / 86400_000)
  const prefix = diff === 0 ? 'hoje' : diff === 1 ? 'ontem' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  return `${prefix} ${hhmm(iso)}`
}
