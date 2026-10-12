import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { CompanySearchResult, CompanyStats } from '@shared/protocol'
import { api } from '../api/client'
import { onCompanyEvent } from '../api/events'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { fmtNum, goTab, useStacked } from './api'

// Como funciona a busca (Pipeline.dc.html): o fluxo com números reais e o "Perguntar à base",
// que usa a mesma busca da ferramenta empresa_consultar.

const rgba = (h: string, a: number) => {
  const n = parseInt(h.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

type Stage = { t: string; d: string; m: string; c: string; icon: string; ok: boolean | undefined }

function stagesOf(s: CompanyStats | null): Stage[] {
  const n = (v: number | undefined, unit: string) => (v == null ? '—' : `${fmtNum(v)} ${unit}`)
  return [
    { t: 'Arquivo', d: 'PDF, DOCX, PPTX, XLSX, imagem', m: n(s?.docs, s?.docs === 1 ? 'enviado' : 'enviados'), c: '#dfe3f3', icon: 'M6 3h8l4 4v14H6zM14 3v4h4', ok: true },
    { t: 'Leitura', d: 'texto, imagens (OCR), tabelas e layout', m: n(s?.pages, 'páginas'), c: '#67d8f2', icon: 'M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M8 12h8', ok: s?.services.docling },
    { t: 'Extração', d: 'tipo, resumo, campos e entidades', m: n(s?.ready, 'fichas'), c: '#a68cf7', icon: 'M4 6h16M4 12h10M4 18h6M17 15l3 3-3 3', ok: s?.services.openai },
    { t: 'Guardado', d: 'documentos, páginas e trechos', m: n(s?.chunks, 'trechos'), c: '#4fe0b0', icon: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3', ok: s?.services.postgres },
    { t: 'Preparando busca', d: 'cada trecho ganha um índice pelo sentido', m: n(s?.vectors, 'trechos'), c: '#cbbcff', icon: 'M5 12a2 2 0 1 0 0-.01M12 5a2 2 0 1 0 0-.01M19 12a2 2 0 1 0 0-.01M12 19a2 2 0 1 0 0-.01M7 11l3-4M14 7l3 4M17 13l-3 4M10 17l-3-4', ok: s?.services.openai },
    { t: 'Pronto para a Yui', d: 'busca pelo sentido e pela palavra', m: n(s?.vectors, 'trechos'), c: '#f5b54a', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5', ok: s?.services.qdrant },
    { t: 'Yui e agentes', d: 'consultam e citam a fonte', m: n(s?.queries7d, 'consultas/7d'), c: '#f78cc8', icon: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM8 12h8M12 8v8', ok: true },
  ]
}

function Pipeline({ stats, narrow }: { stats: CompanyStats | null; narrow: boolean }) {
  const st = stagesOf(stats)
  return (
    <section
      aria-label="Pipeline"
      data-own-scroll
      style={{ borderRadius: 16, background: 'radial-gradient(80% 140% at 50% 0%, rgba(103,216,242,0.07), rgba(10,12,29,0.2)), rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', padding: narrow ? 12 : 22, overflowX: 'auto' }}
    >
      <div style={{ display: 'flex', alignItems: 'stretch', minWidth: narrow ? 0 : 900, flexDirection: narrow ? 'column' : 'row', gap: narrow ? 8 : 0 }}>
        {st.map((s, i) => {
          const down = s.ok === false
          return (
            <div key={s.t} style={{ display: 'flex', alignItems: 'center', flex: narrow ? 'none' : 1, flexDirection: narrow ? 'column' : 'row', minWidth: 0 }}>
              <div
                style={{
                  flex: 1, width: narrow ? '100%' : undefined, minWidth: 0, minHeight: narrow ? 0 : 142, padding: 12, borderRadius: 14, background: 'rgba(12,14,32,0.92)', border: `1px solid ${down ? 'rgba(240,98,114,0.5)' : rgba(s.c, 0.35)}`,
                  display: 'flex', flexDirection: narrow ? 'row' : 'column', alignItems: narrow ? 'center' : 'stretch', gap: narrow ? 10 : 6, boxShadow: `0 0 24px ${rgba(s.c, 0.12)}`,
                }}
              >
                <span style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 10, background: rgba(s.c, 0.14), color: s.c, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={s.icon} />
                  </svg>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: narrow ? 1 : 'none' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{s.t}</span>
                  <span style={{ fontSize: 11, color: C.t2, lineHeight: 1.35 }}>{s.d}</span>
                </span>
                <span style={{ marginTop: narrow ? 0 : 'auto', fontFamily: 'var(--mono)', fontSize: 10.5, color: down ? '#f39aa4' : s.c, whiteSpace: 'nowrap' }}>{down ? 'fora do ar' : s.m}</span>
              </div>
              {i < st.length - 1 &&
                (narrow ? (
                  <span aria-hidden style={{ width: 2, height: 12, background: `linear-gradient(180deg, ${s.c}, ${st[i + 1].c})`, opacity: 0.7 }} />
                ) : (
                  <span aria-hidden style={{ position: 'relative', width: 22, height: 2, flexShrink: 0, background: `linear-gradient(90deg, ${s.c}, ${st[i + 1].c})`, opacity: 0.75 }}>
                    <span style={{ position: 'absolute', top: -2, left: 0, width: 6, height: 6, borderRadius: '50%', background: '#fff', boxShadow: `0 0 10px ${st[i + 1].c}`, animation: `co-flow ${(1.4 + (i % 3) * 0.3).toFixed(1)}s linear infinite` }} />
                  </span>
                ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// Resposta com [n] destacados e **negrito** simples (sem HTML vindo do servidor).
function Answer({ text }: { text: string }) {
  const parts: ReactNode[] = []
  const re = /(\[\d+\]|\*\*[^*]+\*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const v = m[0]
    parts.push(v.startsWith('[') ? <span key={k++} className="co-cite">{v}</span> : <b key={k++} style={{ color: '#f5c97a' }}>{v.slice(2, -2)}</b>)
    last = m.index + v.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <span style={{ whiteSpace: 'pre-wrap' }}>{parts}</span>
}

export function SearchTab() {
  const narrow = useYui((s) => s.narrow)
  const stacked = useStacked()
  const [stats, setStats] = useState<CompanyStats | null>(null)
  const [statsErr, setStatsErr] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [res, setRes] = useState<CompanySearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const loadStats = useCallback(() => {
    api.get<CompanyStats>('/api/company/stats').then((s) => {
      setStats(s)
      setStatsErr(false)
    }).catch(() => setStatsErr(true))
  }, [])
  useEffect(() => {
    loadStats()
    let t: ReturnType<typeof setTimeout> | undefined
    const off = onCompanyEvent(() => {
      clearTimeout(t)
      t = setTimeout(loadStats, 800)
    })
    return () => {
      off()
      clearTimeout(t)
    }
  }, [loadStats])

  const ask = (query = q) => {
    const text = query.trim()
    if (!text || busy) return
    setBusy(true)
    setErr(null)
    api
      .post<CompanySearchResult>('/api/company/search', { query: text, answer: true })
      .then((r) => {
        setRes(r)
        loadStats()
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false))
  }

  const cfg = [
    ['Tamanho do trecho', 'cerca de meia página'],
    ['Busca', 'pelo sentido e pela palavra exata'],
    ['Trechos por pergunta', 'os 6 mais parecidos'],
    ['Filtros', 'categoria, documento'],
    ['Leitura de imagens', 'feita no próprio servidor'],
  ]
  const tech = [
    ['Trecho', '~800 tokens, sobreposição 120'],
    ['Busca', 'vetor + palavra (híbrida, RRF)'],
    ['Embeddings', 'OpenAI 3-small · 1536d'],
    ['Banco', 'PostgreSQL + Qdrant'],
    ['OCR', 'Docling (local)'],
  ]
  const toggleHit = (id: string) =>
    setOpen((cur) => {
      const n = new Set(cur)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {statsErr && !stats && <span style={{ fontSize: 12, color: C.t2 }}>Status indisponível</span>}
      <Pipeline stats={stats} narrow={narrow} />
      <section style={{ display: 'grid', gridTemplateColumns: stacked ? 'minmax(0,1fr)' : 'minmax(0, 1fr) 330px', gap: 16, alignItems: 'start' }}>
        <div className="co-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Perguntar à base</span>
            <span style={{ fontSize: 11.5, color: '#8c92ad' }}>a mesma busca que a Yui e os agentes usam</span>
          </div>
          <form
            style={{ display: 'flex', gap: 8, flexDirection: narrow ? 'column' : 'row' }}
            onSubmit={(e) => {
              e.preventDefault()
              ask()
            }}
          >
            <label style={{ flex: 1, display: 'flex' }}>
              <span className="sr-only">Pergunta</span>
              <input className="co-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: Quanto custa um site institucional e o que está incluso?" style={{ height: narrow ? 46 : 42, borderColor: 'rgba(103,216,242,0.3)', fontSize: narrow ? 16 : 14 }} />
            </label>
            <button type="submit" className="app-btn primary" disabled={busy || !q.trim()} style={{ height: narrow ? 46 : 42, padding: '0 18px' }}>
              {busy ? 'Buscando…' : 'Buscar'}
            </button>
          </form>
          {err && <div style={{ color: C.crit, fontSize: 13 }}>{err}</div>}
          {!res && !busy && !err && (
            <span style={{ fontSize: 12.5, color: C.t3 }}>
              {stats && !stats.ready ? 'Envie documentos na aba Documentos para a base ter o que responder.' : 'A resposta usa só os trechos encontrados e cita a fonte de cada um.'}
            </span>
          )}
          {res && (
            <>
              <div style={{ padding: '14px 16px', borderRadius: 12, background: res.noAnswer ? 'rgba(245,181,74,0.06)' : 'rgba(103,216,242,0.06)', border: `1px solid ${res.noAnswer ? 'rgba(245,181,74,0.3)' : 'rgba(103,216,242,0.2)'}`, display: 'flex', gap: 12 }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: 'radial-gradient(circle at 38% 34%, #ffffff, #67d8f2 34%, #a68cf7 80%)', boxShadow: '0 0 14px rgba(103,216,242,0.5)' }} />
                <div className="co-ans" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, lineHeight: 1.6, color: '#dfe3f3', minWidth: 0, overflowWrap: 'anywhere' }}>
                  {res.noAnswer ? (
                    <span>A base não tem informação sobre isso. Se existir um documento que responda, envie na aba Documentos.</span>
                  ) : res.answer ? (
                    <Answer text={res.answer} />
                  ) : (
                    <span>Trechos encontrados abaixo.</span>
                  )}
                  <span style={{ fontSize: 11.5, color: '#8c92ad' }}>
                    {res.noAnswer ? 'Sem resposta' : `Resposta montada só com os trechos abaixo · ${res.hits.length} ${res.hits.length === 1 ? 'fonte' : 'fontes'}`} · {fmtNum(res.ms)} ms
                  </span>
                </div>
              </div>
              {!!res.hits.length && <span className="co-eyebrow" style={{ color: '#8c92ad', fontWeight: 600 }}>Trechos recuperados</span>}
              {res.hits.map((h) => (
                <div key={h.chunkId} style={{ display: 'grid', gridTemplateColumns: narrow ? '28px minmax(0, 1fr)' : '28px minmax(0, 1fr) 150px', gap: 12, alignItems: 'center', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: C.cyan }}>[{h.n}]</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <button
                      aria-expanded={open.has(h.chunkId)}
                      title={open.has(h.chunkId) ? 'Mostrar menos' : 'Mostrar o trecho inteiro'}
                      onClick={() => toggleHit(h.chunkId)}
                      style={{ fontSize: 13, color: 'var(--text-btn)', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.45, overflowWrap: 'anywhere', ...(open.has(h.chunkId) ? { whiteSpace: 'pre-wrap' } : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}
                    >
                      {h.text}
                    </button>
                    <button className="vault-link-btn" style={{ fontSize: 11.5, padding: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={() => goTab(`doc:${h.docId}`)}>
                      {h.docName}
                      {h.page != null ? ` · pág. ${h.page}` : ''}
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: narrow ? '2' : 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: 'var(--mono)', fontSize: 10.5, color: C.t2 }}>
                      <span>vetor {h.vector == null ? '—' : h.vector.toFixed(2).replace('.', ',')}</span>
                      <span>palavra {h.keyword == null ? '—' : h.keyword.toFixed(2).replace('.', ',')}</span>
                    </div>
                    <span style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: '100%', width: `${Math.round(h.score * 100)}%`, background: 'linear-gradient(90deg, #67d8f2, #a68cf7)' }} />
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <aside aria-label="Configuração da busca" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div className="co-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Como a busca funciona</span>
            {cfg.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
                <span style={{ color: C.t2 }}>{k}</span>
                <span style={{ color: C.text, fontSize: 12.5, textAlign: 'right' }}>{v}</span>
              </div>
            ))}
            <details style={{ fontSize: 12, color: C.t2 }}>
              <summary style={{ cursor: 'pointer' }}>Detalhes técnicos</summary>
              {tech.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, paddingTop: 6 }}>
                  <span>{k}</span>
                  <span style={{ color: C.text, fontFamily: 'var(--mono)', textAlign: 'right' }}>{v}</span>
                </div>
              ))}
            </details>
          </div>
          <div style={{ padding: 16, borderRadius: 16, background: 'rgba(166,140,247,0.06)', border: '1px solid rgba(166,140,247,0.24)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Quem usa</span>
            <span style={{ fontSize: 12.5, color: '#c9cde0', lineHeight: 1.55 }}>
              A Yui (voz e texto) e todos os agentes podem consultar esses documentos. Cada resposta cita o documento e a página.
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 22, fontWeight: 300, color: C.cyan }}>{stats ? fmtNum(stats.queries7d) : '—'}</span>
                <span style={{ fontSize: 11, color: C.t2 }}>consultas em 7 dias</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 22, fontWeight: 300, color: C.warn }}>{stats ? fmtNum(stats.unanswered7d) : '—'}</span>
                <span style={{ fontSize: 11, color: C.t2 }}>sem resposta (falta doc)</span>
              </div>
            </div>
          </div>
          {!!stats?.unansweredRecent.length && (
            <div style={{ padding: '14px 16px', borderRadius: 16, background: 'rgba(245,181,74,0.06)', border: '1px solid rgba(245,181,74,0.28)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12.5, color: '#dfe3f3', lineHeight: 1.5 }}>Perguntas que a base não respondeu — talvez falte um documento:</span>
              {stats.unansweredRecent.slice(0, 6).map((u, i) => (
                <button key={i} className="vault-link-btn" style={{ textAlign: 'left', whiteSpace: 'normal', color: '#f5c97a', padding: '2px 0' }} onClick={() => {
                  setQ(u)
                  ask(u)
                }}>
                  “{u}”
                </button>
              ))}
              <button className="app-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => goTab('documentos')}>Enviar documento</button>
            </div>
          )}
        </aside>
      </section>
    </div>
  )
}
