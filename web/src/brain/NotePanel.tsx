import { useEffect, useMemo, useState } from 'react'
import type { VaultBacklink, VaultFile, VaultGraphPayload, VaultSuggestion } from '@shared/protocol'
import { api } from '../api/client'
import { askYui, excerpt, nodeColors, openConstellation, openInEditor } from './data'
import { Star } from './ui'
import { Icon, eyebrow, ghostBtn, glass, mono, primaryBtn } from './styles'

// Painel da estrela selecionada: caminho, trecho, links, backlinks, sugestões da Yui e ações.
export function NotePanel({
  path, graph, sheet, onPick, onSuggestions, onClose,
}: {
  path: string
  graph: VaultGraphPayload
  sheet: boolean
  onPick: (id: string) => void
  onSuggestions: (ids: string[]) => void
  onClose: () => void
}) {
  const node = graph.nodes.find((n) => n.id === path)
  const [file, setFile] = useState<VaultFile | null>(null)
  const [backs, setBacks] = useState<VaultBacklink[]>([])
  const [sugs, setSugs] = useState<VaultSuggestion[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [asked, setAsked] = useState(false)
  const ghost = !!node?.ghost

  useEffect(() => {
    let alive = true
    setFile(null)
    setBacks([])
    setSugs([])
    setAsked(false)
    if (ghost) {
      onSuggestions([])
      return
    }
    const q = encodeURIComponent(path)
    api.get<VaultFile>(`/api/vault/file?path=${q}`).then((f) => alive && setFile(f)).catch(() => {})
    api.get<VaultBacklink[]>(`/api/vault/backlinks?path=${q}`).then((b) => alive && setBacks(b)).catch(() => {})
    api
      .get<VaultSuggestion[]>(`/api/vault/suggest?path=${q}`)
      .then((s) => {
        if (!alive) return
        setSugs(s)
        onSuggestions(s.map((x) => x.id))
      })
      .catch(() => onSuggestions([]))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ghost, graph.at])

  const title = (id: string) => graph.nodes.find((n) => n.id === id)?.title ?? id
  const outs = useMemo(() => graph.links.filter((l) => l.s === path).map((l) => l.t), [graph, path])
  const ins = useMemo(() => graph.links.filter((l) => l.t === path).map((l) => l.s), [graph, path])
  const conn = [...outs.map((id) => ({ id, dir: 'link' })), ...ins.filter((id) => !outs.includes(id)).map((id) => ({ id, dir: 'backlink' }))]

  if (!node) return null
  const col = nodeColors(node)

  const link = async (to: string) => {
    setBusy(to)
    try {
      await api.post('/api/vault/link', { from: path, to })
      setSugs((s) => {
        const next = s.filter((x) => x.id !== to)
        onSuggestions(next.map((x) => x.id))
        return next
      })
    } finally {
      setBusy(null)
    }
  }

  const backSnippet = (id: string) => backs.find((b) => b.path === id)?.snippet

  return (
    <aside
      aria-label="Nota selecionada"
      style={{
        ...glass,
        ...(sheet
          ? { position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: '22px 22px 0 0', maxHeight: '58%', padding: '10px 16px calc(20px + env(safe-area-inset-bottom))' }
          : { position: 'absolute', right: 24, top: 104, bottom: 112, width: 330, padding: 18 }),
        display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden', zIndex: 3,
      }}
    >
      {sheet && <span style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)', flex: 'none' }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Star color={col.c} color2={col.c2} size={sheet ? 30 : 34} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
          <span style={{ ...eyebrow, color: col.c }}>{col.name}</span>
          <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.title}</span>
        </div>
        <button aria-label="Fechar" onClick={onClose} style={{ width: 36, height: 36, flex: 'none', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#9aa0bb', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {Icon.close}
        </button>
      </div>

      <div className="app-scroll brain-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', minHeight: 0, flex: 1 }}>
        {ghost ? (
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#c9cde0' }}>
            Esta estrela ainda não existe: outras notas apontam para <b>[[{node.title}]]</b>, mas o arquivo não foi criado.
          </p>
        ) : (
          <>
            <div style={{ ...mono, fontSize: 11, color: '#8c92ad', padding: '7px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              vault/{path}
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#c9cde0', minHeight: 20 }}>{file ? excerpt(file.text) || 'Nota vazia.' : 'Lendo a nota…'}</p>
            {node.tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {node.tags.slice(0, 8).map((t) => (
                  <span key={t} style={{ height: 22, padding: '0 8px', borderRadius: 11, background: 'rgba(247,140,200,0.1)', color: '#f9a8d6', fontSize: 11, display: 'flex', alignItems: 'center' }}>#{t}</span>
                ))}
              </div>
            )}
          </>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {[
            [outs.length, 'links', '#67d8f2'],
            [ins.length, 'backlinks', '#a68cf7'],
            [sugs.length, 'sugestões', '#f5c97a'],
          ].map(([v, l, c]) => (
            <div key={l as string} style={{ padding: '9px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 20, fontWeight: 300, color: c as string }}>{v}</span>
              <span style={{ fontSize: 11, color: '#9aa0bb' }}>{l}</span>
            </div>
          ))}
        </div>

        {conn.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ ...eyebrow, color: '#8c92ad', fontWeight: 600, marginBottom: 4 }}>Conectada a</span>
            {conn.slice(0, 30).map((c) => {
              const n = graph.nodes.find((x) => x.id === c.id)
              const cc = n ? nodeColors(n).c : '#8c92ad'
              const snip = c.dir === 'backlink' ? backSnippet(c.id) : undefined
              return (
                <button
                  key={`${c.dir}:${c.id}`}
                  className="hov-item"
                  onClick={() => onPick(c.id)}
                  title={snip}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, minHeight: 32, padding: '0 8px', borderRadius: 8, border: 'none', background: 'transparent', color: '#c9cde0', fontSize: 12.5, textAlign: 'left', cursor: 'pointer' }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: cc, boxShadow: `0 0 6px ${cc}`, flex: 'none' }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title(c.id)}</span>
                  <span style={{ ...mono, fontSize: 10, color: c.dir === 'link' ? '#67d8f2' : '#a68cf7' }}>{c.dir}</span>
                </button>
              )
            })}
          </div>
        )}

        {sugs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ ...eyebrow, color: '#f5b54a' }}>Yui sugere ligar</span>
            {sugs.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 34, padding: '0 8px', borderRadius: 8, border: '1px dashed rgba(245,181,74,0.35)', fontSize: 12, color: '#dfe3f3' }}>
                <button onClick={() => onPick(s.id)} title={s.reason} style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                  {s.title}
                </button>
                <button
                  onClick={() => link(s.id)}
                  disabled={busy === s.id}
                  style={{ height: 26, padding: '0 9px', borderRadius: 6, border: 'none', background: 'rgba(245,181,74,0.16)', color: '#f5c97a', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                >
                  {busy === s.id ? '…' : 'ligar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!ghost && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, flex: 'none' }}>
          <button style={{ ...primaryBtn, height: sheet ? 46 : 40 }} onClick={() => openInEditor(path)}>Abrir no editor</button>
          <button style={{ ...ghostBtn, height: sheet ? 46 : 40 }} onClick={() => openConstellation(path)}>Constelação</button>
          <button
            style={{ ...ghostBtn, gridColumn: 'span 2', height: 34, fontSize: 12.5, borderColor: 'rgba(103,216,242,0.2)', color: asked ? '#4fe0b0' : '#a9e9f8' }}
            onClick={() => askYui(node.title).then(() => setAsked(true)).catch(() => {})}
          >
            {asked ? 'A Yui está respondendo…' : 'Perguntar à Yui sobre esta nota'}
          </button>
        </div>
      )}
    </aside>
  )
}
