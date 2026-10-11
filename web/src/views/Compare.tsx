import { useEffect, useState } from 'react'
import type { ModelsCatalog, RunInfo } from '@shared/protocol'
import { api } from '../api/client'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { BottomSheet } from './Sheet'

// Refazer com outro modelo e comparar (canvas Atria — Entregas e comparação, prancha 2).

interface Side { run: RunInfo; model: string | null; seconds: number | null; turns: number | null; diff: string | null; worktree: string | null }
interface Comparison { original: Side; refeitas: Side[] }

const usd = (v: number) => `US$ ${v.toFixed(2).replace('.', ',')}`
const dur = (s: number | null) => (s == null ? '—' : s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`)

/** Botão + janelinha "Refazer com outro modelo". */
export function RedoButton({ run, phone, style }: { run: RunInfo; phone: boolean; style: React.CSSProperties }) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelsCatalog['claude']>([])
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open || models.length) return
    api.get<ModelsCatalog>('/api/models').then((c) => {
      setModels(c.claude)
      setModel(c.claude.find((m) => m.value !== run.model)?.value ?? c.claude[0]?.value ?? '')
    }).catch(() => {})
  }, [open, models.length, run.model])
  const go = async () => {
    setBusy(true)
    try {
      await api.post(`/api/runs/${run.id}/compare`, { model })
      useYui.getState().say(`Refazendo com ${model} numa cópia isolada. Quando terminar, abra Comparar.`, { state: 'success' })
      setOpen(false)
    } catch (e) {
      useYui.getState().say(`Não consegui refazer: ${(e as Error).message}`, { state: 'warning' })
    } finally {
      setBusy(false)
    }
  }
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>Refazer com outro modelo</span>
      <span style={{ fontSize: 12.5, color: C.t2 }}>Mesma instrução, mesmo agente. Em projeto com git roda numa cópia isolada; sem git, só pode ler. Push, deploy e envios ficam bloqueados.</span>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: C.t2 }}>
        Modelo{run.model ? ` (o original usou ${run.model})` : ''}
        <select value={model} onChange={(e) => setModel(e.target.value)} style={{ height: 44, padding: '0 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.04)', color: C.text, fontSize: 13 }}>
          {models.map((m) => (
            <option key={m.value} value={m.value}>{m.label || m.value}</option>
          ))}
        </select>
      </label>
      <button disabled={busy || !model} onClick={() => void go()} style={{ height: 44, borderRadius: 12, border: 'none', background: C.cyan, color: '#06221c', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
        {busy ? 'Enviando…' : 'Refazer e comparar'}
      </button>
    </div>
  )
  return (
    <span style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={style} aria-expanded={open}>Refazer com outro modelo</button>
      {open &&
        (phone ? (
          <BottomSheet label="Refazer com outro modelo" onClose={() => setOpen(false)} zIndex={60}>{body}</BottomSheet>
        ) : (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
            <div role="dialog" aria-label="Refazer com outro modelo" style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 31, width: 340, padding: 18, borderRadius: 16, background: 'rgba(16,20,42,.98)', border: '1px solid rgba(160,170,255,.2)', boxShadow: '0 20px 60px rgba(0,0,0,.55)' }}>
              {body}
            </div>
          </>
        ))}
    </span>
  )
}

function SideCard({ s, label, accent, onRate }: { s: Side; label: string; accent: boolean; onRate?: (v: 1 | -1) => void }) {
  const r = s.run
  return (
    <section aria-label={label} style={{ borderRadius: 16, border: `1px solid ${accent ? 'rgba(166,140,247,.35)' : 'rgba(255,255,255,.08)'}`, background: accent ? 'rgba(166,140,247,.04)' : 'rgba(255,255,255,.02)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: accent ? 'rgba(166,140,247,.15)' : 'rgba(255,255,255,.06)', color: accent ? C.lav : '#c9cde0' }}>{label}</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#a9e9f8' }}>{s.model ?? 'modelo padrão'}</span>
          {r.state !== 'done' && <span style={{ fontSize: 12, color: r.state === 'failed' ? C.crit : C.cyan }}>{r.state === 'failed' ? 'falhou' : 'rodando…'}</span>}
        </span>
        <span style={{ display: 'flex', gap: 16, fontSize: 12.5, color: C.t2, flexWrap: 'wrap' }}>
          <span>{dur(s.seconds)}</span>
          <span>{s.turns ?? '—'} turnos</span>
          <span>{usd(r.costUsd ?? 0)} equiv.</span>
          {s.diff && <span>{s.diff}</span>}
          <span style={{ color: r.rating === 1 ? C.ok : r.rating === -1 ? '#f39aa4' : C.t3 }}>{r.rating === 1 ? '👍 sua nota' : r.rating === -1 ? '👎 sua nota' : 'sem nota'}</span>
        </span>
      </div>
      <div style={{ padding: '16px 18px', fontSize: 14, lineHeight: 1.65, color: '#d6d9e8', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflowY: 'auto', maxHeight: '48vh' }}>{r.result ?? r.currentOp ?? '—'}</div>
      {onRate && (
        <div style={{ marginTop: 'auto', padding: '12px 18px', borderTop: '1px solid rgba(255,255,255,.06)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: C.t2, flex: 1 }}>Qual ficou melhor?</span>
          <button aria-label={`${label} ficou boa`} onClick={() => onRate(1)} style={{ width: 44, height: 40, borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', background: r.rating === 1 ? 'rgba(79,224,176,.12)' : 'transparent', color: C.text, cursor: 'pointer' }}>👍</button>
          <button aria-label={`${label} ficou ruim`} onClick={() => onRate(-1)} style={{ width: 44, height: 40, borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', background: r.rating === -1 ? 'rgba(240,98,114,.12)' : 'transparent', color: C.text, cursor: 'pointer' }}>👎</button>
        </div>
      )}
    </section>
  )
}

/** Tela de comparação: original e refeita lado a lado (celular: empilhadas). */
export function CompareModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const phone = useYui((s) => s.device === 'phone')
  const [data, setData] = useState<Comparison | null>(null)
  const [pick, setPick] = useState(0)
  const [busy, setBusy] = useState(false)
  const load = () => api.get<Comparison>(`/api/runs/${runId}/comparison`).then(setData).catch(() => setData(null))
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 8000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])
  const ref = data?.refeitas[pick] ?? data?.refeitas.at(-1)
  const rate = (id: string) => (v: 1 | -1) => api.post(`/api/runs/${id}/rating`, { rating: v }).then(load).catch(() => {})
  const act = async (what: 'apply' | 'discard') => {
    if (!ref) return
    setBusy(true)
    try {
      const r = await api.post<{ stat?: string }>(`/api/runs/${ref.run.id}/compare/${what}`)
      useYui.getState().say(what === 'apply' ? `Apliquei as mudanças da refeita no projeto${r?.stat ? ` (${r.stat})` : ''}.` : 'Descartei a cópia da refeita.', { state: 'success' })
      void load()
    } catch (e) {
      useYui.getState().say((e as Error).message, { state: 'warning' })
    } finally {
      setBusy(false)
    }
  }
  const btn = { height: phone ? 48 : 40, padding: '0 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: '#dfe3f3', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as const
  const content = !data ? (
    <span style={{ fontSize: 13, color: C.t3 }}>Carregando…</span>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 300px', minWidth: 0 }}>
          <span style={{ fontSize: 11, letterSpacing: '.2em', color: C.lav, fontWeight: 700 }}>COMPARAÇÃO · MESMA TAREFA, OUTRO MODELO</span>
          <span style={{ fontSize: phone ? 17 : 20, fontWeight: 600, overflowWrap: 'anywhere' }}>{data.original.run.task}</span>
          <span style={{ fontSize: 13, color: C.t2 }}>
            {data.original.run.agent}{data.original.run.project ? ` · ${data.original.run.project}` : ''} · {ref?.worktree ? 'a refeita roda numa cópia isolada e não altera o original' : 'a refeita não tem cópia para aplicar (só leitura ou já decidida)'}
          </span>
        </span>
        {!phone && <button onClick={onClose} style={btn}>Fechar</button>}
      </div>
      {data.refeitas.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {data.refeitas.map((r, i) => (
            <button key={r.run.id} aria-pressed={i === pick} onClick={() => setPick(i)} style={{ ...btn, height: 34, borderColor: i === pick ? 'rgba(166,140,247,.5)' : 'rgba(255,255,255,.12)' }}>{r.model ?? `refeita ${i + 1}`}</button>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: phone ? 'minmax(0,1fr)' : 'repeat(2,minmax(0,1fr))', gap: 16 }}>
        <SideCard s={data.original} label="Original" accent={false} onRate={rate(data.original.run.id)} />
        {ref ? <SideCard s={ref} label="Refeita" accent onRate={ref.run.state === 'done' ? rate(ref.run.id) : undefined} /> : <span style={{ color: C.t3, fontSize: 13 }}>Nenhuma refeita ainda.</span>}
      </div>
      {ref?.worktree && ref.run.state === 'done' && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button disabled={busy} onClick={() => void act('discard')} style={btn}>Descartar cópia</button>
          <button disabled={busy} onClick={() => void act('apply')} style={{ ...btn, border: 'none', background: C.cyan, color: '#06221c', fontWeight: 700 }}>Ficar com a refeita</button>
        </div>
      )}
    </div>
  )
  if (phone)
    return (
      <BottomSheet label="Comparação" onClose={onClose} zIndex={60}>
        {content}
      </BottomSheet>
    )
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 58, background: 'rgba(4,5,12,.6)', backdropFilter: 'blur(6px)' }} />
      <div role="dialog" aria-modal="true" aria-label="Comparação" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(1240px,calc(100% - 48px))', maxHeight: 'calc(100dvh - 48px)', overflowY: 'auto', boxSizing: 'border-box', zIndex: 59, padding: 28, borderRadius: 22, background: '#0a0c18', border: '1px solid rgba(160,170,255,.16)', boxShadow: '0 30px 90px rgba(0,0,0,.6)' }}>
        {content}
      </div>
    </>
  )
}
