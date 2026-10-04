import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { useHelpIndex } from './api'
import { AskBox, Loading, Md } from './ui'

// Perguntas frequentes: filtro + acordeão por categoria; ao lado, Pergunte e as dúvidas ainda sem guia.

export function FaqTab() {
  const narrow = useYui((s) => s.narrow)
  const { index, error } = useHelpIndex()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [unanswered, setUnanswered] = useState<{ pergunta: string; at: string }[]>([])

  useEffect(() => {
    api
      .get<{ pergunta: string; at: string }[]>('/api/help/unanswered')
      .then(setUnanswered)
      .catch(() => {})
  }, [])

  if (!index) return <Loading error={error} />
  const needle = q.trim().toLowerCase()
  const items = index.faq.filter((f) => !needle || `${f.pergunta} ${f.resposta} ${f.categoria}`.toLowerCase().includes(needle))
  const cats = [...new Set(items.map((f) => f.categoria))]
  const first = items[0] ? `${items[0].categoria}:${items[0].pergunta}` : null
  const isOpen = (k: string) => (open === null ? k === first && !needle : open === k) || (!!needle && items.length <= 3)

  return (
    <section className="hp-faq" style={{ gridTemplateColumns: narrow ? 'minmax(0,1fr)' : undefined }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <label style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: 12, color: C.t2, display: 'flex' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </span>
          <span className="sr-only">Filtrar perguntas</span>
          <input className="hp-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar perguntas…" style={{ paddingLeft: 36, height: 42 }} />
        </label>
        {!items.length && <div style={{ padding: 12, fontSize: 13.5, color: C.t2 }}>Nenhuma pergunta com esse filtro. Pergunte à Yui ao lado.</div>}
        {cats.map((c) => (
          <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="hp-eyebrow" style={{ paddingTop: 6 }}>
              {c}
            </span>
            {items
              .filter((f) => f.categoria === c)
              .map((f) => {
                const k = `${f.categoria}:${f.pergunta}`
                const on = isOpen(k)
                return (
                  <div key={k} className="hp-faq-item">
                    <button aria-expanded={on} onClick={() => setOpen(on ? '' : k)}>
                      <span style={{ flex: 1 }}>{f.pergunta}</span>
                      <span aria-hidden style={{ color: C.t3, transform: `rotate(${on ? 90 : 0}deg)`, transition: 'transform .15s' }}>
                        ›
                      </span>
                    </button>
                    {on && <Md md={f.resposta} className="hp-faq-a" />}
                  </div>
                )
              })}
          </div>
        ))}
      </div>
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Não achou? Pergunte para a Yui</span>
        <AskBox compact examples={[]} />
        <div className="hp-card" style={{ background: 'rgba(245,181,74,.06)', borderColor: 'rgba(245,181,74,.26)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, lineHeight: 1.55, color: '#dfe3f3' }}>Perguntas que a Yui não soube responder ficam aqui — viram um guia novo.</span>
          {unanswered.slice(0, 8).map((u) => (
            <span key={`${u.pergunta}${u.at}`} style={{ fontSize: 12.5, color: '#f5c97a' }}>
              • {u.pergunta}
            </span>
          ))}
          {!unanswered.length && <span style={{ fontSize: 12, color: C.t3 }}>Nenhuma por enquanto.</span>}
        </div>
      </aside>
    </section>
  )
}
