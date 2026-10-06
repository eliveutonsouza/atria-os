import type { ReportPayload } from '@shared/protocol'
import { useApi } from '../api/useApi'
import { submitText } from '../lib/actions'
import { C, toneColor } from '../lib/colors'
import { useYui } from '../store/yui'
import { Empty, Skeleton, useHeader } from './ui'

export function ReportView() {
  const { data, loading, error } = useApi<ReportPayload>('/api/reports/latest')
  useHeader('Report', data?.title ?? 'Relatório', data
    ? [
        { label: 'Resumir', primary: true, fn: () => submitText('Resuma este relatório em poucas frases.') },
        { label: 'Apresentar', fn: () => submitText('Transforme este relatório em slides.') },
        { label: 'Exportar', fn: () => submitText('Exporte este relatório em PDF.') },
      ]
    : [], [data])
  const phone = useYui((s) => s.device === 'phone')
  if (loading && !data) return <Skeleton kpis={4} rows={5} />
  if (error || !data) return <Empty text="Ainda não há relatório pronto." hint="Diga: “Prepare meu relatório.”" />
  const when = new Date(data.generatedAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (
    <article style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 26, padding: '8px 0 24px' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: C.t3 }}>Gerado por {data.generatedBy} · {when}</div>
        <h2 style={{ margin: 0, fontSize: phone ? 26 : 34, fontWeight: 300, letterSpacing: '-.02em', lineHeight: 1.15 }}>{data.title}</h2>
        <p style={{ margin: 0, fontSize: 16, color: '#b4b9cf', lineHeight: 1.6, textWrap: 'pretty' }}>{data.lead}</p>
      </header>
      {data.kpis.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(phone ? 2 : 4, data.kpis.length)},minmax(0,1fr))`, gap: 1, background: 'rgba(255,255,255,.06)', borderRadius: 14, overflow: 'hidden' }}>
          {data.kpis.map((k) => (
            <div key={k.label} style={{ padding: phone ? '14px 14px' : '16px 18px', background: '#0f1229', minWidth: 0 }}>
              <div style={{ fontSize: phone ? 24 : 28, fontWeight: 300, overflowWrap: 'anywhere' }}>{k.value}</div>
              <div style={{ fontSize: 12, color: C.t2 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}
      {data.sections.map((sec) => (
        <section key={sec.heading} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: toneColor(sec.tone, C.cyan), fontWeight: 600 }}>{sec.heading}</div>
          {sec.items.map((it, i) => (
            <div key={i} style={{ fontSize: 15, lineHeight: 1.6, color: '#d6d9e8', paddingLeft: 16, borderLeft: '1px solid rgba(255,255,255,.1)' }}>{it}</div>
          ))}
        </section>
      ))}
    </article>
  )
}
