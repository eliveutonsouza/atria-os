import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COMPANY_CATEGORIES, type CompanyCategory, type CompanyChunk, type CompanyDoc, type CompanyDocPage, type CompanyUse } from '@shared/protocol'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { api } from '../api/client'
import { onCompanyEvent } from '../api/events'
import { C } from '../lib/colors'
import { toastErr, toastOk, useAction, useUnsavedGuard } from '../lib/feedback'
import { useYui } from '../store/yui'
import { ErrorNote } from '../views/ui'
import { renderNote } from '../vault/markdown'
import '../vault/vault.css'
import { CAT_COLORS, fmtDate, fmtSize, goTab, isImage, isPdf, noExt, statusOf, Icon, useStacked } from './api'
import { DeleteModal, PipeBar, Svg, TypeBadge } from './ui'

// Detalhe do documento (DocDetail.dc.html): página com as caixas do Docling, dados extraídos,
// texto (OCR), trechos indexados e uso pela IA.

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Tab = 'data' | 'text' | 'chunks' | 'use'

const BOX_COLOR: Record<string, [string, string]> = {
  table: ['rgba(245,181,74,0.95)', 'rgba(245,181,74,0.12)'],
  picture: ['rgba(247,140,200,0.9)', 'rgba(247,140,200,0.08)'],
  title: ['rgba(166,140,247,0.95)', 'rgba(166,140,247,0.12)'],
  text: ['rgba(103,216,242,0.85)', 'rgba(103,216,242,0.08)'],
  list: ['rgba(103,216,242,0.85)', 'rgba(103,216,242,0.08)'],
}

function Boxes({ page, show }: { page: CompanyDocPage | undefined; show: boolean }) {
  if (!page || !show) return null
  return (
    <>
      {page.boxes.map((b, i) => {
        const [bd, bg] = BOX_COLOR[b.kind] ?? BOX_COLOR.text
        return <span key={i} title={b.kind} style={{ position: 'absolute', left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, border: `1.5px solid ${bd}`, background: bg, borderRadius: 2, pointerEvents: 'none' }} />
      })}
    </>
  )
}

function PdfViewer({ url, pageNo, width, onPages }: { url: string; pageNo: number; width: number; onPages: (n: number) => void }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const task = pdfjs.getDocument({ url, withCredentials: true })
    task.promise
      .then((d) => {
        if (!alive) return
        setDoc(d)
        onPages(d.numPages)
      })
      .catch((e: Error) => alive && setErr(e.message))
    return () => {
      alive = false
      task.destroy().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])
  useEffect(() => {
    if (!doc || !cv.current) return
    let task: pdfjs.RenderTask | null = null
    let alive = true
    doc.getPage(Math.min(pageNo, doc.numPages)).then((p) => {
      if (!alive || !cv.current) return
      const base = p.getViewport({ scale: 1 })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const vp = p.getViewport({ scale: (width / base.width) * dpr })
      const c = cv.current
      c.width = vp.width
      c.height = vp.height
      c.style.width = `${width}px`
      c.style.height = `${vp.height / dpr}px`
      task = p.render({ canvas: c, viewport: vp })
      task.promise.catch(() => {})
    })
    return () => {
      alive = false
      task?.cancel()
    }
  }, [doc, pageNo, width])
  if (err) return <div style={{ color: C.t2, fontSize: 13, padding: 20, width }}>Não consegui abrir o PDF: {err}</div>
  return <canvas ref={cv} style={{ display: 'block', background: '#fff', borderRadius: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }} />
}

export function DocDetail({ id }: { id: string }) {
  const narrow = useYui((s) => s.narrow)
  const stacked = useStacked()
  const [doc, setDoc] = useState<CompanyDoc | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pages, setPages] = useState<CompanyDocPage[]>([])
  const [pdfPages, setPdfPages] = useState(0)
  const [pageNo, setPageNo] = useState(1)
  const [showBoxes, setShowBoxes] = useState(true)
  const [tab, setTab] = useState<Tab>('data')
  const [del, setDel] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [dataDirty, setDataDirty] = useState(false)
  const [goPage, setGoPage] = useState('')
  const confirmLeave = useUnsavedGuard(dataDirty, 'os dados editados')
  const viewerRef = useRef<HTMLDivElement>(null)
  const [vw, setVw] = useState(360)

  const load = useCallback(() => {
    api.get<CompanyDoc>(`/api/company/documents/${id}`).then((d) => {
      setDoc(d)
      setErr(null)
    }).catch((e: Error) => setErr(e.message === 'not found' ? 'Documento não encontrado (talvez tenha sido excluído).' : e.message))
    api.get<CompanyDocPage[]>(`/api/company/documents/${id}/pages`).then(setPages).catch(() => setPages([]))
  }, [id])
  useEffect(() => {
    load()
    return onCompanyEvent((ev) => {
      if (ev.type === 'company.doc.updated' && ev.doc.id === id) {
        setDoc(ev.doc)
        if (ev.doc.state === 'ready') api.get<CompanyDocPage[]>(`/api/company/documents/${id}/pages`).then(setPages).catch(() => {})
      }
      if (ev.type === 'company.doc.deleted' && ev.id === id) goTab('documentos')
    })
  }, [id, load])

  // largura disponível do visualizador
  useEffect(() => {
    const el = viewerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setVw(Math.max(220, Math.min(560, el.clientWidth - 32))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc?.id])

  const patch = (body: Partial<Pick<CompanyDoc, 'category' | 'fields' | 'summary' | 'tags'>>) =>
    api.patch<CompanyDoc>(`/api/company/documents/${id}`, body).then((d) => {
      setDoc(d)
      toastOk('Salvo.')
    }).catch((e: unknown) => toastErr(e, 'Não consegui salvar'))
  const { run: reprocess, busy: reprocessing } = useAction(
    async () => {
      const d = await api.post<CompanyDoc>(`/api/company/documents/${id}/reprocess`)
      if (d) setDoc(d)
    },
    { ok: 'Reprocessando — aviso quando terminar.', error: 'Não consegui reprocessar' },
  )
  const remove = () => {
    setDeleting(true)
    api.del(`/api/company/documents/${id}`).then(() => goTab('documentos')).catch((e: unknown) => {
      toastErr(e, 'Não consegui excluir')
      setDeleting(false)
      setDel(false)
    })
  }
  // sair da aba Dados (ou da página) com edição não salva pergunta antes
  const leaveTo = async (go: () => void) => {
    if (tab === 'data' && !(await confirmLeave())) return
    setDataDirty(false)
    go()
  }

  if (err) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ color: C.crit, fontSize: 14 }}>{err}</div>
        <button className="app-btn" onClick={() => goTab('documentos')}>← Documentos</button>
      </div>
    )
  }
  if (!doc) return <div style={{ color: C.t2, fontSize: 13 }}>Carregando…</div>

  const fileUrl = `/api/company/documents/${id}/file`
  const pdf = isPdf(doc)
  const img = isImage(doc)
  const totalPages = pdf ? pdfPages || doc.pages : img ? 1 : doc.pages
  const curPage = pages.find((p) => p.page === pageNo)
  const thumbStart = Math.floor((pageNo - 1) / 60) * 60 + 1
  const st = statusOf(doc)
  const stateChip =
    doc.state === 'ready' ? ['rgba(79,224,176,0.12)', '#7ff0c8', '#4fe0b0', 'Pronto'] : doc.state === 'error' ? ['rgba(240,98,114,0.12)', '#f39aa4', '#f06272', 'Erro'] : ['rgba(103,216,242,0.12)', '#a9e9f8', '#67d8f2', doc.state === 'queued' ? 'Na fila' : 'Processando']
  const [cbg, cfg] = CAT_COLORS[doc.category] ?? CAT_COLORS.Outros

  const viewer = (
    <div className="co-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: stacked ? 0 : 560 }}>
      <div style={{ minHeight: 42, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '6px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 12.5, color: C.t2, flexWrap: 'wrap' }}>
        <span>{totalPages ? `Página ${pageNo} de ${totalPages}` : 'Sem páginas'}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} />
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(103,216,242,0.35)' }} />
          texto
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(245,181,74,0.35)', marginLeft: 4 }} />
          tabela
        </label>
      </div>
      <div ref={viewerRef} data-own-scroll style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, background: '#070814', overflow: 'auto', minHeight: narrow ? 160 : 300 }}>
        {pdf ? (
          <div style={{ position: 'relative' }}>
            <PdfViewer url={fileUrl} pageNo={pageNo} width={vw} onPages={setPdfPages} />
            <Boxes page={curPage} show={showBoxes} />
          </div>
        ) : img ? (
          <div style={{ position: 'relative', width: vw }}>
            <img src={fileUrl} alt={doc.name} style={{ display: 'block', width: '100%', borderRadius: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }} />
            <Boxes page={pages[0]} show={showBoxes} />
          </div>
        ) : (
          <div style={{ alignSelf: 'center', textAlign: 'center', color: C.t2, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            <TypeBadge ext={doc.ext} size={1.6} />
            Sem prévia para {doc.ext.toUpperCase()} — veja a aba Texto.
          </div>
        )}
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, padding: '10px 14px 0', alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, color: C.t2 }}>
          <button className="app-btn small" disabled={pageNo <= 1} onClick={() => setPageNo(pageNo - 1)}>‹ Anterior</button>
          <button className="app-btn small" disabled={pageNo >= totalPages} onClick={() => setPageNo(pageNo + 1)}>Próxima ›</button>
          <form
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault()
              const n = Number.parseInt(goPage, 10)
              if (n >= 1 && n <= totalPages) setPageNo(n)
              setGoPage('')
            }}
          >
            <label htmlFor="co-go-page">Ir para página</label>
            <input id="co-go-page" className="co-input" type="number" inputMode="numeric" min={1} max={totalPages} value={goPage} onChange={(e) => setGoPage(e.target.value)} placeholder={String(pageNo)} style={{ width: 72, height: 32, fontSize: narrow ? 16 : 13 }} />
            <button className="app-btn small" type="submit" disabled={!goPage}>Ir</button>
          </form>
        </div>
      )}
      <div data-own-scroll style={{ display: 'flex', gap: 8, padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', alignItems: 'center', overflowX: 'auto' }}>
        {totalPages > 1 &&
          // miniaturas em blocos de 60 em volta da página atual
          Array.from({ length: Math.min(totalPages - thumbStart + 1, 60) }, (_, i) => thumbStart + i).map((n) => (
            <button
              key={n}
              aria-label={`Página ${n}`}
              aria-current={n === pageNo}
              onClick={() => setPageNo(n)}
              style={{ width: 40, height: 52, flexShrink: 0, borderRadius: 5, border: `2px solid ${n === pageNo ? C.cyan : 'transparent'}`, background: '#e9e9e4', color: '#14152a', fontSize: 12, fontWeight: 700, cursor: 'pointer', position: 'relative' }}
            >
              {n}
              {pages.find((p) => p.page === n)?.ocr && <span title="OCR" style={{ position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: '50%', background: C.violet }} />}
            </button>
          ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: '#8c92ad', textAlign: 'right', whiteSpace: 'nowrap' }}>
          {doc.ocrPages ? `${doc.ocrPages} ${doc.ocrPages === 1 ? 'página lida' : 'páginas lidas'} da imagem (OCR)` : 'Texto digital, sem OCR'}
        </span>
      </div>
    </div>
  )

  const tabs: [Tab, string][] = [
    ['data', 'Dados extraídos'],
    ['text', 'Texto (OCR)'],
    ['chunks', `Trechos · ${doc.chunks}`],
    ['use', 'Uso pela IA'],
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {narrow && (
        <button className="app-btn" style={{ height: 44, alignSelf: 'flex-start' }} onClick={() => leaveTo(() => goTab('documentos'))}>
          ‹ Documentos
        </button>
      )}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: '1 1 360px' }}>
          <nav aria-label="Trilha" style={{ display: narrow ? 'none' : 'flex', gap: 8, fontSize: 12, color: C.t2, minWidth: 0 }}>
            <button className="vault-link-btn" style={{ padding: 0 }} onClick={() => leaveTo(() => goTab('perfil'))}>Empresa</button>
            <span>›</span>
            <button className="vault-link-btn" style={{ padding: 0 }} onClick={() => leaveTo(() => goTab('documentos'))}>Documentos</button>
            <span>›</span>
            <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</span>
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <TypeBadge ext={doc.ext} />
            <h2 style={{ margin: 0, fontSize: narrow ? 18 : 22, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{doc.name}</h2>
            <span style={{ height: 24, padding: '0 10px', borderRadius: 12, background: stateChip[0], color: stateChip[1], fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: stateChip[2] }} />
              {stateChip[3]}
            </span>
          </div>
          <span style={{ fontSize: 12, color: C.t3 }}>
            {fmtSize(doc.size)} · enviado {fmtDate(doc.createdAt)}
            {doc.docType ? ` · ${doc.docType}` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: C.t2 }}>
            Categoria
            <select className="co-input" value={doc.category} onChange={(e) => patch({ category: e.target.value as CompanyCategory })} style={{ width: 'auto', height: 36, fontSize: narrow ? 16 : 13, color: cfg, background: cbg }}>
              {COMPANY_CATEGORIES.map((c) => (
                <option key={c} value={c} style={{ color: '#111' }}>{c}</option>
              ))}
            </select>
          </label>
          <a className="app-btn" href={fileUrl} download={doc.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36 }}>
            <Svg d={Icon.download} size={14} /> Baixar original
          </a>
          <button className="app-btn" disabled={reprocessing || doc.state === 'processing' || doc.state === 'queued'} onClick={() => reprocess()} style={{ height: 36 }}>
            {reprocessing ? 'Reprocessando…' : 'Reprocessar'}
          </button>
          <button className="app-btn danger" onClick={() => setDel(true)} style={{ height: 36, fontWeight: 600 }}>
            Excluir
          </button>
        </div>
      </header>

      {doc.state !== 'ready' && (
        <div className="co-card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: st.color, overflowWrap: 'anywhere' }}>{st.text}</span>
          <PipeBar doc={doc} showText={false} />
        </div>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: stacked ? 'minmax(0,1fr)' : 'minmax(320px, 420px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        {viewer}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div role="tablist" aria-label="Seções do documento" className="co-seg">
            {tabs.map(([t, l]) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => t !== tab && void leaveTo(() => setTab(t))}>
                {l}
              </button>
            ))}
          </div>
          {tab === 'data' && <DataTab doc={doc} narrow={narrow} onSave={patch} onDirty={setDataDirty} />}
          {tab === 'text' && <TextTab id={id} />}
          {tab === 'chunks' && <ChunksTab id={id} />}
          {tab === 'use' && <UsesTab id={id} />}
        </div>
      </section>
      {del && <DeleteModal docs={[doc]} busy={deleting} onCancel={() => setDel(false)} onConfirm={remove} />}
    </div>
  )
}

function DataTab({ doc, narrow, onSave, onDirty }: { doc: CompanyDoc; narrow: boolean; onSave: (b: Partial<Pick<CompanyDoc, 'fields' | 'summary' | 'tags'>>) => Promise<void>; onDirty: (dirty: boolean) => void }) {
  const [fields, setFields] = useState(doc.fields)
  const [summary, setSummary] = useState(doc.summary ?? '')
  const [saving, setSaving] = useState(false)
  // documento mudou no servidor (reprocessado): recarrega os campos
  const sig = `${doc.updatedAt}`
  const [lastSig, setLastSig] = useState(sig)
  if (sig !== lastSig) {
    setLastSig(sig)
    setFields(doc.fields)
    setSummary(doc.summary ?? '')
  }
  const dirty = JSON.stringify(fields) !== JSON.stringify(doc.fields) || summary !== (doc.summary ?? '')
  useEffect(() => onDirty(dirty), [dirty, onDirty])
  const save = () => {
    setSaving(true)
    onSave({ fields: fields.filter((f) => f.key.trim() || f.value.trim()), summary }).finally(() => setSaving(false))
  }
  const vaultNote = `Empresa/${doc.category}/${noExt(doc.name)}.md`
  const pipe = doc.timings

  return (
    <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'minmax(0, 1fr) 290px', gap: 14, alignItems: 'start' }}>
      <div className="co-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Dados extraídos</span>
          <span style={{ fontSize: 11.5, color: '#8c92ad' }}>gerado pela IA · editável</span>
        </div>
        {doc.state !== 'ready' && !doc.summary ? (
          <span style={{ fontSize: 13, color: C.t2 }}>Os dados aparecem quando a leitura terminar.</span>
        ) : (
          <>
            <label className="co-label">
              Resumo
              <textarea className="co-input" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} style={{ background: 'rgba(103,216,242,0.06)', borderColor: 'rgba(103,216,242,0.18)', color: '#dfe3f3' }} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : '160px minmax(0, 1fr) 32px', gap: 8, alignItems: 'center' }}>
              {fields.map((f, i) => (
                <div key={i} style={{ display: 'contents' }}>
                  <input className="co-input" aria-label={`Campo ${i + 1}`} value={f.key} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} style={{ height: 34, fontSize: narrow ? 16 : 13, color: C.t2 }} />
                  <input className="co-input" aria-label={`Valor de ${f.key || `campo ${i + 1}`}`} value={f.value} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} style={{ height: 34, fontSize: narrow ? 16 : 13 }} />
                  <button aria-label={`Remover ${f.key || 'campo'}`} className="co-icon-btn danger" onClick={() => setFields(fields.filter((_, j) => j !== i))}>
                    <Svg d={Icon.trash} size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="app-btn small" onClick={() => setFields([...fields, { key: '', value: '' }])}>+ Campo</button>
              {dirty && (
                <button className="app-btn small primary" disabled={saving} onClick={save}>
                  {saving ? 'Salvando…' : 'Salvar dados'}
                </button>
              )}
            </div>
            {!!doc.entities.length && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="co-eyebrow" style={{ color: C.warn }}>Entidades encontradas</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {doc.entities.map((e, i) => (
                    <span key={i} style={{ height: 26, padding: '0 10px', borderRadius: 13, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
                      <span style={{ color: C.t3 }}>{e.type}</span>
                      <span style={{ color: '#dfe3f3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.value}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {!!doc.tags.length && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {doc.tags.map((t) => (
                  <span key={t} className="vtag">#{t}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div className="co-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Pipeline</span>
          {pipe.length ? (
            pipe.map((p, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', gap: 10, alignItems: 'center' }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(79,224,176,0.14)', color: C.ok, fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, color: C.text }}>{p.label}</span>
                  {p.detail && <span style={{ fontSize: 11, color: '#8c92ad', overflowWrap: 'anywhere' }}>{p.detail}</span>}
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.t2 }}>{p.ms < 1000 ? `${p.ms} ms` : `${(p.ms / 1000).toFixed(1).replace('.', ',')} s`}</span>
              </div>
            ))
          ) : (
            <PipeBar doc={doc} />
          )}
        </div>
        {doc.state === 'ready' && (
          <div style={{ padding: 16, borderRadius: 16, background: 'rgba(166,140,247,0.06)', border: '1px solid rgba(166,140,247,0.22)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Também no vault</span>
            <span style={{ fontSize: 12.5, color: '#c9cde0', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
              Virou a nota <span style={{ color: C.lav }}>{vaultNote.replace(/\.md$/, '')}</span> e aparece no Cérebro, ligada à nota Empresa.
            </span>
            <button className="app-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => useYui.getState().set({ appPage: 'vault', appParams: { id: vaultNote } })}>
              Abrir no vault →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function TextTab({ id }: { id: string }) {
  const narrow = useYui((s) => s.narrow)
  const [md, setMd] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    api.get<{ markdown: string }>(`/api/company/documents/${id}/text`).then((r) => setMd(r.markdown)).catch((e: Error) => setErr(e.message))
  }, [id])
  const html = useMemo(() => (md ? renderNote(md) : ''), [md])
  if (err) return <div style={{ color: C.crit, fontSize: 13 }}>{err}</div>
  if (md === null) return <div style={{ color: C.t2, fontSize: 13 }}>Carregando…</div>
  if (!md.trim()) return <div style={{ color: C.t2, fontSize: 13 }}>Ainda sem texto — a leitura não terminou.</div>
  return (
    <div className="co-card" style={{ display: 'flex', overflow: 'hidden', maxHeight: narrow ? 'calc(var(--vvh) - var(--tabbar) - 120px)' : 'calc(100dvh - 300px)', minHeight: narrow ? 200 : 300 }}>
      <article className="vault-read app-scroll" style={{ background: 'transparent' }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

function ChunksTab({ id }: { id: string }) {
  const [chunks, setChunks] = useState<CompanyChunk[] | null>(null)
  const [err, setErr] = useState(false)
  const load = useCallback(() => {
    setErr(false)
    api.get<CompanyChunk[]>(`/api/company/documents/${id}/chunks`).then(setChunks).catch(() => setErr(true))
  }, [id])
  useEffect(load, [load])
  if (err) return <ErrorNote text="Não consegui carregar os trechos." retry={load} />
  if (!chunks) return <div style={{ color: C.t2, fontSize: 13 }}>Carregando…</div>
  if (!chunks.length) return <div style={{ color: C.t2, fontSize: 13 }}>Nenhum trecho indexado ainda.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {chunks.map((c) => (
        <div key={c.id} className="co-card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 10, fontFamily: 'var(--mono)', fontSize: 11, color: '#8c92ad', flexWrap: 'wrap' }}>
            <span style={{ color: C.cyan }}>#{c.ord + 1}</span>
            {c.page != null && <span>pág. {c.page}</span>}
            <span style={{ flex: 1 }} />
            <details>
              <summary style={{ cursor: 'pointer' }}>Detalhes técnicos</summary>
              {c.tokens} tokens · {c.kind} · vetor 1536d · qdrant
            </details>
          </div>
          <span style={{ fontSize: 13, color: '#dfe3f3', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.text}</span>
        </div>
      ))}
    </div>
  )
}

function UsesTab({ id }: { id: string }) {
  const narrow = useYui((s) => s.narrow)
  const [uses, setUses] = useState<CompanyUse[] | null>(null)
  const [err, setErr] = useState(false)
  const load = useCallback(() => {
    setErr(false)
    api.get<CompanyUse[]>(`/api/company/documents/${id}/uses`).then(setUses).catch(() => setErr(true))
  }, [id])
  useEffect(load, [load])
  if (err) return <ErrorNote text="Não consegui carregar quem usou este documento." retry={load} />
  if (!uses) return <div style={{ color: C.t2, fontSize: 13 }}>Carregando…</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 12.5, color: C.t2 }}>Quando a Yui ou um agente usou este documento</span>
      {!uses.length && <span style={{ fontSize: 13, color: C.t3 }}>Ninguém consultou este documento ainda.</span>}
      {uses.map((u, i) => {
        const c = u.who === 'Yui' ? C.cyan : u.who === 'Painel' ? C.t2 : C.violet
        const score = u.score == null ? '' : `score ${u.score.toFixed(2).replace('.', ',')}`
        // celular: cartão empilhado (quem · quando · score em cima, pergunta embaixo)
        if (narrow)
          return (
            <div key={i} className="co-card" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', fontSize: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ color: c, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{u.who}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: '#8c92ad', flexShrink: 0 }}>{fmtDate(u.at)}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: C.t2, flexShrink: 0 }}>{score}</span>
              </div>
              <span style={{ color: '#dfe3f3', overflowWrap: 'anywhere', lineHeight: 1.45 }}>{u.query}</span>
            </div>
          )
        return (
          <div key={i} className="co-card" style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 90px) minmax(80px, 120px) minmax(0, 1fr) 80px', gap: 12, alignItems: 'center', padding: '12px 14px', fontSize: 13 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: '#8c92ad' }}>{fmtDate(u.at)}</span>
            <span style={{ color: c, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.who}</span>
            <span style={{ color: '#dfe3f3', overflowWrap: 'anywhere' }}>{u.query}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: C.t2, textAlign: 'right' }}>{score}</span>
          </div>
        )
      })}
    </div>
  )
}
