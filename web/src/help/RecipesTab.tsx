import { useEffect, useState } from 'react'
import type { HelpDoc } from '@shared/protocol'
import { api } from '../api/client'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { asText, goHelp, parseSteps, sendToYui, splitSections, unquote, useHelpIndex, useToast } from './api'
import { Loading, Md, StepList, Toast } from './ui'

// Receitas "Como faço para…": lista à esquerda, passo a passo à direita, botão para começar com a Yui.

const CAT_COLOR: Record<string, string> = {
  Comercial: '#f5b54a',
  Projetos: '#67d8f2',
  Rotina: '#4fe0b0',
  Conteúdo: '#f78cc8',
  Conhecimento: '#cbbcff',
  Celular: '#a68cf7',
}

export function RecipesTab({ id }: { id: string | null }) {
  const narrow = useYui((s) => s.narrow)
  const { index, error } = useHelpIndex()
  const list = index?.receitas ?? []
  const current = id ?? (narrow ? null : list[0]?.id ?? null)
  const [doc, setDoc] = useState<HelpDoc | null>(null)
  const [docErr, setDocErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toastMsg, showToast] = useToast()

  useEffect(() => {
    if (!current) return
    let alive = true
    setDoc(null)
    setDocErr(null)
    api
      .get<HelpDoc>(`/api/help/doc/receita/${encodeURIComponent(current)}`)
      .then((d) => alive && setDoc(d))
      .catch((e: Error) => alive && setDocErr(e.message))
    return () => {
      alive = false
    }
  }, [current])

  if (!index) return <Loading error={error} />
  if (!list.length) return <div style={{ padding: 24, color: C.t2, fontSize: 13.5 }}>Nenhuma receita publicada ainda.</div>

  const m = doc?.meta ?? {}
  const color = CAT_COLOR[asText(m.categoria)] ?? C.warn
  const frase = unquote(asText(m.frase))
  const sections = doc ? splitSections(doc.markdown) : []

  const listEl = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Como faço para…</span>
      {list.map((r) => (
        <button key={r.id} className={`hp-recipe${r.id === current ? ' on' : ''}`} onClick={() => goHelp(`receita:${r.id}`)}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLOR[r.categoria] ?? C.t3, flexShrink: 0 }} />
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{r.titulo}</span>
            <span style={{ fontSize: 11.5, color: C.t3 }}>
              {r.ferramentas}
              {r.tempo ? ` · ${r.tempo}` : ''}
            </span>
          </span>
        </button>
      ))}
    </div>
  )

  const detail = current && (
    <article className="hp-card" style={{ padding: narrow ? 16 : '20px 22px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {narrow && (
        <button className="hp-mini ghost" style={{ alignSelf: 'flex-start' }} onClick={() => goHelp('receitas')}>
          ← Todas as receitas
        </button>
      )}
      {docErr && <div style={{ color: C.crit, fontSize: 13.5 }}>Não consegui abrir esta receita: {docErr}</div>}
      {!doc && !docErr && <Loading error={null} />}
      {doc && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 320px', minWidth: 0 }}>
              <span className="hp-eyebrow" style={{ color }}>
                Receita · {asText(m.categoria) || 'dia a dia'}
              </span>
              <h2 style={{ margin: 0, fontSize: narrow ? 20 : 22, fontWeight: 700 }}>{doc.titulo}</h2>
              <span style={{ fontSize: 13, color: C.t2 }}>
                {asText(m.ferramentas) && `Usa: ${asText(m.ferramentas)}`}
                {asText(m.tempo) && ` — leva ${asText(m.tempo)}`}
              </span>
            </div>
            {frase && (
              <button
                className="app-btn primary"
                disabled={busy}
                style={{ height: 42, padding: '0 16px', borderRadius: 12, width: narrow ? '100%' : undefined }}
                onClick={() => {
                  setBusy(true)
                  sendToYui(frase)
                    .then(() => showToast('Enviado — acompanhe na Yui.'))
                    .catch(() => showToast('Não consegui enviar.'))
                    .finally(() => setBusy(false))
                }}
              >
                Fazer agora com a Yui
              </button>
            )}
          </div>
          {(asText(m.antes) || asText(m.resultado)) && (
            <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'repeat(2, minmax(0,1fr))', gap: 12 }}>
              {asText(m.antes) && (
                <div className="hp-when cyan">
                  <span className="hp-when-h">Antes</span>
                  <span>{asText(m.antes)}</span>
                </div>
              )}
              {asText(m.resultado) && (
                <div className="hp-when ok">
                  <span className="hp-when-h">Resultado</span>
                  <span>{asText(m.resultado)}</span>
                </div>
              )}
            </div>
          )}
          {frase && <span style={{ fontSize: 12.5, color: C.lav }}>Começa com: “{frase}”</span>}
          {sections.map((s, i) =>
            /passo a passo/i.test(s.title) || (!s.title && /^\d+[.)]/m.test(s.body)) ? (
              <StepList key={i} steps={parseSteps(s.body)} color={color} onToast={showToast} />
            ) : (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {s.title && <h3 className="hp-h3">{s.title}</h3>}
                <Md md={s.body} />
              </div>
            ),
          )}
        </>
      )}
    </article>
  )

  if (narrow) return current ? <div>{detail}<Toast msg={toastMsg} /></div> : listEl
  return (
    <section className="hp-recipes">
      {listEl}
      {detail}
      <Toast msg={toastMsg} />
    </section>
  )
}
