import { useEffect, useState } from 'react'
import type { HelpGuideMeta, HelpResults } from '@shared/protocol'
import { api } from '../api/client'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { fmtHours, goHelp, GROUP_ORDER, useHelpIndex } from './api'
import { AskBox, Loading } from './ui'

// Início da Ajuda: Pergunte, "Seu dia com a Yui", guias por grupo, resultados do mês e receitas populares.

const DAY_COLORS = ['#67d8f2', '#a68cf7', '#f5b54a', '#4fe0b0', '#cbbcff']

function MiniResults() {
  const [r, setR] = useState<HelpResults | null>(null)
  useEffect(() => {
    api.get<HelpResults>('/api/help/results?period=month').then(setR).catch(() => {})
  }, [])
  return (
    <button className="hp-card hp-results-mini" onClick={() => goHelp('resultados')}>
      <span style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <span style={{ fontSize: 30, fontWeight: 300, color: C.ok, lineHeight: 1.1 }}>{r ? fmtHours(r.hours) : '—'}</span>
        <span style={{ fontSize: 11.5, color: C.t2 }}>economizadas este mês</span>
      </span>
      <span style={{ fontSize: 12.5, color: '#c9cde0', lineHeight: 1.45, textAlign: 'left' }}>
        {r ? `${r.kpis.runsDone} execuções concluídas, ${r.kpis.workflowsDone} workflows e ${r.kpis.queries} respostas da base.` : 'Carregando seus números…'} Ver resultados →
      </span>
    </button>
  )
}

export function HomeTab() {
  const narrow = useYui((s) => s.narrow)
  const { index, error } = useHelpIndex()
  const groups = GROUP_ORDER.map((g) => ({ g, items: (index?.guias ?? []).filter((x) => x.grupo === g).sort((a, b) => a.ordem - b.ordem) })).filter((x) => x.items.length)
  const others = (index?.guias ?? []).filter((x) => !GROUP_ORDER.includes(x.grupo))
  if (others.length) groups.push({ g: 'Outros', items: others })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <AskBox />
      {!index ? (
        <Loading error={error} />
      ) : (
        <section className="hp-home">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <div className="hp-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Seu dia com a Yui</span>
              {index.dia.map((d, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '54px minmax(0, 1fr)', gap: 10 }}>
                  <span className="app-mono" style={{ fontSize: 11.5, color: DAY_COLORS[i % DAY_COLORS.length], paddingTop: 2 }}>
                    {d.hora}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingBottom: 10, borderBottom: i < index.dia.length - 1 ? '1px solid rgba(255,255,255,.05)' : 'none' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{d.titulo}</span>
                    <span style={{ fontSize: 12.5, color: C.t2, lineHeight: 1.5 }}>{d.texto}</span>
                    {d.frase && <span style={{ fontSize: 12, color: C.lav, fontStyle: 'italic' }}>“{d.frase.replace(/^["“]|["”]$/g, '')}”</span>}
                  </div>
                </div>
              ))}
            </div>
            <MiniResults />
            {index.receitas.length > 0 && (
              <div className="hp-card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Receitas populares</span>
                {index.receitas.slice(0, 5).map((r) => (
                  <button key={r.id} className="hp-link-row" onClick={() => goHelp(`receita:${r.id}`)}>
                    <span style={{ flex: 1, minWidth: 0 }}>{r.titulo}</span>
                    <span style={{ fontSize: 11, color: C.t3, flexShrink: 0 }}>{r.tempo}</span>
                  </button>
                ))}
                <button className="hp-mini ghost" style={{ alignSelf: 'flex-start' }} onClick={() => goHelp('receitas')}>
                  Todas as receitas →
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Guias por ferramenta</span>
              <span style={{ fontSize: 12, color: C.t3 }}>mesma ordem do menu</span>
            </div>
            {groups.map(({ g, items }) => (
              <div key={g} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="hp-eyebrow">{g}</span>
                <div className="hp-guide-grid" style={{ gridTemplateColumns: narrow ? 'minmax(0,1fr)' : undefined }}>
                  {items.map((it: HelpGuideMeta) => (
                    <button key={it.id} className="hp-card hp-guide-card" onClick={() => goHelp(`guia:${it.id}`)}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{it.titulo}</span>
                      <span style={{ fontSize: 11.5, color: C.t2, lineHeight: 1.4 }}>{it.resumo}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
