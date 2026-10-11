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
import { Entregas } from './Entregas'

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

export function ArtifactsView() {
  const { data, loading, error } = useApi<ArtifactInfo[]>('/api/artifacts')
  const custom = useApi<CustomItem[]>('/api/custom')
  const entregas = useApi<{ id: string }[]>('/api/entregas?limit=1')
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
      {files.length > 0 && <Entregas />}
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
