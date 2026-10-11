import { useState } from 'react'
import type { ArtifactInfo } from '@shared/protocol'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { C } from '../lib/colors'
import { ago } from '../lib/format'
import { useYui } from '../store/yui'
import { PathPrompt } from '../vault/VaultDialogs'
import { ActionSheet } from './Sheet'
import { ConfirmDeleteModal, Empty, ErrorNote, Skeleton, useHeader } from './ui'

const KIND: Record<ArtifactInfo['kind'], string> = { website: 'Site', report: 'Relatório', chart: 'Gráfico', table: 'Tabela', html: 'Página', image: 'Imagem', other: 'Arquivo' }

type CustomItem = { id: string; title: string; source: string; createdAt: string }

function open(a: ArtifactInfo) {
  const s = useYui.getState()
  if (a.kind === 'report') s.show('report', { artifactId: a.id })
  else if (a.url) s.show('website', { artifactId: a.id, project: a.project ?? undefined })
}

/** Renomear/excluir uma tela sob medida (lista de artefatos e a própria tela). */
export function CustomViewDialogs({ view, action, onClose, onDone }: { view: { id: string; title: string; createdAt?: string }; action: 'rename' | 'delete'; onClose: () => void; onDone: (title?: string) => void }) {
  const [busy, setBusy] = useState(false)
  if (action === 'rename')
    return (
      <PathPrompt
        title="Renomear tela"
        label="Título"
        initial={view.title}
        confirm="Salvar"
        onCancel={onClose}
        onSubmit={(title) => api.patch(`/api/custom/${encodeURIComponent(view.id)}`, { title }).then(() => onDone(title))}
      />
    )
  return (
    <ConfirmDeleteModal
      title="Excluir tela?"
      text="A tela some da lista, junto com a página HTML que o agente gerou para ela."
      rows={[
        { label: 'Tela', value: view.title },
        ...(view.createdAt ? [{ label: 'Criada', value: ago(view.createdAt) }] : []),
      ]}
      busy={busy}
      onCancel={onClose}
      onConfirm={() => {
        setBusy(true)
        api
          .del(`/api/custom/${encodeURIComponent(view.id)}`)
          .then(() => onDone())
          .catch((e: Error) => useYui.getState().say(`Não excluí a tela: ${e.message}`))
          .finally(() => setBusy(false))
      }}
    />
  )
}

const cardStyle = { textAlign: 'left', padding: '18px 20px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', color: C.text, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 } as const
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(220px,100%),1fr))', gap: 14 } as const

interface Entrega { id: string; title: string; kind: string; project: string | null; path: string; runId: string | null; size: number; pinned: boolean; createdAt: string }
const ENTREGA_KIND: Record<string, string> = { image: 'Imagem', table: 'Planilha', html: 'Página', report: 'Relatório', other: 'Arquivo' }
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

// Arquivos entregues pelos agentes (pasta da execução, relatórios, screenshots e o que eles registram).
function Entregas({ list, reload }: { list: Entrega[]; reload: () => void }) {
  const [q, setQ] = useState('')
  const coarse = useYui((s) => s.coarse)
  const shown = list.filter((e) => !q || `${e.title} ${e.project ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const send = (e: Entrega) =>
    api
      .post(`/api/entregas/${e.id}/send`, { channels: ['telegram'] })
      .then(() => useYui.getState().say(`Mandei ${e.title} no Telegram.`))
      .catch((err: Error) => useYui.getState().say(`Não consegui mandar: ${err.message}`))
  const pin = (e: Entrega) => api.post(`/api/entregas/${e.id}/pin`, { pinned: !e.pinned }).then(reload).catch(() => {})
  const h = coarse ? { height: 44 } : undefined
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="eyebrow" style={{ color: C.cyan }}>Entregas dos agentes · {list.length}</div>
        {list.length > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar…" aria-label="Filtrar entregas" style={{ height: 34, padding: '0 10px', borderRadius: 9, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)', color: C.text, fontSize: 13 }} />}
        <span style={{ fontSize: 12, color: C.t3 }}>Fixe o que quiser guardar: as outras saem depois de 30 dias.</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {shown.map((e) => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.05)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,.06)', color: C.t2, flexShrink: 0 }}>{ENTREGA_KIND[e.kind] ?? 'Arquivo'}</span>
            <span style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{e.pinned ? '📌 ' : ''}{e.title}</span>
              <span style={{ fontSize: 12, color: C.t3 }}>{e.project ?? 'Geral'} · {kb(e.size)} · {ago(e.createdAt)}</span>
            </span>
            <a className="app-btn small" style={h} href={`/api/entregas/${e.id}/file`} target="_blank" rel="noreferrer">Abrir</a>
            <a className="app-btn small" style={h} href={`/api/entregas/${e.id}/file?download=1`}>Baixar</a>
            <button className="app-btn small" style={h} onClick={() => void send(e)}>Telegram</button>
            {e.runId && <button className="app-btn small" style={h} onClick={() => useYui.getState().show('runs', { runId: e.runId! })}>Execução</button>}
            <button className="app-btn small" style={h} aria-pressed={e.pinned} onClick={() => void pin(e)}>{e.pinned ? 'Soltar' : 'Fixar'}</button>
          </div>
        ))}
        {!shown.length && <span style={{ fontSize: 13, color: C.t3 }}>Nada com esse filtro.</span>}
      </div>
    </section>
  )
}

export function ArtifactsView() {
  const { data, loading, error } = useApi<ArtifactInfo[]>('/api/artifacts')
  const custom = useApi<CustomItem[]>('/api/custom')
  const entregas = useApi<Entrega[]>('/api/entregas?limit=100')
  const phone = useYui((s) => s.device === 'phone')
  const coarse = useYui((s) => s.coarse)
  const [act, setAct] = useState<{ view: CustomItem; action: 'rename' | 'delete' } | null>(null)
  const [menu, setMenu] = useState<CustomItem | null>(null)
  useHeader('Artifacts', 'Artefatos')
  if ((loading && !data) || (custom.loading && !custom.data)) return <Skeleton kpis={0} rows={5} />
  if (error || !data) return <ErrorNote />
  const views = custom.data ?? []
  const files = entregas.data ?? []
  if (!data.length && !views.length && !files.length) return <Empty text="Ainda não há artefatos." hint="Sites, relatórios, apresentações e telas que a Yui monta aparecem aqui." />
  const openView = (v: CustomItem) => useYui.getState().show('custom', { customId: v.id })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      {files.length > 0 && <Entregas list={files} reload={entregas.reload} />}
      {data.length > 0 && (
        <div style={grid}>
          {data.map((a) => (
            <button key={a.id} onClick={() => open(a)} className="hov-bg2" style={cardStyle}>
              <span className="eyebrow" style={{ color: C.cyan }}>{KIND[a.kind]}</span>
              <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>{a.title}</span>
              <span style={{ fontSize: 12, color: C.t3 }}>{a.project ? `${a.project} · ` : ''}{ago(a.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
      {views.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="eyebrow" style={{ color: C.violet }}>Telas criadas pela Yui · {views.length}</div>
          <div style={grid}>
            {views.map((v) => (
              <div key={v.id} style={{ ...cardStyle, cursor: 'default', padding: 0, gap: 0 }}>
                <button onClick={() => openView(v)} className="hov-bg2" style={{ background: 'none', border: 'none', color: 'inherit', textAlign: 'left', padding: '18px 20px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'inherit', borderRadius: '16px 16px 0 0' }}>
                  <span className="eyebrow" style={{ color: C.lav }}>{v.source === 'yui' ? 'Yui' : 'Agente'}</span>
                  <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>{v.title}</span>
                  <span style={{ fontSize: 12, color: C.t3 }}>{ago(v.createdAt)}</span>
                </button>
                <div style={{ display: 'flex', gap: 6, padding: '0 14px 14px 20px', justifyContent: 'flex-end' }}>
                  {phone ? (
                    <button aria-label={`Ações: ${v.title}`} className="app-btn" style={{ width: 44, height: 44, padding: 0 }} onClick={() => setMenu(v)}>⋯</button>
                  ) : (
                    <>
                      <button className="app-btn small" style={coarse ? { height: 44 } : undefined} onClick={() => setAct({ view: v, action: 'rename' })}>Renomear</button>
                      <button className="app-btn small danger" style={coarse ? { height: 44 } : undefined} onClick={() => setAct({ view: v, action: 'delete' })}>Excluir</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {menu && (
        <ActionSheet
          title={menu.title}
          onClose={() => setMenu(null)}
          actions={[
            { label: 'Abrir', fn: () => openView(menu) },
            { label: 'Renomear', fn: () => setAct({ view: menu, action: 'rename' }) },
            { label: 'Excluir', danger: true, fn: () => setAct({ view: menu, action: 'delete' }) },
          ]}
        />
      )}
      {act && (
        <CustomViewDialogs
          view={act.view}
          action={act.action}
          onClose={() => setAct(null)}
          onDone={() => {
            setAct(null)
            custom.reload()
          }}
        />
      )}
    </div>
  )
}
