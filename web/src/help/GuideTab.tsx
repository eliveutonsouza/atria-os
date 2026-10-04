import { useEffect, useState } from 'react'
import type { HelpDoc } from '@shared/protocol'
import { api } from '../api/client'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { asList, asText, goHelp, GROUP_ORDER, openPage, parseSteps, splitSections, unquote, useHelpIndex, useToast } from './api'
import { Loading, Md, PhraseRow, StepList, Toast } from './ui'

// Guia de uma ferramenta: índice lateral, o que é, quando usar, passo a passo, frases para a Yui, dicas e erros.

function Feedback({ id }: { id: string }) {
  const [sent, setSent] = useState(false)
  const send = (util: boolean) => {
    setSent(true)
    api.post('/api/help/feedback', { kind: 'guia', id, util }).catch(() => {})
  }
  if (sent) return <span style={{ fontSize: 12.5, color: C.ok }}>Obrigado! Isso ajuda a melhorar os guias.</span>
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: C.t2, flexWrap: 'wrap' }}>
      <span>Este guia ajudou?</span>
      <button className="hp-mini" onClick={() => send(true)}>
        Sim
      </button>
      <button className="hp-mini" onClick={() => send(false)}>
        Não
      </button>
    </div>
  )
}

export function GuideTab({ id }: { id: string | null }) {
  const narrow = useYui((s) => s.narrow)
  const { index, error } = useHelpIndex()
  const guides = [...(index?.guias ?? [])].sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.grupo)
    const gb = GROUP_ORDER.indexOf(b.grupo)
    return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) || a.ordem - b.ordem
  })
  const current = id ?? guides[0]?.id ?? null
  const [doc, setDoc] = useState<HelpDoc | null>(null)
  const [docErr, setDocErr] = useState<string | null>(null)
  const [toastMsg, showToast] = useToast()

  useEffect(() => {
    if (!current) return
    let alive = true
    setDoc(null)
    setDocErr(null)
    api
      .get<HelpDoc>(`/api/help/doc/guia/${encodeURIComponent(current)}`)
      .then((d) => alive && setDoc(d))
      .catch((e: Error) => alive && setDocErr(e.message))
    return () => {
      alive = false
    }
  }, [current])

  if (!index) return <Loading error={error} />
  if (!guides.length) return <div style={{ padding: 24, color: C.t2, fontSize: 13.5 }}>Nenhum guia publicado ainda.</div>

  const groups = [...new Set(guides.map((g) => g.grupo))]
  const meta = guides.find((g) => g.id === current)
  const m = doc?.meta ?? {}
  const sections = doc ? splitSections(doc.markdown) : []
  const frases = asList(m.frases).map(unquote)
  const dicas = asList(m.dicas)
  const erros = asList(m.erros)
  const rel = asList(m.relacionados)
    .map((r) => guides.find((g) => g.id === r.trim()))
    .filter((g): g is NonNullable<typeof g> => !!g)
  const usar = asText(m.usar_quando)
  const naoUsar = asText(m.nao_usar_quando)

  const toc = narrow ? (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: C.t2 }}>
      Guia
      <select className="hp-input" value={current ?? ''} onChange={(e) => goHelp(`guia:${e.target.value}`)} style={{ height: 46 }}>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {guides
              .filter((x) => x.grupo === g)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.titulo}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  ) : (
    <nav aria-label="Guias" className="hp-toc">
      {groups.map((g) => (
        <div key={g} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span className="hp-eyebrow" style={{ padding: '8px 10px 4px' }}>
            {g}
          </span>
          {guides
            .filter((x) => x.grupo === g)
            .map((x) => (
              <button key={x.id} className={`hp-toc-item${x.id === current ? ' on' : ''}`} aria-current={x.id === current ? 'page' : undefined} onClick={() => goHelp(`guia:${x.id}`)}>
                {x.titulo}
              </button>
            ))}
        </div>
      ))}
    </nav>
  )

  const aside = doc && (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {dicas.length > 0 && (
        <div className="hp-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Dicas</span>
          {dicas.map((t) => (
            <span key={t} style={{ fontSize: 12.5, color: '#c9cde0', lineHeight: 1.5 }}>
              • {t}
            </span>
          ))}
        </div>
      )}
      {erros.length > 0 && (
        <div className="hp-card" style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(240,98,114,.06)', borderColor: 'rgba(240,98,114,.24)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#f39aa4' }}>Erros comuns</span>
          {erros.map((t) => (
            <span key={t} style={{ fontSize: 12.5, color: '#dfe3f3', lineHeight: 1.5 }}>
              • {t}
            </span>
          ))}
        </div>
      )}
      {rel.length > 0 && (
        <div className="hp-card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Veja também</span>
          {rel.map((g) => (
            <button key={g.id} className="hp-link" onClick={() => goHelp(`guia:${g.id}`)}>
              Guia: {g.titulo}
            </button>
          ))}
        </div>
      )}
      <Feedback key={current} id={current ?? ''} />
    </aside>
  )

  return (
    <section className="hp-guide" style={{ gridTemplateColumns: narrow ? 'minmax(0,1fr)' : undefined }}>
      {toc}
      <article style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {docErr && <div style={{ color: C.crit, fontSize: 13.5 }}>Não consegui abrir este guia: {docErr}</div>}
        {!doc && !docErr && <Loading error={null} />}
        {doc && (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: '1 1 320px' }}>
                <span className="hp-eyebrow" style={{ color: C.violet }}>
                  {meta?.grupo ?? 'Guia'} · guia
                </span>
                <h2 style={{ margin: 0, fontSize: narrow ? 22 : 26, fontWeight: 700 }}>{doc.titulo}</h2>
                {asText(m.resumo) && <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: '#c9cde0', maxWidth: 680 }}>{asText(m.resumo)}</p>}
              </div>
              {doc.pagina && doc.pagina !== 'help' && (
                <button className="app-btn primary" style={{ height: 42, padding: '0 16px', borderRadius: 12 }} onClick={() => openPage(doc.pagina!)}>
                  Abrir {doc.titulo}
                </button>
              )}
            </div>
            {(usar || naoUsar) && (
              <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'repeat(2, minmax(0,1fr))', gap: 12 }}>
                {usar && (
                  <div className="hp-when ok">
                    <span className="hp-when-h">Use quando</span>
                    <span>{usar}</span>
                  </div>
                )}
                {naoUsar && (
                  <div className="hp-when warn">
                    <span className="hp-when-h">Não use quando</span>
                    <span>{naoUsar}</span>
                  </div>
                )}
              </div>
            )}
            {sections.map((s, i) =>
              /passo a passo/i.test(s.title) ? (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <h3 className="hp-h3">{s.title}</h3>
                  <StepList steps={parseSteps(s.body)} onToast={showToast} />
                </div>
              ) : (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {s.title && <h3 className="hp-h3">{s.title}</h3>}
                  <Md md={s.body} />
                </div>
              ),
            )}
            {frases.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h3 className="hp-h3">Diga para a Yui</h3>
                {frases.map((f) => (
                  <PhraseRow key={f} text={f} onToast={showToast} />
                ))}
              </div>
            )}
            {narrow && aside}
          </>
        )}
      </article>
      {!narrow && (aside || <div />)}
      <Toast msg={toastMsg} />
    </section>
  )
}
