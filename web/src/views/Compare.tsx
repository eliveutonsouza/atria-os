import { useEffect, useState } from 'react'
import type { ModelsCatalog, RunInfo } from '@shared/protocol'
import { api } from '../api/client'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { BottomSheet } from './Sheet'
import { ErrorNote, Modal } from './ui'
import { confirmAction, toastErr } from '../lib/feedback'

// Refazer com outro modelo e comparar (canvas Atria — Entregas e comparação, prancha 2).

interface Side { run: RunInfo; model: string | null; seconds: number | null; turns: number | null; diff: string | null; worktree: string | null }
interface Comparison { original: Side; refeitas: Side[] }

const usd = (v: number) => `US$ ${v.toFixed(2).replace('.', ',')}`
const dur = (s: number | null) => (s == null ? '—' : s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`)

/** Botão + janelinha "Refazer com outro modelo". */
export function RedoButton({ run, phone, style, className }: { run: RunInfo; phone: boolean; style: React.CSSProperties; className?: string }) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelsCatalog['claude']>([])
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadErr, setLoadErr] = useState(false)
  const [tries, setTries] = useState(0)
  useEffect(() => {
    if (!open || models.length) return
    api.get<ModelsCatalog>('/api/models').then((c) => {
      setModels(c.claude)
      setModel(c.claude.find((m) => m.value !== run.model)?.value ?? c.claude[0]?.value ?? '')
    }).catch(() => setLoadErr(true))
  }, [open, models.length, run.model, tries])
  // janelinha do computador: Esc fecha
  useEffect(() => {
    if (!open || phone) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, phone, busy])
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
      <span style={{ fontSize: 12.5, color: C.t2 }}>Mesma instrução, mesmo agente. Quando dá, roda numa cópia isolada do projeto; se não der, só pode ler. Publicar e enviar ficam bloqueados.</span>
      {loadErr && (
        <span role="alert" style={{ fontSize: 12.5, color: C.critSoft }}>
          Não consegui carregar a lista de modelos.{' '}
          <button onClick={() => { setLoadErr(false); setTries((n) => n + 1) }} style={{ background: 'none', border: 'none', padding: 0, color: C.cyanSoft, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Tentar de novo</button>
        </span>
      )}
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
      <button onClick={() => setOpen(!open)} className={className} style={style} aria-expanded={open}>Refazer com outro modelo</button>
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
          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: accent ? 'rgba(166,140,247,.15)' : 'rgba(255,255,255,.06)', color: accent ? C.lav : C.soft }}>{label}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: C.cyanSoft }}>{s.model ?? 'modelo padrão'}</span>
          {r.state !== 'done' && <span style={{ fontSize: 12, color: r.state === 'failed' ? C.crit : C.cyan }}>{r.state === 'failed' ? 'falhou' : 'rodando…'}</span>}
        </span>
        <span style={{ display: 'flex', gap: 16, fontSize: 12.5, color: C.t2, flexWrap: 'wrap' }}>
          <span>{dur(s.seconds)}</span>
          <span>{s.turns ?? '—'} passos</span>
          <span>aprox. {usd(r.costUsd ?? 0)}</span>
          {s.diff && <span>{s.diff}</span>}
          <span style={{ color: r.rating === 1 ? C.ok : r.rating === -1 ? C.critSoft : C.t3 }}>{r.rating === 1 ? '👍 sua nota' : r.rating === -1 ? '👎 sua nota' : 'sem nota'}</span>
        </span>
      </div>
      <div style={{ padding: '16px 18px', fontSize: 14, lineHeight: 1.65, color: C.dim, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflowY: 'auto', maxHeight: '48vh' }}>{r.result ?? r.currentOp ?? '—'}</div>
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
  const [conflict, setConflict] = useState<string | null>(null)
  const [loadErr, setLoadErr] = useState(false)
  const load = () =>
    api.get<Comparison>(`/api/runs/${runId}/comparison`).then((d) => {
      setData(d)
      setLoadErr(false)
    }).catch(() => setLoadErr(true))
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 8000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])
  const ref = data?.refeitas[pick] ?? data?.refeitas.at(-1)
  // nota aparece na hora; se o servidor recusar, volta ao que era e avisa
  const rate = (id: string) => (v: 1 | -1) => {
    const prev = data
    const mark = (sd: Side): Side => (sd.run.id === id ? { ...sd, run: { ...sd.run, rating: v } } : sd)
    if (data) setData({ original: mark(data.original), refeitas: data.refeitas.map(mark) })
    api.post(`/api/runs/${id}/rating`, { rating: v }).then(load).catch((e) => {
      setData(prev)
      toastErr(e, 'Não consegui salvar a nota')
    })
  }
  const act = async (what: 'apply' | 'discard', replace = false) => {
    if (!ref || busy) return
    if (what === 'discard' && !(await confirmAction({ title: 'Descartar a cópia da refeita?', text: 'As mudanças que a refeita fez na cópia isolada são apagadas. O projeto original não muda.', confirmLabel: 'Descartar cópia', danger: true }))) return
    setBusy(true)
    try {
      const r = await api.post<{ stat?: string }>(`/api/runs/${ref.run.id}/compare/${what}`, replace ? { replace: true } : undefined)
      useYui.getState().say(what === 'apply' ? `Apliquei as mudanças da refeita no projeto${r?.stat ? ` (${r.stat})` : ''}.` : 'Descartei a cópia da refeita.', { state: 'success' })
      setConflict(null)
      void load()
    } catch (e) {
      const msg = (e as Error).message
      // mudanças não salvas (em geral da execução original) nos mesmos arquivos: pergunta antes de substituir
      if (what === 'apply' && /mudanças não salvas/.test(msg)) setConflict(msg)
      else toastErr(e, what === 'apply' ? 'Não consegui aplicar' : 'Não consegui descartar')
    } finally {
      setBusy(false)
    }
  }
  const btn = { height: phone ? 48 : 40, padding: '0 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: C.btn, fontSize: 13, fontWeight: 600, cursor: 'pointer' } as const
  const content = !data ? (
    loadErr ? <ErrorNote text="Não consegui carregar a comparação." retry={() => void load()} /> : <span style={{ fontSize: 13, color: C.t3 }}>Carregando…</span>
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
      {conflict && (
        <div role="alert" style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(245,181,74,.06)', border: '1px solid rgba(245,181,74,.3)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 13.5, color: '#e6d3a8', lineHeight: 1.5 }}>Não apliquei: {conflict}. Substituir esses arquivos pelos da refeita? O que a original deixou neles será perdido.</span>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button onClick={() => setConflict(null)} style={btn}>Cancelar</button>
            <button disabled={busy} onClick={() => void act('apply', true)} style={{ ...btn, border: 'none', background: '#f5b54a', color: '#1a1205', fontWeight: 700 }}>Substituir pelos da refeita</button>
          </div>
        </div>
      )}
      {ref?.worktree && ref.run.state === 'done' && !conflict && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button disabled={busy} onClick={() => void act('discard')} style={btn}>Descartar cópia</button>
          <button disabled={busy} onClick={() => void act('apply')} style={{ ...btn, border: 'none', background: C.cyan, color: '#06221c', fontWeight: 700 }}>Ficar com a refeita</button>
        </div>
      )}
    </div>
  )
  return (
    <Modal label="Comparação" onClose={onClose} busy={busy} width={1240} zIndex={58}>
      {content}
    </Modal>
  )
}
