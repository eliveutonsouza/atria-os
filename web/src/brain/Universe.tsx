import { useEffect, useMemo, useRef, useState } from 'react'
import type { VaultGraphPayload, VaultSearchHit } from '@shared/protocol'
import { api } from '../api/client'
import { useYui } from '../store/yui'
import { BrainEngine, type ELink, type ENode } from './brainEngine'
import { HUB_DEGREE, degrees, nodeColors, openConstellation } from './data'
import { createSimulation, galaxyCenters, savePositions, type SimLink, type SimNode } from './layout'
import { galaxy } from './palette'
import { NotePanel } from './NotePanel'
import { Chip, IconBtn, Toggle } from './ui'
import { Icon, SPACE_BG, glass, mono } from './styles'

const DAY = 86400_000
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

// Universo: todas as notas como estrelas, pastas como galáxias, links como rotas de luz.
export function Universe({ graph }: { graph: VaultGraphPayload }) {
  const narrow = useYui((s) => s.narrow)
  const tablet = useYui((s) => s.device === 'tablet')
  const coarse = useYui((s) => s.coarse)
  const zoomSize = narrow || coarse ? 44 : 36
  const cvRef = useRef<HTMLCanvasElement>(null)
  const engRef = useRef<BrainEngine | null>(null)
  const nodesRef = useRef(new Map<string, ENode>())
  const simRef = useRef<ReturnType<typeof createSimulation> | null>(null)
  const fitted = useRef(false)
  const [sel, setSel] = useState<string | null>(null)
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)
  const [grp, setGrp] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sugIds, setSugIds] = useState<string[]>([])
  const [particles, setParticles] = useState(true)
  const [labels, setLabels] = useState(true)
  const [showSug, setShowSug] = useState(true)
  const [cut, setCut] = useState<number | null>(null) // índice do dia de corte na linha do tempo (null = hoje)

  const deg = useMemo(() => degrees(graph), [graph])
  const realNodes = useMemo(() => graph.nodes.filter((n) => !n.ghost), [graph])
  const galaxies = useMemo(() => [...new Set(realNodes.map((n) => n.folder))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })), [realNodes])

  // linha do tempo: notas novas por dia (mtime), do primeiro dia até hoje
  const days = useMemo(() => {
    if (!realNodes.length) return [] as { key: string; n: number; end: number }[]
    const min = Math.min(...realNodes.map((n) => n.mtime))
    const start = new Date(dayKey(min)).getTime()
    const count = Math.min(120, Math.max(1, Math.ceil((Date.now() - start) / DAY) + 1))
    const first = Date.now() - (count - 1) * DAY
    const out = Array.from({ length: count }, (_, i) => {
      const end = new Date(dayKey(first + i * DAY)).getTime() + DAY
      return { key: dayKey(first + i * DAY), n: 0, end }
    })
    for (const n of realNodes) {
      const i = out.findIndex((d) => n.mtime < d.end)
      out[i < 0 ? out.length - 1 : i].n++
    }
    return out
  }, [realNodes])
  const maxDay = Math.max(1, ...days.map((d) => d.n))
  const cutIdx = cut ?? days.length - 1

  // ---------- motor ----------
  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return
    const eng = new BrainEngine(cv, {
      onSelect: (id) => setSel(id),
      onHover: (id, x, y) => setHover(id ? { id, x, y } : null),
      onOpen: (id) => openConstellation(id),
      onDrag: (n, phase) => {
        const sim = simRef.current
        if (!sim) return
        if (phase === 'start') sim.alphaTarget(0.15).restart()
        if (phase === 'end') {
          sim.alphaTarget(0)
          n.fx = null
          n.fy = null
          savePositions([...nodesRef.current.values()] as SimNode[])
        }
      },
    })
    engRef.current = eng
    return () => {
      eng.destroy()
      simRef.current?.stop()
      engRef.current = null
    }
  }, [])

  // grafo → estrelas (reaproveita objetos para manter posições entre atualizações ao vivo)
  useEffect(() => {
    const eng = engRef.current
    if (!eng) return
    const prev = nodesRef.current
    const next = new Map<string, ENode>()
    for (const n of graph.nodes) {
      const d = deg.get(n.id) ?? 0
      const c = nodeColors(n)
      const hub = !n.ghost && d >= HUB_DEGREE
      const e = prev.get(n.id) ?? ({ id: n.id } as ENode)
      Object.assign(e, { label: n.title, color: c.c, color2: c.c2, r: n.ghost ? 3 : hub ? 9 : 3.5 + Math.min(d, 8) * 0.55, hub, ghost: !!n.ghost, galaxy: n.ghost ? '__ghost' : n.folder })
      next.set(n.id, e)
    }
    nodesRef.current = next
    const nodes = [...next.values()]
    const base: ELink[] = []
    const simLinks: SimLink[] = []
    for (const l of graph.links) {
      const s = next.get(l.s), t = next.get(l.t)
      if (!s || !t) continue
      base.push({ s, t, kind: l.kind })
      simLinks.push({ source: l.s, target: l.t })
    }
    simRef.current?.stop()
    const centers = galaxyCenters([...galaxies, '__ghost'], nodes.length)
    const sim = createSimulation(nodes as SimNode[], simLinks, centers, () => {})
    simRef.current = sim
    eng.setScene(nodes, base)
    if (!fitted.current) {
      fitted.current = true
      eng.fit(narrow ? { l: 16, r: 16, t: 150, b: 40 } : { l: 40, r: 380, t: 150, b: 180 }, false)
      setTimeout(() => engRef.current?.fit(narrow ? { l: 16, r: 16, t: 150, b: 40 } : { l: 40, r: 380, t: 150, b: 180 }), 1400)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  // nebulosas acompanham o centro de cada galáxia
  useEffect(() => {
    const tick = () => {
      const eng = engRef.current
      if (!eng) return
      const acc = new Map<string, { x: number; y: number; n: number; xs: number[]; ys: number[] }>()
      for (const n of eng.nodes) {
        if (n.ghost || n.x === undefined || n.y === undefined) continue
        const a = acc.get(n.galaxy) ?? { x: 0, y: 0, n: 0, xs: [], ys: [] }
        a.x += n.x
        a.y += n.y
        a.n++
        a.xs.push(n.x)
        a.ys.push(n.y)
        acc.set(n.galaxy, a)
      }
      eng.nebulae = [...acc].map(([g, a]) => {
        const cx = a.x / a.n, cy = a.y / a.n
        const spread = Math.sqrt(a.xs.reduce((s, x, i) => s + (x - cx) ** 2 + (a.ys[i] - cy) ** 2, 0) / a.n)
        return { x: cx, y: cy, r: Math.max(120, spread * 2.2), color: galaxy(g).c }
      })
    }
    tick()
    const t = setInterval(tick, 600)
    return () => clearInterval(t)
  }, [graph])

  // seleção, filtros, busca, linha do tempo e opções → motor
  useEffect(() => {
    engRef.current?.setSelected(sel)
  }, [sel])
  useEffect(() => {
    const eng = engRef.current
    if (!eng) return
    const ql = q.trim().toLowerCase()
    const cutoff = days[cutIdx]?.end ?? Infinity
    const hidden = new Set<string>()
    const dimmed = new Set<string>()
    const hl = new Set<string>()
    for (const n of graph.nodes) {
      if (!n.ghost && cut !== null && n.mtime >= cutoff) hidden.add(n.id)
      if (grp && n.folder !== grp) dimmed.add(n.id)
      if (ql && (n.title.toLowerCase().includes(ql) || n.id.toLowerCase().includes(ql) || n.tags.some((t) => `#${t}`.includes(ql)))) hl.add(n.id)
    }
    eng.hidden = hidden
    eng.dimmed = dimmed
    eng.highlight = ql ? hl : new Set()
    eng.particles = particles
    eng.labels = labels
    eng.showSug = showSug
  }, [graph, grp, q, cut, cutIdx, days, particles, labels, showSug])

  // sugestões da estrela selecionada viram rotas tracejadas
  useEffect(() => {
    const eng = engRef.current
    if (!eng) return
    const base = eng.links.filter((l) => l.kind !== 'sug')
    const s = sel ? nodesRef.current.get(sel) : null
    const extra: ELink[] = s ? sugIds.map((id) => nodesRef.current.get(id)).filter((t): t is ENode => !!t).map((t) => ({ s, t, kind: 'sug' })) : []
    eng.setScene(eng.nodes, [...base, ...extra])
  }, [sugIds, sel, graph])

  const pick = (id: string) => {
    setSel(id)
    engRef.current?.flyToNode(id)
  }

  const onSearchEnter = async () => {
    const ql = q.trim().toLowerCase()
    if (!ql) return
    const local = graph.nodes.find((n) => n.title.toLowerCase() === ql) ?? graph.nodes.find((n) => n.title.toLowerCase().includes(ql))
    if (local) return pick(local.id)
    const hits = await api.get<VaultSearchHit[]>(`/api/vault/search?q=${encodeURIComponent(q.trim())}`).catch(() => [])
    if (hits[0]) pick(hits[0].path)
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of realNodes) m.set(n.folder, (m.get(n.folder) ?? 0) + 1)
    return m
  }, [realNodes])
  const hoverNode = hover ? graph.nodes.find((n) => n.id === hover.id) : null
  const stats = `${realNodes.length} estrelas · ${graph.links.length} rotas · ${galaxies.length} galáxias`
  const empty = realNodes.length === 0

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: SPACE_BG, zIndex: 2 }}>
      <canvas ref={cvRef} aria-label="Universo de notas do vault" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'grab' }} />

      {/* cabeçalho */}
      <header
        style={{
          position: 'absolute', left: 0, right: 0, top: 0, padding: narrow ? 'calc(12px + env(safe-area-inset-top)) 14px 0' : '20px 28px 0',
          display: 'flex', flexDirection: 'column', gap: 12, pointerEvents: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, pointerEvents: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: '#67d8f2', fontWeight: 600 }}>Vault · atria-os</div>
              <h1 style={{ margin: 0, fontSize: narrow ? 20 : 26, fontWeight: 600 }}>Cérebro</h1>
              <div style={{ fontSize: 12.5, color: '#9aa0bb' }}>{stats}</div>
            </div>
          </div>
          <label style={{ position: 'relative', display: 'flex', alignItems: 'center', pointerEvents: 'auto', flex: narrow ? '1 1 100%' : 'none' }}>
            <span style={{ position: 'absolute', left: 12, color: '#8c92ad', display: 'flex' }}>{Icon.search}</span>
            <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Buscar no cérebro</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearchEnter()
                if (e.key === 'Escape') setQ('')
              }}
              placeholder="Buscar estrela… (Enter voa até ela)"
              style={{ width: narrow ? '100%' : 320, height: narrow ? 44 : 38, padding: '0 12px 0 36px', borderRadius: 12, border: '1px solid rgba(160,170,255,0.18)', background: 'rgba(10,12,29,0.72)', color: '#e8eaf4', fontSize: narrow ? 16 : 13, outline: 'none' }}
            />
          </label>
        </div>
        <div className="app-scroll" data-own-scroll style={{ display: 'flex', gap: 6, flexWrap: narrow ? 'nowrap' : 'wrap', overflowX: narrow ? 'auto' : 'visible', pointerEvents: 'auto', paddingBottom: 4 }}>
          <Chip on={grp === null} color="#ffffff" label="Todas" count={realNodes.length} onClick={() => setGrp(null)} />
          {galaxies.map((g) => {
            const c = galaxy(g)
            return <Chip key={g} on={grp === g} color={c.c} label={c.name} count={counts.get(g)} onClick={() => setGrp(grp === g ? null : g)} />
          })}
        </div>
      </header>

      {empty && (
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', color: '#9aa0bb', fontSize: 14, maxWidth: 360, lineHeight: 1.6 }}>
          O universo ainda está vazio. Crie uma nota no Vault com um <span style={mono}>[[link]]</span> e a primeira estrela aparece aqui.
        </div>
      )}

      {/* dica ao passar o mouse */}
      {hoverNode && !narrow && hover && (
        <div style={{ position: 'absolute', left: hover.x + 14, top: hover.y + 14, pointerEvents: 'none', padding: '7px 10px', borderRadius: 10, background: 'rgba(12,14,32,0.92)', border: '1px solid rgba(160,170,255,0.18)', fontSize: 12, maxWidth: 260, zIndex: 4 }}>
          <div style={{ fontWeight: 600 }}>{hoverNode.title}</div>
          <div style={{ ...mono, fontSize: 10.5, color: '#8c92ad' }}>{hoverNode.ghost ? 'nota ainda não criada' : `${nodeColors(hoverNode).name} · ${deg.get(hoverNode.id) ?? 0} conexões`}</div>
        </div>
      )}

      {/* painel / bottom sheet */}
      {sel && graph.nodes.some((n) => n.id === sel) && (
        <NotePanel key={sel} path={sel} graph={graph} sheet={narrow} onPick={pick} onSuggestions={setSugIds} onClose={() => setSel(null)} />
      )}

      {/* linha do tempo + opções */}
      {/* tablet: com a nota aberta a linha do tempo sai para o zoom ocupar o canto oposto ao painel */}
      {!narrow && !(tablet && sel) && (
        <div style={{ ...glass, position: 'absolute', left: 24, bottom: 22, width: tablet ? 300 : 390, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, borderRadius: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span style={{ fontWeight: 600 }}>Linha do tempo do cérebro</span>
            <span style={{ ...mono, fontSize: 10.5, color: '#8c92ad' }}>{cut === null ? 'hoje' : `até ${days[cutIdx]?.key.split('-').reverse().slice(0, 2).join('/')}`}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 42 }}>
            {days.map((d, i) => (
              <span
                key={d.key}
                title={`${d.key}: ${d.n} notas`}
                style={{ flex: 1, minWidth: 1, height: `${Math.max(6, Math.round((d.n / maxDay) * 100))}%`, borderRadius: '2px 2px 0 0', background: i > cutIdx ? 'rgba(160,170,255,0.08)' : i >= cutIdx - 3 ? 'linear-gradient(180deg, #67d8f2, rgba(166,140,247,0.6))' : 'rgba(160,170,255,0.3)' }}
              />
            ))}
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Mostrar o cérebro até o dia</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, days.length - 1)}
              value={cutIdx}
              onChange={(e) => {
                const v = Number(e.target.value)
                setCut(v >= days.length - 1 ? null : v)
              }}
              style={{ width: '100%', accentColor: '#67d8f2' }}
            />
          </label>
          <div style={{ display: 'flex', justifyContent: 'space-between', ...mono, fontSize: 10, color: '#8c92ad' }}>
            <span>{days[0]?.key.split('-').reverse().slice(0, 2).join('/')}</span>
            <span>hoje</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Toggle on={particles} label="Partículas" onClick={() => setParticles(!particles)} />
            <Toggle on={labels} label="Rótulos" onClick={() => setLabels(!labels)} />
            <Toggle on={showSug} tone="warn" label="Sugestões da Yui" onClick={() => setShowSug(!showSug)} />
            <Toggle
              on={false}
              label="Ver tudo"
              onClick={() => {
                setSel(null)
                setGrp(null)
                setQ('')
                setCut(null)
                engRef.current?.fit({ l: 40, r: 380, t: 150, b: 180 })
              }}
            />
          </div>
        </div>
      )}

      {/* zoom */}
      {!(narrow && sel) && (
      <div style={{ position: 'absolute', ...(narrow ? { left: 14 } : tablet ? (sel ? { left: 24 } : { right: 24 }) : { right: 370 }), bottom: narrow ? 'calc(24px + var(--tabbar))' : 22, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 2 }}>
        <IconBtn label="Aproximar" size={zoomSize} onClick={() => engRef.current?.zoomBy(1.4)}>{Icon.plus}</IconBtn>
        <IconBtn label="Afastar" size={zoomSize} onClick={() => engRef.current?.zoomBy(1 / 1.4)}>{Icon.minus}</IconBtn>
        <IconBtn label="Centralizar" size={zoomSize} onClick={() => engRef.current?.fit(narrow ? { l: 16, r: 16, t: 150, b: 40 } : { l: 40, r: 380, t: 150, b: 180 })}>{Icon.center}</IconBtn>
      </div>
      )}
    </div>
  )
}
