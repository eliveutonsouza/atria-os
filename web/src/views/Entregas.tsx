import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'

// Entregas dos agentes com pré-visualização (canvas Atria — Entregas e comparação, pranchas 1 e 3):
// lista com filtros à esquerda, arquivo aberto à direita; no celular, a entrega abre em tela cheia.

export interface Entrega {
  id: string; title: string; kind: string; project: string | null; path: string; runId: string | null; size: number; pinned: boolean; createdAt: string
  mime: string | null; agent: string | null; task: string | null
}

type Filter = 'all' | 'doc' | 'image' | 'table' | 'pinned'
const FILTERS: [Filter, string][] = [['all', 'Todos'], ['doc', 'Documentos'], ['image', 'Imagens'], ['table', 'Planilhas'], ['pinned', 'Fixados']]

const ext = (e: Entrega) => (e.path.split('.').pop() ?? '').toLowerCase()
const isImage = (e: Entrega) => (e.mime ?? '').startsWith('image/')
const isTable = (e: Entrega) => ['csv', 'xlsx', 'xls'].includes(ext(e))
const category = (e: Entrega): Filter => (isImage(e) ? 'image' : isTable(e) ? 'table' : 'doc')
const fileUrl = (e: Entrega, download = false) => `/api/entregas/${e.id}/file${download ? '?download=1' : ''}`
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date(Date.now() - 86400_000)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  return same(d, today) ? 'HOJE' : same(d, y) ? 'ONTEM' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).toUpperCase()
}
const BADGE: Record<string, [string, string]> = { pdf: ['#f39aa4', 'rgba(240,98,114,.15)'], md: ['#cbbcff', 'rgba(166,140,247,.15)'], csv: ['#4fe0b0', 'rgba(79,224,176,.15)'], xlsx: ['#4fe0b0', 'rgba(79,224,176,.15)'], json: ['#a9e9f8', 'rgba(103,216,242,.12)'], html: ['#a9e9f8', 'rgba(103,216,242,.12)'] }

function Thumb({ e }: { e: Entrega }) {
  if (isImage(e)) return <img src={fileUrl(e)} alt="" loading="lazy" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0, background: 'rgba(255,255,255,.05)' }} />
  const [fg, bg] = BADGE[ext(e)] ?? ['#c9cde0', 'rgba(255,255,255,.06)']
  return <span aria-hidden style={{ width: 44, height: 44, borderRadius: 8, background: bg, color: fg, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, textTransform: 'uppercase' }}>{ext(e).slice(0, 4) || 'ARQ'}</span>
}

// CSV simples (vírgula ou ponto e vírgula, aspas básicas): só para mostrar as primeiras linhas.
function parseCsv(text: string): string[][] {
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  return text.split(/\r?\n/).filter(Boolean).slice(0, 101).map((line) => {
    const out: string[] = []
    let cur = ''
    let q = false
    for (const ch of line) {
      if (ch === '"') q = !q
      else if (ch === sep && !q) {
        out.push(cur)
        cur = ''
      } else cur += ch
    }
    out.push(cur)
    return out
  })
}

function Preview({ e }: { e: Entrega }) {
  const x = ext(e)
  const textual = ['md', 'txt', 'json', 'csv', 'log', 'yml', 'yaml'].includes(x) || (e.mime ?? '').startsWith('text/')
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    setText(null)
    if (!textual || e.size > 400_000 || x === 'html') return
    fetch(fileUrl(e), { credentials: 'same-origin' }).then((r) => r.text()).then(setText).catch(() => setText(''))
  }, [e.id, textual, e.size, x])
  const frame = { width: '100%', height: '100%', minHeight: 420, border: 'none', borderRadius: 6, background: '#fff' } as const
  if (isImage(e)) return <img src={fileUrl(e)} alt={e.title} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4, boxShadow: '0 10px 30px rgba(0,0,0,.4)' }} />
  if (x === 'pdf') return <iframe title={e.title} src={fileUrl(e)} style={frame} />
  if (x === 'html') return <iframe title={e.title} src={fileUrl(e)} sandbox="" style={frame} />
  if ((e.mime ?? '').startsWith('audio/')) return <audio controls src={fileUrl(e)} style={{ width: '100%' }} />
  if ((e.mime ?? '').startsWith('video/')) return <video controls src={fileUrl(e)} style={{ maxWidth: '100%', maxHeight: '100%' }} />
  if (textual && e.size <= 400_000) {
    if (text === null) return <span style={{ color: C.t3, fontSize: 13 }}>Carregando…</span>
    if (x === 'csv') {
      const rows = parseCsv(text)
      return (
        <div style={{ width: '100%', overflow: 'auto', alignSelf: 'stretch' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12.5, color: '#d6d9e8' }}>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ background: i === 0 ? 'rgba(255,255,255,.06)' : undefined, fontWeight: i === 0 ? 600 : 400 }}>
                  {r.map((c, j) => <td key={j} style={{ padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,.06)', whiteSpace: 'nowrap' }}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    return <pre style={{ margin: 0, alignSelf: 'stretch', width: '100%', boxSizing: 'border-box', padding: 18, borderRadius: 8, background: 'rgba(0,0,0,.35)', font: "13px/1.65 'JetBrains Mono', monospace", color: '#d6d9e8', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflow: 'auto' }}>{text}</pre>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: C.t2, fontSize: 13, textAlign: 'center' }}>
      <Thumb e={e} />
      Sem pré-visualização para .{x}. Baixe para abrir.
    </div>
  )
}

export function Entregas() {
  const phone = useYui((s) => s.device === 'phone')
  const { data, reload } = useApi<Entrega[]>('/api/entregas?limit=200')
  const [filter, setFilter] = useState<Filter>('all')
  const [project, setProject] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const list = useMemo(() => data ?? [], [data])
  const projects = useMemo(() => [...new Set(list.map((e) => e.project ?? ''))].sort(), [list])
  const shown = list.filter((e) => (filter === 'all' || (filter === 'pinned' ? e.pinned : category(e) === filter)) && (!project || (e.project ?? '') === project) && (!q || `${e.title} ${e.agent ?? ''} ${e.task ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const current = list.find((e) => e.id === sel) ?? (phone ? null : shown[0] ?? null)
  if (!list.length) return null

  const send = (e: Entrega) =>
    api.post(`/api/entregas/${e.id}/send`, { channels: ['telegram'] })
      .then(() => useYui.getState().say(`Mandei ${e.title} no Telegram.`))
      .catch((err: Error) => useYui.getState().say(`Não consegui mandar: ${err.message}`))
  const pin = (e: Entrega) => api.post(`/api/entregas/${e.id}/pin`, { pinned: !e.pinned }).then(reload).catch(() => {})
  const h = phone ? 48 : 38
  const ghost = { height: h, padding: '0 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: '#dfe3f3', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' } as const
  const primary = { ...ghost, border: 'none', background: C.cyan, color: '#06221c', fontWeight: 700 } as const
  const chip = (on: boolean) => ({ height: 34, padding: '0 12px', borderRadius: 9, border: `1px solid ${on ? 'rgba(103,216,242,.4)' : 'rgba(255,255,255,.1)'}`, background: on ? 'rgba(103,216,242,.1)' : 'transparent', color: on ? '#a9e9f8' : '#c9cde0', fontSize: 13, fontWeight: on ? 600 : 500, cursor: 'pointer' }) as const
  const actions = (e: Entrega) => [
    <button key="pin" style={ghost} aria-pressed={e.pinned} onClick={() => void pin(e)}>{e.pinned ? 'Soltar' : 'Fixar'}</button>,
    ...(e.runId ? [<button key="run" style={ghost} onClick={() => useYui.getState().show('runs', { runId: e.runId! })}>Execução</button>] : []),
    <a key="dl" style={ghost} href={fileUrl(e, true)}>Baixar</a>,
  ]

  // celular: entrega aberta em tela cheia (prancha 3)
  if (phone && current)
    return (
      <section aria-label={current.title} style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: '70dvh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button aria-label="Voltar" onClick={() => setSel(null)} style={{ ...ghost, width: 44, padding: 0, fontSize: 18 }}>‹</button>
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.title}</span>
            <span style={{ fontSize: 12, color: C.t2 }}>{current.agent ?? 'Agente'} · {kb(current.size)} · {dayLabel(current.createdAt).toLowerCase()} {hhmm(current.createdAt)}</span>
          </span>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 12, borderRadius: 12, background: 'rgba(0,0,0,.25)', minHeight: 360 }}>
          <Preview e={current} />
        </div>
        <button style={{ ...primary, height: 52, fontSize: 15 }} onClick={() => void send(current)}>Mandar no Telegram</button>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${actions(current).length},minmax(0,1fr))`, gap: 8 }}>{actions(current)}</div>
      </section>
    )

  let lastDay = ''
  return (
    <section aria-label="Entregas dos agentes" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: phone ? 17 : 20, fontWeight: 600 }}>Entregas dos agentes</span>
        <span style={{ fontSize: 13, color: C.t3 }}>{list.length} arquivos · {list.filter((e) => e.pinned).length} fixados</span>
        <span style={{ flex: 1 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar entregas…" aria-label="Buscar entregas" style={{ height: 38, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.03)', color: C.text, fontSize: 13, width: phone ? '100%' : 260 }} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map(([f, label]) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} style={chip(filter === f)}>{label}</button>)}
        {projects.length > 1 && (
          <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Projeto" style={{ ...chip(!!project), appearance: 'auto' }}>
            <option value="">Projeto: todos</option>
            {projects.map((p) => <option key={p} value={p}>{p || 'Geral'}</option>)}
          </select>
        )}
      </div>
      <div style={{ display: 'flex', gap: 20, alignItems: 'stretch', minHeight: phone ? undefined : 520 }}>
        <div role="list" style={{ width: phone ? '100%' : 420, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: phone ? undefined : 640, overflowY: phone ? undefined : 'auto' }}>
          {!shown.length && <span style={{ fontSize: 13, color: C.t3, padding: 8 }}>Nada com esse filtro.</span>}
          {shown.map((e) => {
            const day = dayLabel(e.createdAt)
            const head = day !== lastDay
            lastDay = day
            const on = current?.id === e.id
            return (
              <div key={e.id} role="listitem" style={{ display: 'flex', flexDirection: 'column' }}>
                {head && <span style={{ fontSize: 11, letterSpacing: '.14em', color: C.t3, fontWeight: 700, padding: '10px 2px 6px' }}>{day}</span>}
                <button onClick={() => setSel(e.id)} aria-current={on} style={{ textAlign: 'left', display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', minHeight: 44, borderRadius: 12, border: `1px solid ${on ? 'rgba(103,216,242,.35)' : 'transparent'}`, background: on ? 'rgba(103,216,242,.06)' : 'transparent', color: C.text, cursor: 'pointer' }}>
                  <Thumb e={e} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: on ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.pinned ? '📌 ' : ''}{e.title}</span>
                    <span style={{ fontSize: 12, color: C.t2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.agent ?? 'Agente'} · {e.project ?? 'Geral'} · {kb(e.size)} · {hhmm(e.createdAt)}</span>
                  </span>
                </button>
              </div>
            )
          })}
        </div>
        {!phone && current && (
          <section aria-label="Pré-visualização" style={{ flex: 1, minWidth: 0, borderRadius: 16, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.02)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.06)', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 200px', minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>{current.title}</span>
                <span style={{ fontSize: 12, color: C.t2 }}>{current.agent ? `Gerado pelo ${current.agent}` : 'Arquivo'}{current.task ? ` na execução “${current.task}”` : ''} · {kb(current.size)}</span>
              </span>
              {actions(current)}
              <button style={primary} onClick={() => void send(current)}>Mandar no Telegram</button>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, background: 'rgba(0,0,0,.25)', minHeight: 0, overflow: 'auto' }}>
              <Preview e={current} />
            </div>
          </section>
        )}
      </div>
    </section>
  )
}
