import type { ReactNode } from 'react'
import type { Block, CustomViewInfo } from '@shared/protocol'
import { useApi } from '../api/useApi'
import { C, toneColor } from '../lib/colors'
import { useYui } from '../store/yui'
import { GroupedBars, KpiTile, Legend, LineArea, Pie } from '../charts/Charts'
import { card, Dot, Empty, ErrorNote, Eyebrow, Skeleton, useHeader } from './ui'

// Tela sob medida: blocos nativos montados pela Yui ou por um agente (protocol.ts → Block).

export function CustomView() {
  const id = useYui((s) => s.viewParams.customId)
  const live = useYui((s) => (id ? s.customViews[id] : undefined))
  const { data, loading, error } = useApi<CustomViewInfo>(id && !live ? `/api/custom/${encodeURIComponent(id)}` : null, [id])
  const view = live ?? data
  useHeader(view?.spec.eyebrow ?? 'Yui', view?.spec.title ?? 'Tela', [], [view?.id])
  if (!id) return <Empty text="Nenhuma tela selecionada." hint="Peça: “Yui, faz um gráfico das execuções por agente.”" />
  if (loading && !view) return <Skeleton rows={3} />
  if (error || !view) return <ErrorNote text="Não encontrei essa tela." />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 1100 }}>
      {view.spec.blocks.map((b, i) => <BlockView key={i} block={b} />)}
    </div>
  )
}

export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'kpis':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14 }}>
          {block.items.map((k, i) => <KpiTile key={i} label={k.label} value={k.value} color={toneColor(k.tone)} size={block.items.length > 4 ? 30 : 40} />)}
        </div>
      )
    case 'chart':
      return (
        <Section title={block.title}>
          <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {block.chart === 'pie' ? (
              <Pie labels={block.labels} values={block.series[0]?.values ?? []} />
            ) : block.chart === 'bar' ? (
              <GroupedBars labels={block.labels} series={block.series} />
            ) : (
              <>
                <LineArea series={block.series} area={block.chart === 'area'} height={170} label={block.title ?? 'Gráfico'} />
                <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.t3 }}>
                  <span>{block.labels[0]}</span>
                  {block.labels.length > 2 && <span>{block.labels[Math.floor(block.labels.length / 2)]}</span>}
                  <span>{block.labels[block.labels.length - 1]}</span>
                </div>
              </>
            )}
            {block.chart !== 'pie' && <Legend names={block.series.map((s) => s.name)} />}
          </div>
        </Section>
      )
    case 'table':
      return (
        <Section title={block.title}>
          <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid rgba(255,255,255,.06)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  {block.columns.map((c, i) => (
                    <th key={i} style={{ textAlign: block.rows.length && block.rows.every((r) => typeof r[i] === 'number' || r[i] == null) ? 'right' : 'left', padding: '12px 14px', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.t3, fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.02)', whiteSpace: 'nowrap' }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((r, ri) => (
                  <tr key={ri} className="hov-row">
                    {block.columns.map((_, ci) => {
                      const v = r[ci]
                      return (
                        <td key={ci} style={{ padding: '11px 14px', borderBottom: '1px solid rgba(255,255,255,.04)', color: typeof v === 'number' ? C.text : '#d6d9e8', textAlign: typeof v === 'number' ? 'right' : 'left', fontVariantNumeric: 'tabular-nums' }}>
                          {v == null ? '—' : String(v)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )
    case 'list':
      return (
        <Section title={block.title}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {block.items.map((it, i) => {
              const c = toneColor(it.tone, C.cyan)
              const body = (
                <>
                  <Dot c={c} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{it.title}</span>
                    {it.subtitle && <span style={{ fontSize: 13, color: C.t2 }}>{it.subtitle}</span>}
                  </span>
                  {it.meta ? <span className="mono" style={{ fontSize: 12, color: C.t3, whiteSpace: 'nowrap' }}>{it.meta}</span> : <span />}
                </>
              )
              const style = { display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto', alignItems: 'center', gap: 14, padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,.05)', textDecoration: 'none' } as const
              return it.href ? (
                <a key={i} href={it.href} target="_blank" rel="noopener noreferrer" className="hov-row" style={style}>{body}</a>
              ) : (
                <div key={i} style={style}>{body}</div>
              )
            })}
          </div>
        </Section>
      )
    case 'markdown':
      return <div style={{ fontSize: 15, lineHeight: 1.65, color: '#d6d9e8', maxWidth: 820 }}>{renderMarkdown(block.text)}</div>
    case 'timeline':
      return (
        <Section title={block.title}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {block.items.map((ev, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '72px 20px minmax(0,1fr)', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                <span className="mono" style={{ fontSize: 13, color: C.t3 }}>{ev.t}</span>
                <Dot c={toneColor(ev.tone, C.cyan)} />
                <span style={{ fontSize: 15 }}>{ev.label}</span>
              </div>
            ))}
          </div>
        </Section>
      )
    case 'image':
      return <img src={block.src} alt={block.alt ?? ''} style={{ maxWidth: '100%', borderRadius: 14, border: '1px solid rgba(255,255,255,.08)' }} />
    case 'html':
      return (
        <iframe
          title="Visualização"
          src={block.url}
          sandbox="allow-scripts"
          style={{ width: '100%', height: block.height ?? 'calc(100vh - 260px)', minHeight: 420, border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, background: '#0a0c1d' }}
        />
      )
    case 'link':
      return (
        <a href={block.href} target="_blank" rel="noopener noreferrer" style={{ alignSelf: 'flex-start', height: 38, padding: '0 16px', borderRadius: 10, border: '1px solid rgba(103,216,242,.3)', background: 'rgba(103,216,242,.08)', color: '#a9e9f8', fontSize: 14, display: 'inline-flex', alignItems: 'center' }}>
          {block.label} ↗
        </a>
      )
  }
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      {title && <Eyebrow>{title}</Eyebrow>}
      {children}
    </div>
  )
}

// ---------- markdown seguro (sem HTML cru): títulos, listas, parágrafos, **negrito**, *itálico*, `código`, [link](https://…) ----------

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    const k = `${key}-${i++}`
    if (t.startsWith('**')) out.push(<strong key={k} style={{ color: C.text, fontWeight: 600 }}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={k} className="mono" style={{ fontSize: '.9em', padding: '1px 5px', borderRadius: 5, background: 'rgba(255,255,255,.06)' }}>{t.slice(1, -1)}</code>)
    else if (t.startsWith('[')) out.push(<a key={k} href={m[2]} target="_blank" rel="noopener noreferrer">{t.slice(1, t.indexOf(']'))}</a>)
    else out.push(<em key={k}>{t.slice(1, -1)}</em>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function renderMarkdown(src: string): ReactNode[] {
  const lines = src.replace(/\r/g, '').split('\n')
  const out: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  const flushPara = () => {
    if (para.length) out.push(<p key={`p${out.length}`} style={{ margin: '0 0 12px' }}>{inline(para.join(' '), `p${out.length}`)}</p>)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const items = list.items.map((it, i) => <li key={i} style={{ margin: '4px 0' }}>{inline(it, `l${out.length}-${i}`)}</li>)
    out.push(list.ordered ? <ol key={`o${out.length}`} style={{ margin: '0 0 12px', paddingLeft: 22 }}>{items}</ol> : <ul key={`u${out.length}`} style={{ margin: '0 0 12px', paddingLeft: 20 }}>{items}</ul>)
    list = null
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (h) {
      flushPara()
      flushList()
      const size = [0, 24, 19, 16, 15][h[1].length]
      out.push(<div key={`h${out.length}`} style={{ fontSize: size, fontWeight: h[1].length > 2 ? 600 : 400, color: C.text, margin: '14px 0 8px', letterSpacing: '-.01em' }}>{inline(h[2], `h${out.length}`)}</div>)
    } else if (ul || ol) {
      flushPara()
      const ordered = !!ol
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, items: [] }
      }
      list.items.push((ul ?? ol)![1])
    } else if (!line.trim()) {
      flushPara()
      flushList()
    } else {
      flushList()
      para.push(line.trim())
    }
  }
  flushPara()
  flushList()
  return out
}
