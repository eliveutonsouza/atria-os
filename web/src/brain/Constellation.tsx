import { useEffect, useMemo, useRef, useState } from 'react'
import type { VaultFile, VaultGraphPayload, VaultRing, VaultSuggestion } from '@shared/protocol'
import { api } from '../api/client'
import { useYui } from '../store/yui'
import { BrainEngine, type ELink, type ENode } from './brainEngine'
import { excerpt, nodeColors, openConstellation, openInEditor } from './data'
import { AMBER, rgba } from './palette'
import { IconBtn } from './ui'
import { Icon, SPACE_BG, eyebrow, ghostBtn, glass, mono, primaryBtn } from './styles'

const RADII = [0, 190, 330, 460]
const K = 0.78
const DIR_LABEL = { out: 'link', in: 'backlink', both: 'link mútuo' } as const

// Constelação: a nota no centro (orb da Yui), vizinhos em anéis de 1º, 2º e 3º grau, sugestões em âmbar.
export function Constellation({ path, graph }: { path: string; graph: VaultGraphPayload }) {
  const narrow = useYui((s) => s.narrow)
  const set = useYui((s) => s.set)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const engRef = useRef<BrainEngine | null>(null)
  const [depth, setDepth] = useState(2)
  const [rings, setRings] = useState<VaultRing[] | null>(null)
  const [sugs, setSugs] = useState<VaultSuggestion[]>([])
  const [file, setFile] = useState<VaultFile | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [target, setTarget] = useState('')
  const [route, setRoute] = useState<string[] | null>(null)
  const [routeMsg, setRouteMsg] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])
  const center = byId.get(path)
  const title = (id: string) => byId.get(id)?.title ?? id.replace(/^ghost:/, '')

  useEffect(() => {
    let alive = true
    const q = encodeURIComponent(path)
    setErr(null)
    api.get<VaultRing[]>(`/api/vault/rings?path=${q}&depth=${depth}`).then((r) => alive && setRings(r)).catch((e: Error) => alive && setErr(e.message))
    return () => {
      alive = false
    }
  }, [path, depth, graph.at])

  useEffect(() => {
    let alive = true
    const q = encodeURIComponent(path)
    setFile(null)
    setRoute(null)
    setRouteMsg(null)
    api.get<VaultFile>(`/api/vault/file?path=${q}`).then((f) => alive && setFile(f)).catch(() => {})
    api.get<VaultSuggestion[]>(`/api/vault/suggest?path=${q}`).then((s) => alive && setSugs(s.slice(0, 4))).catch(() => {})
    return () => {
      alive = false
    }
  }, [path, graph.at])

  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return
    const eng = new BrainEngine(cv, {
      onSelect: (id) => {
        if (id && id !== path && !id.startsWith('ghost:')) openConstellation(id)
      },
      onHover: () => {},
      onOpen: (id) => openInEditor(id),
    })
    eng.mode = 'constellation'
    engRef.current = eng
    return () => {
      eng.destroy()
      engRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // layout radial determinístico
  useEffect(() => {
    const eng = engRef.current
    if (!eng || !rings) return
    const nodes = new Map<string, ENode>()
    const angle = new Map<string, number>()
    const mk = (id: string, ring: number, sub?: string): ENode => {
      const n = byId.get(id)
      const c = nodeColors({ folder: n?.folder ?? '', ghost: n?.ghost ?? id.startsWith('ghost:') })
      return { id, label: title(id), sub, color: c.c, color2: c.c2, r: ring === 0 ? 14 : ring === 1 ? 7 : 4.5, hub: false, ghost: n?.ghost, galaxy: n?.folder ?? '' }
    }
    const c = mk(path, 0)
    c.x = 0
    c.y = 0
    nodes.set(path, c)
    angle.set(path, -Math.PI / 2)
    const links: ELink[] = []
    for (let r = 1; r <= depth; r++) {
      const list = rings.filter((x) => x.ring === r)
      if (r === 1) {
        list.forEach((x, i) => {
          const a = -Math.PI / 2 + (i / Math.max(1, list.length)) * Math.PI * 2
          angle.set(x.id, a)
        })
      } else {
        const byParent = new Map<string, VaultRing[]>()
        for (const x of list) byParent.set(x.via ?? path, [...(byParent.get(x.via ?? path) ?? []), x])
        const prevCount = Math.max(1, rings.filter((x) => x.ring === r - 1).length)
        const sector = (Math.PI * 2) / prevCount
        for (const [p, kids] of byParent) {
          const base = angle.get(p) ?? 0
          const step = Math.min(0.32, (sector * 0.9) / Math.max(1, kids.length))
          kids.forEach((x, i) => angle.set(x.id, base + (i - (kids.length - 1) / 2) * step))
        }
      }
      for (const x of list) {
        const a = angle.get(x.id)!
        const n = mk(x.id, r, r === 1 ? (x.dir ? DIR_LABEL[x.dir] : undefined) : `${r}º grau`)
        n.x = Math.cos(a) * RADII[r]
        n.y = Math.sin(a) * RADII[r] * K
        nodes.set(x.id, n)
        const via = nodes.get(x.via ?? path)
        if (via) links.push({ s: via, t: n, kind: 'link', dir: x.dir ?? 'out', strong: r === 1 })
      }
    }
    // notas sugeridas: fora do último anel, do lado direito
    const outer = RADII[depth] + 120
    sugs.forEach((s, i) => {
      if (nodes.has(s.id)) return
      const a = -0.55 + (i / Math.max(1, sugs.length - 1 || 1)) * 1.1
      const n = mk(s.id, 2, 'sugerida')
      n.sug = true
      n.x = Math.cos(a) * outer
      n.y = Math.sin(a) * outer * K
      nodes.set(s.id, n)
      links.push({ s: c, t: n, kind: 'sug' })
    })
    eng.centerId = path
    eng.rings = RADII.slice(1, depth + 1)
    eng.nebulae = [{ x: 0, y: 0, r: RADII[depth] * 1.2, color: '#67d8f2' }, { x: 40, y: 0, r: RADII[depth] * 1.5, color: '#a68cf7' }]
    eng.setScene([...nodes.values()], links)
    eng.setSelected(path)
    eng.fit(narrow ? { l: 12, r: 12, t: 150, b: 120 } : { l: 380, r: 40, t: 110, b: 90 }, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rings, sugs, depth, path, narrow])

  useEffect(() => {
    if (engRef.current) engRef.current.pathIds = route ?? []
  }, [route])

  const findRoute = async (toTitle: string) => {
    const t = toTitle.trim().toLowerCase()
    const hit = graph.nodes.find((n) => !n.ghost && n.title.toLowerCase() === t) ?? graph.nodes.find((n) => !n.ghost && n.title.toLowerCase().includes(t))
    if (!hit) return setRouteMsg('Nenhuma nota com esse nome.')
    const r = await api.get<{ path: string[] | null }>(`/api/vault/path?from=${encodeURIComponent(path)}&to=${encodeURIComponent(hit.id)}`).catch(() => ({ path: null }))
    if (!r.path) {
      setRoute(null)
      setRouteMsg(`Sem caminho até "${hit.title}" — são universos separados.`)
    } else {
      setRoute(r.path)
      setRouteMsg(null)
    }
  }

  const linkAll = async () => {
    setLinking(true)
    try {
      for (const s of sugs) await api.post('/api/vault/link', { from: path, to: s.id })
      setSugs([])
    } finally {
      setLinking(false)
    }
  }
  const linkOne = async (id: string) => {
    await api.post('/api/vault/link', { from: path, to: id }).catch(() => {})
    setSugs((s) => s.filter((x) => x.id !== id))
  }

  const ring1 = rings?.filter((r) => r.ring === 1).length ?? 0
  const ins = graph.links.filter((l) => l.t === path).length
  const outs = graph.links.filter((l) => l.s === path).length
  const col = center ? nodeColors(center) : nodeColors({ folder: '', ghost: false })
  if (engRef.current && center) {
    const c = engRef.current.node(path)
    if (c) c.sub = `${col.name} · ${outs} links · ${ins} backlinks`
  }
  const titles = useMemo(() => graph.nodes.filter((n) => !n.ghost && n.id !== path).map((n) => n.title).sort((a, b) => a.localeCompare(b, 'pt-BR')), [graph, path])

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: SPACE_BG, zIndex: 2 }}>
      <canvas ref={cvRef} aria-label={`Constelação da nota ${center?.title ?? ''}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'grab' }} />

      <header style={{ position: 'absolute', left: 0, right: 0, top: 0, padding: narrow ? 'calc(12px + env(safe-area-inset-top)) 14px 0' : '20px 28px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', pointerEvents: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, pointerEvents: 'auto', minWidth: 0 }}>
          {narrow && (
            <IconBtn label="Abrir menu" size={44} onClick={() => set({ sidebarOpen: true })}>
              {Icon.menu}
            </IconBtn>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <nav aria-label="Trilha" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#9aa0bb', minWidth: 0 }}>
              <button onClick={() => openConstellation(null)} style={{ border: 'none', background: 'transparent', padding: 0, color: '#7fdcf5', fontSize: 12, cursor: 'pointer' }}>Cérebro</button>
              <span>›</span>
              <span>{center?.folder || 'raiz'}</span>
              <span>›</span>
              <span style={{ color: '#e8eaf4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{center?.title ?? path}</span>
            </nav>
            <h1 style={{ margin: 0, fontSize: narrow ? 20 : 24, fontWeight: 600 }}>Constelação</h1>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'auto', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#9aa0bb' }}>Profundidade</span>
          <div role="group" aria-label="Profundidade" style={{ display: 'flex', padding: 3, borderRadius: 11, background: 'rgba(10,12,29,0.7)', border: '1px solid rgba(160,170,255,0.14)' }}>
            {[1, 2, 3].map((d) => (
              <button
                key={d}
                aria-pressed={depth === d}
                onClick={() => setDepth(d)}
                style={{ width: narrow ? 44 : 40, height: narrow ? 38 : 30, borderRadius: 8, border: 'none', background: depth === d ? 'rgba(103,216,242,0.16)' : 'transparent', color: depth === d ? '#fff' : '#9aa0bb', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                {d}
              </button>
            ))}
          </div>
          <button style={{ ...ghostBtn, height: narrow ? 44 : 36 }} onClick={() => openConstellation(null)}>Voltar ao universo</button>
          {!narrow && <button style={{ ...primaryBtn, height: 36 }} onClick={() => openInEditor(path)}>Abrir no editor</button>}
        </div>
      </header>

      {err && <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', color: '#f39aa4', fontSize: 14 }}>Não consegui abrir esta nota: {err}</div>}

      {/* prévia, insight da Yui e legenda */}
      <aside
        aria-label="Prévia da nota"
        className="app-scroll"
        style={
          narrow
            ? { position: 'absolute', left: 12, right: 12, bottom: 'calc(12px + env(safe-area-inset-bottom))', maxHeight: '34%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, zIndex: 3 }
            : { position: 'absolute', left: 24, top: 104, width: 330, bottom: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, zIndex: 3 }
        }
      >
        <div style={{ ...glass, borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ ...eyebrow, color: col.c }}>Prévia</span>
          <span style={{ fontSize: 18, fontWeight: 700 }}>{center?.title ?? path}</span>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#c9cde0' }}>{file ? excerpt(file.text, 320) || 'Nota vazia.' : center?.ghost ? 'Nota ainda não criada.' : 'Lendo…'}</p>
          {center && center.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {center.tags.slice(0, 6).map((t) => (
                <span key={t} style={{ height: 22, padding: '0 8px', borderRadius: 11, background: 'rgba(247,140,200,0.1)', color: '#f9a8d6', fontSize: 11, display: 'flex', alignItems: 'center' }}>#{t}</span>
              ))}
            </div>
          )}
          <div style={{ ...mono, fontSize: 10.5, color: '#8c92ad' }}>{ring1} vizinhos diretos · {outs} links · {ins} backlinks</div>
          {narrow && <button style={{ ...primaryBtn, height: 44 }} onClick={() => openInEditor(path)}>Ler / editar nota</button>}
        </div>

        {sugs.length > 0 && (
          <div style={{ borderRadius: 16, padding: 16, background: 'rgba(245,181,74,0.06)', border: '1px solid rgba(245,181,74,0.3)', display: 'flex', flexDirection: 'column', gap: 10, backdropFilter: 'blur(10px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 14, height: 14, borderRadius: '50%', background: 'radial-gradient(circle at 38% 34%, #fff, #67d8f2 34%, #a68cf7 80%)' }} />
              <span style={{ ...eyebrow, color: AMBER }}>Yui percebeu</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#dfe3f3' }}>
              {sugs.length === 1 ? '1 nota fala' : `${sugs.length} notas falam`} do mesmo assunto mas não {sugs.length === 1 ? 'está ligada' : 'estão ligadas'} a esta. Quer que eu crie os links?
            </p>
            {sugs.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#dfe3f3' }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.reason}>{s.title}</span>
                <button onClick={() => linkOne(s.id)} style={{ height: 28, padding: '0 9px', borderRadius: 7, border: `1px solid ${rgba(AMBER, 0.45)}`, background: rgba(AMBER, 0.14), color: '#f5c97a', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>+ ligar</button>
              </div>
            ))}
            <button disabled={linking} onClick={linkAll} style={{ height: 38, borderRadius: 10, border: 'none', background: 'rgba(245,181,74,0.2)', color: '#f5c97a', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              {linking ? 'Ligando…' : sugs.length === 1 ? 'Ligar' : `Ligar as ${sugs.length}`}
            </button>
          </div>
        )}

        {!narrow && (
          <div style={{ ...glass, borderRadius: 16, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ ...eyebrow, color: '#8c92ad', fontWeight: 600 }}>Legenda</span>
            {[
              ['link que sai desta nota', '#67d8f2'],
              ['backlink (outra nota cita esta)', '#a68cf7'],
              ['link nos dois sentidos', 'linear-gradient(90deg, #67d8f2, #a68cf7)'],
              ['sugestão da Yui', `repeating-linear-gradient(90deg, ${AMBER} 0 6px, rgba(0,0,0,0) 6px 11px)`],
            ].map(([l, bg]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: '#c9cde0' }}>
                <span style={{ width: 26, height: 2, background: bg, borderRadius: 1 }} />
                {l}
              </div>
            ))}
            <span style={{ fontSize: 11.5, color: '#8c92ad', marginTop: 4 }}>Clique numa estrela para centralizar nela; duplo clique abre no editor.</span>
          </div>
        )}
      </aside>

      {/* caminho entre notas */}
      {!narrow && (
        <div style={{ position: 'absolute', left: 378, right: 24, bottom: 22, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ ...glass, borderRadius: 14, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', pointerEvents: 'auto', maxWidth: '100%' }}>
            <span style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c92ad', fontWeight: 600, marginRight: 4 }}>Caminho até</span>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (target.trim()) findRoute(target)
              }}
              style={{ display: 'flex', gap: 6 }}
            >
              <label style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }} htmlFor="brain-route">Nota de destino</label>
              <input
                id="brain-route"
                list="brain-titles"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="outra nota…"
                style={{ width: 190, height: 30, padding: '0 10px', borderRadius: 9, border: '1px solid rgba(160,170,255,0.18)', background: 'rgba(6,7,13,0.6)', color: '#e8eaf4', fontSize: 12.5, outline: 'none' }}
              />
              <datalist id="brain-titles">
                {titles.slice(0, 400).map((t) => <option key={t} value={t} />)}
              </datalist>
              <button type="submit" style={{ height: 30, padding: '0 10px', borderRadius: 9, border: 'none', background: 'rgba(103,216,242,0.16)', color: '#a9e9f8', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Traçar</button>
            </form>
            {route &&
              route.map((id, i) => {
                const n = byId.get(id)
                const c = n ? nodeColors(n).c : '#8c92ad'
                return (
                  <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => i > 0 && openConstellation(id)}
                      style={{ height: 26, padding: '0 10px', borderRadius: 13, border: `1px solid ${rgba(c, 0.55)}`, background: 'transparent', color: '#e8eaf4', fontSize: 12, boxShadow: `0 0 12px ${rgba(c, 0.25)}`, cursor: i > 0 ? 'pointer' : 'default' }}
                    >
                      {title(id)}
                    </button>
                    {i < route.length - 1 && <span style={{ color: '#67d8f2' }}>→</span>}
                  </span>
                )
              })}
            {routeMsg && <span style={{ fontSize: 12, color: '#f5c97a' }}>{routeMsg}</span>}
          </div>
        </div>
      )}

      <div style={{ position: 'absolute', ...(narrow ? { right: 14, top: 150 } : { right: 24, bottom: 90 }), display: 'flex', flexDirection: 'column', gap: 6, zIndex: 2 }}>
        <IconBtn label="Aproximar" size={narrow ? 44 : 36} onClick={() => engRef.current?.zoomBy(1.4)}>{Icon.plus}</IconBtn>
        <IconBtn label="Afastar" size={narrow ? 44 : 36} onClick={() => engRef.current?.zoomBy(1 / 1.4)}>{Icon.minus}</IconBtn>
        <IconBtn label="Centralizar" size={narrow ? 44 : 36} onClick={() => engRef.current?.fit(narrow ? { l: 12, r: 12, t: 150, b: 120 } : { l: 380, r: 40, t: 110, b: 90 })}>{Icon.center}</IconBtn>
      </div>
    </div>
  )
}
