import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COMPANY_CATEGORIES, type CompanyCategory, type CompanyDoc, type CompanyStats } from '@shared/protocol'
import { api } from '../api/client'
import { onCompanyEvent } from '../api/events'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { ACCEPT, fmtDate, fmtNum, goTab, statusOf, uploadFiles, Icon } from './api'
import { CategoryChip, DeleteModal, HealthDot, PipeBar, Svg, TypeBadge } from './ui'

// Documentos (Docs.dc.html): upload, pipeline ao vivo, filtros, seleção, reprocessar e excluir.

type Note = { text: string; tone: 'ok' | 'warn' | 'crit' }

function useCompanyDocs() {
  const [docs, setDocs] = useState<CompanyDoc[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => {
    api.get<CompanyDoc[]>('/api/company/documents').then((d) => {
      setDocs(d)
      setErr(null)
    }).catch((e: Error) => setErr(e.message))
  }, [])
  useEffect(() => {
    load()
    return onCompanyEvent((ev) => {
      if (ev.type === 'company.doc.updated') {
        setDocs((cur) => {
          if (!cur) return cur
          const i = cur.findIndex((d) => d.id === ev.doc.id)
          if (i < 0) return [ev.doc, ...cur]
          const n = cur.slice()
          n[i] = ev.doc
          return n
        })
      } else if (ev.type === 'company.doc.deleted') {
        setDocs((cur) => cur?.filter((d) => d.id !== ev.id) ?? cur)
      }
    })
  }, [load])
  return { docs, setDocs, err, reload: load }
}

export function DocsTab() {
  const narrow = useYui((s) => s.narrow)
  const { docs, setDocs, err, reload } = useCompanyDocs()
  const [stats, setStats] = useState<CompanyStats | null>(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<'Todas' | CompanyCategory>('Todas')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [del, setDel] = useState<CompanyDoc[] | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [upload, setUpload] = useState<{ pct: number; count: number } | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [over, setOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)

  const loadStats = useCallback(() => {
    api.get<CompanyStats>('/api/company/stats').then(setStats).catch(() => {})
  }, [])
  useEffect(() => {
    loadStats()
    let t: ReturnType<typeof setTimeout> | undefined
    const off = onCompanyEvent(() => {
      clearTimeout(t)
      t = setTimeout(loadStats, 600)
    })
    return () => {
      off()
      clearTimeout(t)
    }
  }, [loadStats])

  const send = (files: File[]) => {
    if (!files.length || upload) return
    setNotes([])
    setUpload({ pct: 0, count: files.length })
    uploadFiles(files, (pct) => setUpload({ pct, count: files.length }))
      .then((r) => {
        const n: Note[] = []
        if (r.created.length) n.push({ text: `${r.created.length} ${r.created.length === 1 ? 'documento enviado' : 'documentos enviados'} — a leitura começa agora.`, tone: 'ok' })
        if (r.duplicates.length) n.push({ text: `Já estavam na base: ${r.duplicates.join(', ')}`, tone: 'warn' })
        for (const x of r.rejected) n.push({ text: `${x.name}: ${x.reason}`, tone: 'crit' })
        setNotes(n)
        if (r.created.length) setDocs((cur) => [...r.created, ...(cur ?? []).filter((d) => !r.created.some((c) => c.id === d.id))])
      })
      .catch((e: Error) => setNotes([{ text: e.message, tone: 'crit' }]))
      .finally(() => setUpload(null))
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of docs ?? []) m.set(d.category, (m.get(d.category) ?? 0) + 1)
    return m
  }, [docs])
  const needle = q.trim().toLowerCase()
  const visible = useMemo(
    () => (docs ?? []).filter((d) => (cat === 'Todas' || d.category === cat) && (!needle || [d.name, d.summary, d.docType, ...d.tags, ...d.entities.map((e) => e.value)].join(' ').toLowerCase().includes(needle))),
    [docs, cat, needle],
  )
  const allOn = visible.length > 0 && visible.every((d) => sel.has(d.id))
  const selDocs = (docs ?? []).filter((d) => sel.has(d.id))

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const patchCat = (d: CompanyDoc, category: CompanyCategory) => {
    setDocs((cur) => cur?.map((x) => (x.id === d.id ? { ...x, category } : x)) ?? cur)
    api.patch<CompanyDoc>(`/api/company/documents/${d.id}`, { category }).catch((e: Error) => {
      setNotes([{ text: e.message, tone: 'crit' }])
      reload()
    })
  }
  const reprocess = (ids: string[]) => {
    const p = ids.length === 1 ? api.post(`/api/company/documents/${ids[0]}/reprocess`) : api.post('/api/company/documents/bulk-reprocess', { ids })
    p.then(() => {
      setSel(new Set())
      reload()
    }).catch((e: Error) => setNotes([{ text: e.message, tone: 'crit' }]))
  }
  const confirmDelete = () => {
    if (!del) return
    const ids = del.map((d) => d.id)
    setDeleting(true)
    const p = ids.length === 1 ? api.del(`/api/company/documents/${ids[0]}`) : api.post('/api/company/documents/bulk-delete', { ids })
    p.then(() => {
      setDocs((cur) => cur?.filter((d) => !ids.includes(d.id)) ?? cur)
      setSel((s) => new Set([...s].filter((id) => !ids.includes(id))))
      setDel(null)
      loadStats()
    })
      .catch((e: Error) => setNotes([{ text: `Não consegui excluir: ${e.message}`, tone: 'crit' }]))
      .finally(() => setDeleting(false))
  }

  const toneColor = (t: Note['tone']) => (t === 'ok' ? C.ok : t === 'warn' ? C.warn : C.crit)

  const dropzone = narrow ? null : (
    <button
      className={`co-drop${over ? ' over' : ''}`}
      onClick={() => fileRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        send([...e.dataTransfer.files])
      }}
      disabled={!!upload}
      style={{ minHeight: 92 }}
    >
      <span style={{ width: 46, height: 46, borderRadius: 13, background: 'rgba(103,216,242,0.12)', color: C.cyan, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Svg d={Icon.upload} size={22} />
      </span>
      {upload ? (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch', minWidth: 280 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: '#fff', textAlign: 'left' }}>
            Enviando {upload.count} {upload.count === 1 ? 'arquivo' : 'arquivos'}… {upload.pct}%
          </span>
          <span style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${upload.pct}%`, background: 'linear-gradient(90deg, #67d8f2, #a68cf7)', transition: 'width .2s' }} />
          </span>
        </span>
      ) : (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', textAlign: 'left' }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: '#fff' }}>Arraste arquivos aqui ou clique para escolher</span>
          <span style={{ fontSize: 12, color: '#8c92ad' }}>PDF, DOCX, PPTX, XLSX, TXT, MD e imagens (JPG/PNG escaneados) · até 50 MB cada · vários de uma vez</span>
        </span>
      )}
    </button>
  )

  const inputs = (
    <>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          send([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          send([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
    </>
  )

  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: narrow ? 'nowrap' : 'wrap', flexDirection: narrow ? 'column' : 'row' }}>
      <label style={{ position: 'relative', display: 'flex', alignItems: 'center', width: narrow ? '100%' : 320 }}>
        <span style={{ position: 'absolute', left: 11, color: C.t2, display: 'flex' }}>
          <Svg d={Icon.search} size={14} />
        </span>
        <span className="sr-only">Buscar documentos</span>
        <input className="co-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, conteúdo ou cliente…" style={{ paddingLeft: 34, height: narrow ? 44 : 36, fontSize: narrow ? 16 : 13 }} />
      </label>
      <div data-own-scroll style={{ display: 'flex', gap: 6, overflowX: narrow ? 'auto' : 'visible', flexWrap: narrow ? 'nowrap' : 'wrap', width: narrow ? '100%' : 'auto', paddingBottom: narrow ? 2 : 0 }}>
        {(['Todas', ...COMPANY_CATEGORIES] as const).map((c) => {
          const n = c === 'Todas' ? docs?.length ?? 0 : counts.get(c) ?? 0
          if (c !== 'Todas' && !n && cat !== c) return null
          return (
            <button key={c} className={`co-chip${cat === c ? ' on' : ''}`} aria-pressed={cat === c} onClick={() => setCat(c)}>
              {c} <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: C.t2 }}>{n}</span>
            </button>
          )
        })}
      </div>
      {!narrow && <span style={{ flex: 1 }} />}
      {sel.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: narrow ? '100%' : 'auto' }}>
          <span style={{ fontSize: 12.5, color: '#c9cde0', flex: narrow ? 1 : 'none' }}>{sel.size} selecionados</span>
          <button className="app-btn" style={{ height: narrow ? 44 : 32 }} onClick={() => reprocess([...sel])}>
            Reprocessar
          </button>
          <button className="app-btn danger" style={{ height: narrow ? 44 : 32, fontWeight: 600 }} onClick={() => setDel(selDocs)}>
            Excluir
          </button>
        </div>
      )}
    </div>
  )

  const noteList = !!notes.length && (
    <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {notes.map((n, i) => (
        <div key={i} style={{ fontSize: 12.5, color: toneColor(n.tone), padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: `1px solid ${toneColor(n.tone)}33`, overflowWrap: 'anywhere' }}>
          {n.text}
        </div>
      ))}
    </div>
  )

  const empty = docs && !docs.length ? 'Nenhum documento ainda. Envie contratos, tabelas de preço, manuais e processos — a Yui e os agentes passam a consultar tudo.' : 'Nenhum documento com esse filtro.'
  const totals = stats ? `${fmtNum(stats.docs)} documentos · ${fmtNum(stats.pages)} páginas · ${fmtNum(stats.chunks)} trechos indexados${stats.processing ? ` · ${stats.processing} em leitura` : ''}${stats.errors ? ` · ${stats.errors} com erro` : ''}` : ''

  // ---------- celular: cartões ----------
  if (narrow) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {inputs}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <button className="app-btn" style={{ height: 50, fontWeight: 600 }} onClick={() => camRef.current?.click()} disabled={!!upload}>
            Fotografar documento
          </button>
          <button className="app-btn primary" style={{ height: 50 }} onClick={() => fileRef.current?.click()} disabled={!!upload}>
            {upload ? `Enviando… ${upload.pct}%` : '+ Enviar arquivo'}
          </button>
        </div>
        {noteList}
        {toolbar}
        {err && <div style={{ color: C.crit, fontSize: 13 }}>{err}</div>}
        {!docs && !err && <div style={{ color: C.t2, fontSize: 13 }}>Carregando…</div>}
        {visible.map((d) => (
          <div key={d.id} className="co-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px' }}>
            <TypeBadge ext={d.ext} />
            <button onClick={() => goTab(`doc:${d.id}`)} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5, background: 'none', border: 'none', color: C.text, textAlign: 'left', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{d.name}</span>
              <PipeBar doc={d} />
            </button>
            <button aria-label={`Excluir ${d.name}`} className="co-icon-btn danger" style={{ width: 44, height: 44, borderRadius: 12 }} onClick={() => setDel([d])}>
              <Svg d={Icon.trash} size={16} />
            </button>
          </div>
        ))}
        {docs && !visible.length && <div style={{ padding: 24, textAlign: 'center', color: C.t2, fontSize: 13.5 }}>{empty}</div>}
        {totals && <div style={{ fontSize: 12, color: C.t2 }}>{totals}</div>}
        {del && <DeleteModal docs={del} busy={deleting} onCancel={() => setDel(null)} onConfirm={confirmDelete} />}
      </div>
    )
  }

  // ---------- desktop: tabela ----------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {inputs}
      {dropzone}
      {noteList}
      {toolbar}
      <div className="co-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="co-table-wrap" data-own-scroll>
          <div className="co-grid-row" style={{ height: 38, fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c92ad', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <button aria-label="Selecionar todos" className={`co-check${allOn ? ' on' : ''}`} onClick={() => setSel(allOn ? new Set() : new Set(visible.map((d) => d.id)))}>
              {allOn ? '✓' : ''}
            </button>
            <span>Documento</span>
            <span>Categoria</span>
            <span>Pipeline</span>
            <span>Págs.</span>
            <span>Trechos</span>
            <span>Enviado</span>
            <span style={{ textAlign: 'right' }}>Ações</span>
          </div>
          {visible.map((d) => {
            const on = sel.has(d.id)
            const st = statusOf(d)
            return (
              <div key={d.id} className="co-grid-row co-row" style={{ minHeight: 56, borderBottom: '1px solid rgba(255,255,255,0.04)', background: on ? 'rgba(103,216,242,0.06)' : undefined }}>
                <button aria-label={`Selecionar ${d.name}`} className={`co-check${on ? ' on' : ''}`} onClick={() => toggle(d.id)}>
                  {on ? '✓' : ''}
                </button>
                <button onClick={() => goTab(`doc:${d.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, background: 'none', border: 'none', color: C.text, textAlign: 'left', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <TypeBadge ext={d.ext} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                    <span style={{ fontSize: 11.5, color: d.state === 'ready' ? '#8c92ad' : st.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.state === 'ready' ? d.summary || d.docType || 'Sem resumo' : st.text}</span>
                  </span>
                </button>
                <label style={{ position: 'relative', display: 'flex', minWidth: 0 }}>
                  <span className="sr-only">Categoria de {d.name}</span>
                  <select
                    value={d.category}
                    onChange={(e) => patchCat(d, e.target.value as CompanyCategory)}
                    style={{ appearance: 'none', height: 26, padding: '0 10px', borderRadius: 13, border: '1px solid transparent', background: 'transparent', color: 'transparent', position: 'absolute', inset: 0, width: '100%', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    {COMPANY_CATEGORIES.map((c) => (
                      <option key={c} value={c} style={{ color: '#111' }}>{c}</option>
                    ))}
                  </select>
                  <span style={{ pointerEvents: 'none' }}>
                    <CategoryChip cat={d.category} />
                  </span>
                </label>
                <PipeBar doc={d} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#c9cde0' }}>{d.pages || '—'}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#c9cde0' }}>{d.chunks || '—'}</span>
                <span style={{ fontSize: 12, color: C.t2 }} title={new Date(d.createdAt).toLocaleString('pt-BR')}>{fmtDate(d.createdAt)}</span>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                  <button aria-label={`Ver ${d.name}`} title="Ver" className="co-icon-btn" onClick={() => goTab(`doc:${d.id}`)}>
                    <Svg d={Icon.eye} />
                  </button>
                  <button aria-label={`Reprocessar ${d.name}`} title="Reprocessar" className="co-icon-btn" disabled={d.state === 'processing' || d.state === 'queued'} onClick={() => reprocess([d.id])}>
                    <Svg d={Icon.redo} />
                  </button>
                  <button aria-label={`Excluir ${d.name}`} title="Excluir" className="co-icon-btn danger" onClick={() => setDel([d])}>
                    <Svg d={Icon.trash} />
                  </button>
                </div>
              </div>
            )
          })}
          {!docs && !err && <div style={{ padding: 30, color: C.t2, fontSize: 13 }}>Carregando…</div>}
          {err && <div style={{ padding: 30, color: C.crit, fontSize: 13 }}>{err}</div>}
          {docs && !visible.length && <div style={{ padding: 40, textAlign: 'center', color: '#8c92ad', fontSize: 13.5 }}>{empty}</div>}
        </div>
        <div style={{ minHeight: 40, display: 'flex', alignItems: 'center', gap: 16, padding: '6px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 12, color: C.t2, flexWrap: 'wrap' }}>
          <span>{totals}</span>
          <span style={{ flex: 1 }} />
          <HealthDot ok={stats?.services.docling} label="Docling" />
          <HealthDot ok={stats?.services.postgres} label="PostgreSQL" />
          <HealthDot ok={stats?.services.qdrant} label="Qdrant" />
          <HealthDot ok={stats?.services.openai} label="OpenAI" />
        </div>
      </div>
      {del && <DeleteModal docs={del} busy={deleting} onCancel={() => setDel(null)} onConfirm={confirmDelete} />}
    </div>
  )
}
