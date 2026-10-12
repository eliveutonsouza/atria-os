import { useState } from 'react'
import type { ReportPayload } from '@shared/protocol'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { submitText } from '../lib/actions'
import { C, toneColor } from '../lib/colors'
import { useYui } from '../store/yui'
import { ConfirmDeleteModal, Empty, Skeleton, useHeader } from './ui'

type ReportItem = { name: string; title: string; createdAt: string; generatedBy: string }

const fmtWhen = (iso: string, year = true) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', ...(year ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit' })
}

export function ReportView() {
  // null = o mais recente (/api/reports/latest)
  const [name, setName] = useState<string | null>(null)
  const { data, loading, error, reload } = useApi<ReportPayload>(name ? `/api/reports/${encodeURIComponent(name)}` : '/api/reports/latest', [name])
  const list = useApi<ReportItem[]>('/api/reports')
  const [del, setDel] = useState(false)
  const [busy, setBusy] = useState(false)
  const current = name ?? (data ? `${data.id}.json` : null)
  useHeader('Relatório', data?.title ?? 'Relatório', data
    ? [
        { label: 'Resumir', primary: true, fn: () => submitText('Resuma este relatório em poucas frases.') },
        { label: 'Apresentar', fn: () => submitText('Transforme este relatório em slides.') },
        { label: 'Exportar', fn: () => submitText('Exporte este relatório em PDF.') },
        { label: 'Excluir relatório', danger: true, fn: () => setDel(true) },
      ]
    : [], [data])
  const phone = useYui((s) => s.device === 'phone')
  const coarse = useYui((s) => s.coarse)
  const remove = () => {
    if (!current) return
    setBusy(true)
    api
      .del(`/api/reports/${encodeURIComponent(current)}`)
      .then(() => {
        setDel(false)
        list.reload()
        if (name) setName(null)
        else reload()
      })
      .catch((e: Error) => useYui.getState().say(`Não excluí o relatório: ${e.message}`))
      .finally(() => setBusy(false))
  }
  const reports = list.data ?? []
  const picker = reports.length > 1 && (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: C.t2, flexWrap: phone ? 'wrap' : 'nowrap' }}>
      Relatórios anteriores
      <select
        value={current ?? ''}
        onChange={(e) => setName(e.target.value === reports[0]?.name ? null : e.target.value)}
        style={{ flex: phone ? '1 1 100%' : '0 1 420px', minWidth: 0, height: coarse ? 44 : 34, borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(6,7,13,.6)', color: C.text, padding: '0 10px', fontFamily: 'inherit', fontSize: 13, colorScheme: 'dark' }}
      >
        {current && !reports.some((r) => r.name === current) && <option value={current}>{data?.title ?? current}</option>}
        {reports.map((r, i) => (
          <option key={r.name} value={r.name}>
            {i === 0 ? 'Mais recente · ' : ''}
            {r.title} · {fmtWhen(r.createdAt, false)}
          </option>
        ))}
      </select>
    </label>
  )
  if (loading && !data) return <Skeleton kpis={4} rows={5} />
  if (error || !data) return <Empty text="Ainda não há relatório pronto." hint="Diga: “Prepare meu relatório.”" />
  const when = fmtWhen(data.generatedAt)
  return (
    <article style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 26, padding: '8px 0 24px' }}>
      {picker}
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
            <div key={i} style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text-dim)', paddingLeft: 16, borderLeft: '1px solid rgba(255,255,255,.1)' }}>{it}</div>
          ))}
        </section>
      ))}
      {del && (
        <ConfirmDeleteModal
          title="Excluir relatório?"
          text="O arquivo do relatório é apagado do workspace."
          rows={[
            { label: 'Relatório', value: data.title },
            { label: 'Gerado', value: when },
          ]}
          busy={busy}
          onCancel={() => setDel(false)}
          onConfirm={remove}
        />
      )}
    </article>
  )
}
