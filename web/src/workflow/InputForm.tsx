import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { InputField, WorkflowInputRequest } from '@shared/protocol'
import { api } from '../api/client'
import { fmtSize } from '../company/api'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { BottomSheet } from '../views/Sheet'
import './workflow.css'
import { dismissFresh, fetchInput, freshRequest, InputSendError, onFreshRequest, openInputRequest, submitInput, nowTime, today } from './inputs'

// Formulário de um pedido de informação (Form.dc.html / PhoneForm.dc.html): modal no desktop, folha no celular.
// Abre por Inbox, aba Execuções, rota /app/workflows/pedido/<id>, push e aviso de pedido novo.

type Value = string | boolean | null
interface Received {
  name: string
  size?: number
}

const AUDIO_ACCEPT = 'audio/*,video/mp4,video/webm,.m4a,.mp3,.wav,.ogg,.oga,.opus,.webm,.mp4,.aac,.flac'
const MAX_BYTES = 500 * 1024 * 1024

const btn = (h: number, extra?: CSSProperties): CSSProperties => ({
  height: h, padding: '0 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: C.text,
  fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', ...extra,
})
const primaryBtn = (h: number): CSSProperties => btn(h, { border: 0, background: 'linear-gradient(135deg,#67d8f2,#a68cf7)', color: '#06070d', fontWeight: 700, padding: '0 20px' })
const fieldInput: CSSProperties = {
  flex: 1, minWidth: 0, width: '100%', boxSizing: 'border-box', height: 44, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)',
  background: 'rgba(0,0,0,.25)', color: C.text, fontFamily: 'inherit', fontSize: 15, colorScheme: 'dark',
}
const labelText: CSSProperties = { fontSize: 13, color: C.t2 }

// ---------- host global (montado no Shell) ----------

export function InputFormHost() {
  const id = useYui((s) => s.inputOpen)
  const req = useYui((s) => (s.inputOpen ? s.workflowInputs[s.inputOpen] : undefined))
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    setMissing(false)
    if (id && !req) void fetchInput(id).then((r) => !r && setMissing(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  useEffect(() => {
    if (id && missing) {
      useYui.getState().set({ inputOpen: null })
      useYui.getState().say('Não encontrei esse pedido — talvez a execução tenha sido apagada.')
    }
  }, [id, missing])
  if (!id || !req) return null
  return <InputForm key={req.id} req={req} onClose={() => useYui.getState().set({ inputOpen: null })} />
}

/** Aviso no canto quando um workflow para e pede algo (evento SSE workflow.input.updated). */
export function InputToast() {
  const [id, setId] = useState<string | null>(freshRequest())
  useEffect(() => onFreshRequest(() => setId(freshRequest())), [])
  const req = useYui((s) => (id ? s.workflowInputs[id] : undefined))
  const open = useYui((s) => s.inputOpen)
  if (!id || !req || req.status !== 'pending' || open === id) return null
  return (
    <div
      role="status"
      style={{
        position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(96px + var(--sab) + var(--kb))', zIndex: 57, display: 'flex', alignItems: 'center', gap: 10,
        width: 'max-content', maxWidth: 'calc(100% - 32px)', boxSizing: 'border-box', padding: '10px 10px 10px 16px', borderRadius: 14, background: 'rgba(16,20,42,.94)',
        border: '1px solid rgba(103,216,242,.35)', backdropFilter: 'blur(16px)', boxShadow: '0 18px 50px rgba(0,0,0,.45)', fontSize: 13, color: C.text,
      }}
    >
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', color: C.cyan, fontWeight: 700 }}>Workflow pede algo</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.title} · {req.workflowName}</span>
      </span>
      <button onClick={() => openInputRequest(req.id)} style={{ height: 34, padding: '0 14px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#67d8f2,#a68cf7)', color: '#0a0c1d', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
        Responder
      </button>
      <button aria-label="Dispensar aviso" onClick={dismissFresh} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', background: 'transparent', color: C.t2, cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>×</button>
    </div>
  )
}

// ---------- formulário ----------

function initialValue(f: InputField, answers: Record<string, unknown>): Value {
  const a = answers[f.key]
  if (typeof a === 'string' || typeof a === 'boolean') return a
  if (typeof a === 'number') return String(a)
  const d = f.default ?? null
  if (d === null || d === '') return f.kind === 'boolean' ? null : ''
  if (f.kind === 'date' && d.toLowerCase() === 'hoje') return today()
  if (f.kind === 'time' && (d.toLowerCase() === 'hoje' || d.toLowerCase() === 'agora')) return nowTime()
  if (f.kind === 'boolean') return /^(sim|true|s|yes)$/i.test(d)
  return d
}

const isFileKind = (f: InputField) => f.kind === 'audio' || f.kind === 'images' || f.kind === 'files'

function receivedOf(answers: Record<string, unknown>, key: string): Received[] {
  const a = answers[key]
  if (!Array.isArray(a)) return []
  return a.map((x) => (typeof x === 'string' ? { name: x } : { name: String((x as Received).name ?? 'arquivo'), size: (x as Received).size }))
}

function InputForm({ req, onClose }: { req: WorkflowInputRequest; onClose: () => void }) {
  const phone = useYui((s) => s.device === 'phone')
  const [values, setValues] = useState<Record<string, Value>>(() => Object.fromEntries(req.fields.filter((f) => !isFileKind(f)).map((f) => [f.key, initialValue(f, req.answers)])))
  const [files, setFiles] = useState<Record<string, File[]>>({})
  const [missing, setMissing] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [recording, setRecording] = useState(false)
  const firstRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTimeout(() => firstRef.current?.querySelector<HTMLElement>('input,textarea,button')?.focus(), 60)
  }, [])

  const has = (f: InputField): boolean => {
    if (isFileKind(f)) return (files[f.key]?.length ?? 0) > 0 || receivedOf(req.answers, f.key).length > 0
    const v = values[f.key]
    return typeof v === 'boolean' || (typeof v === 'string' && v.trim() !== '')
  }
  const sending = pct !== null
  const processing = req.status === 'processing'
  const closed = req.status === 'done' || req.status === 'cancelled' || req.status === 'failed'
  // processamento que falhou volta para pendente com o erro: mostra e deixa reenviar (arquivos já enviados ficam)
  const failedBefore = req.status === 'pending' && req.error

  const submit = async () => {
    const miss = req.fields.filter((f) => f.required && !has(f)).map((f) => f.key)
    setMissing(miss)
    if (miss.length) return setError(`Falta preencher: ${miss.map((k) => req.fields.find((f) => f.key === k)?.label ?? k).join(', ')}.`)
    const big = Object.values(files).flat().find((f) => f.size > MAX_BYTES)
    if (big) return setError(`${big.name} passa de 500 MB.`)
    setError(null)
    setPct(0)
    try {
      const answers: Record<string, unknown> = {}
      for (const f of req.fields) {
        if (isFileKind(f)) continue
        const v = values[f.key]
        if (v === null || v === '') continue
        answers[f.key] = f.kind === 'number' && typeof v === 'string' ? Number(v.replace(',', '.')) : v
      }
      await submitInput(req.id, answers, files, setPct)
      useYui.getState().say(req.fields.some((f) => f.kind === 'audio' && (files[f.key]?.length ?? 0) > 0) ? 'Recebi. Vou transcrever a gravação e seguir com o fluxo.' : 'Recebi. O fluxo continua.')
      void fetchInput(req.id)
    } catch (e) {
      const err = e as InputSendError
      setError(err.message)
      // o servidor devolve os rótulos dos campos que faltam
      if (err.missing?.length) setMissing(req.fields.filter((f) => err.missing.includes(f.label) || err.missing.includes(f.key)).map((f) => f.key))
    } finally {
      setPct(null)
    }
  }

  const cancelRun = async () => {
    if (!confirmCancel) return setConfirmCancel(true)
    try {
      await api.post(`/api/workflow-runs/${encodeURIComponent(req.runId)}/cancel`)
      useYui.getState().say(`Execução de "${req.workflowName}" cancelada.`)
      onClose()
    } catch (e) {
      setError(`Não consegui cancelar: ${(e as Error).message}.`)
    }
  }

  const body = (
    <>
      <div>
        <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: C.cyan, fontWeight: 600 }}>
          {phone ? 'Pedido do workflow' : `Workflow · ${req.workflowName} · passo ${req.nodeId}`}
        </div>
        <h2 id="input-form-title" style={{ margin: '6px 0 4px', fontSize: phone ? 20 : 22, fontWeight: 600, overflowWrap: 'anywhere' }}>{req.title}</h2>
        {req.instruction && <p style={{ margin: 0, fontSize: 14, color: '#c9cde0', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{req.instruction}</p>}
        {phone && <p style={{ margin: '6px 0 0', fontSize: 12.5, color: C.t3 }}>{req.workflowName} · passo {req.nodeId}</p>}
      </div>

      {processing || closed ? (
        <StatusBlock req={req} />
      ) : (
        <div ref={firstRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {req.fields.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              value={values[f.key] ?? null}
              onValue={(v) => setValues((o) => ({ ...o, [f.key]: v }))}
              files={files[f.key] ?? []}
              onFiles={(fs) => setFiles((o) => ({ ...o, [f.key]: fs }))}
              received={receivedOf(req.answers, f.key)}
              invalid={missing.includes(f.key)}
              phone={phone}
              onRecording={setRecording}
            />
          ))}
        </div>
      )}

      {failedBefore && !error && (
        <div role="alert" style={{ fontSize: 13, color: '#f39aa4', padding: '10px 12px', borderRadius: 10, background: 'rgba(240,98,114,.08)', border: '1px solid rgba(240,98,114,.25)' }}>
          Não consegui processar o último envio: {req.error}. Os arquivos já enviados ficaram guardados — envie de novo.
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 13, color: '#f39aa4' }}>{error}</div>}
      {sending && (
        <div role="progressbar" aria-label="Enviando" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, color: C.t2 }}>Enviando… {pct}%</span>
          <span style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#67d8f2,#a68cf7)', transition: 'width .2s' }} />
          </span>
        </div>
      )}

      {processing || closed ? (
        <button type="button" style={btn(44, { alignSelf: phone ? 'stretch' : 'flex-end' })} onClick={onClose}>Fechar</button>
      ) : phone ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'sticky', bottom: 0, paddingTop: 4, background: '#0e1022' }}>
          <button type="submit" disabled={sending || recording} style={{ ...primaryBtn(52), opacity: sending || recording ? 0.6 : 1 }}>{sending ? 'Enviando…' : 'Enviar e continuar'}</button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button type="button" style={btn(44)} onClick={onClose}>Depois</button>
            <button type="button" style={btn(44, { border: '1px solid rgba(240,98,114,.35)', color: '#f39aa4', padding: '0 8px' })} onClick={() => void cancelRun()}>
              {confirmCancel ? 'Confirmar' : 'Cancelar execução'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={btn(44, { border: '1px solid rgba(240,98,114,.35)', color: '#f39aa4' })} onClick={() => void cancelRun()}>
            {confirmCancel ? 'Confirmar: cancelar a execução' : 'Cancelar execução'}
          </button>
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={btn(44, { padding: '0 18px' })} onClick={onClose}>Depois</button>
            <button type="submit" disabled={sending || recording} style={{ ...primaryBtn(44), opacity: sending || recording ? 0.6 : 1 }}>{sending ? 'Enviando…' : 'Enviar e continuar'}</button>
          </span>
        </div>
      )}
    </>
  )

  const form = (
    <form
      aria-labelledby="input-form-title"
      onSubmit={(e) => {
        e.preventDefault()
        if (!sending && !recording && !processing && !closed) void submit()
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      {body}
    </form>
  )

  if (phone) return <BottomSheet label={req.title} tone="rgba(103,216,242,.35)" onClose={onClose} zIndex={60}>{form}</BottomSheet>
  return <DesktopModal onClose={onClose}>{form}</DesktopModal>
}

function DesktopModal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(4,5,10,.7)', backdropFilter: 'blur(4px)', overflowY: 'auto', overscrollBehavior: 'contain', padding: '40px 16px', boxSizing: 'border-box' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="input-form-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          margin: '0 auto', width: 'min(680px,100%)', boxSizing: 'border-box', padding: 26, borderRadius: 20, color: C.text, fontFamily: 'Manrope, system-ui, sans-serif',
          background: 'linear-gradient(180deg,#14173a,#0e1022)', border: '1px solid rgba(103,216,242,.3)', boxShadow: '0 30px 90px rgba(0,0,0,.6)',
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

// Depois de enviar: o que chegou e o andamento (transcrição em partes, resumo).
function StatusBlock({ req }: { req: WorkflowInputRequest }) {
  const got = req.fields.filter((f) => req.answers[f.key] !== undefined && req.answers[f.key] !== null && req.answers[f.key] !== '').map((f) => summarizeAnswer(f, req.answers[f.key]))
  const row = (icon: string, color: string, text: string, muted = false) => (
    <li style={{ display: 'flex', gap: 10, color: muted ? C.t3 : C.text }}>
      <span style={{ color, flexShrink: 0 }}>{icon}</span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{text}</span>
    </li>
  )
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
      {row('✓', C.ok, `Recebido${got.length ? `: ${got.join(', ')}` : ''}`)}
      {req.status === 'processing' && row('◐', C.cyan, req.progress || 'Processando as respostas…')}
      {req.status === 'processing' && row('○', C.t3, 'Resumo para os próximos passos', true)}
      {req.status === 'done' && row('✓', C.ok, 'Pronto — o fluxo seguiu com as respostas.')}
      {req.status === 'cancelled' && row('×', C.t3, 'Pedido cancelado.')}
      {req.status === 'failed' && row('!', C.crit, req.error || 'Falhou ao processar as respostas.')}
    </ol>
  )
}

function summarizeAnswer(f: InputField, v: unknown): string {
  if (Array.isArray(v)) {
    if (f.kind === 'audio') return 'gravação'
    return `${v.length} ${f.kind === 'images' ? (v.length === 1 ? 'imagem' : 'imagens') : v.length === 1 ? 'arquivo' : 'arquivos'}`
  }
  if (typeof v === 'boolean') return `${f.label}: ${v ? 'sim' : 'não'}`
  if (f.kind === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${f.label.toLowerCase()} ${v.slice(8, 10)}/${v.slice(5, 7)}`
  const s = String(v)
  return f.kind === 'choice' ? `“${s}”` : `${f.label.toLowerCase()}${s.length > 40 ? '' : ` ${s}`}`
}

// ---------- campos ----------

function FieldInput(props: {
  field: InputField
  value: Value
  onValue: (v: Value) => void
  files: File[]
  onFiles: (fs: File[]) => void
  received: Received[]
  invalid: boolean
  phone: boolean
  onRecording: (on: boolean) => void
}) {
  const { field: f, value, onValue, invalid } = props
  const label = `${f.label}${f.required ? ' *' : ' (opcional)'}`
  const border = invalid ? { borderColor: 'rgba(240,98,114,.6)' } : null
  const str = typeof value === 'string' ? value : ''

  if (f.kind === 'boolean' || f.kind === 'choice') {
    const opts = f.kind === 'boolean' ? ['Sim', 'Não'] : (f.options ?? [])
    const cur = f.kind === 'boolean' ? (value === true ? 'Sim' : value === false ? 'Não' : null) : str
    const many = opts.length > 4
    return (
      <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend style={{ ...labelText, marginBottom: 6, padding: 0 }}>{label}</legend>
        <span style={{ display: 'flex', gap: 6, flexWrap: many ? 'wrap' : 'nowrap' }}>
          {opts.map((o) => {
            const on = cur !== null && cur.toLowerCase() === o.toLowerCase()
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() => onValue(f.kind === 'boolean' ? o === 'Sim' : on ? '' : o)}
                style={{
                  flex: many ? '0 0 auto' : 1, minWidth: 0, height: 44, padding: '0 14px', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
                  border: `1px solid ${on ? 'rgba(79,224,176,.6)' : invalid ? 'rgba(240,98,114,.5)' : 'rgba(255,255,255,.1)'}`,
                  background: on ? 'rgba(79,224,176,.14)' : 'transparent', color: on ? '#b9f0dc' : C.t2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {o}
              </button>
            )
          })}
        </span>
      </fieldset>
    )
  }

  if (f.kind === 'audio') return <AudioField {...props} label={label} />
  if (f.kind === 'images' || f.kind === 'files') return <FilesField {...props} label={label} />

  const id = `in-${f.key}`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={id} style={labelText}>{label}</label>
      {f.kind === 'longtext' ? (
        <textarea id={id} value={str} onChange={(e) => onValue(e.target.value)} rows={props.phone ? 4 : 5} style={{ ...fieldInput, height: 'auto', padding: '10px 12px', resize: 'vertical', lineHeight: 1.5, ...border }} />
      ) : f.kind === 'date' || f.kind === 'time' ? (
        <span style={{ display: 'flex', gap: 8 }}>
          <input id={id} type={f.kind} value={str} onChange={(e) => onValue(e.target.value)} style={{ ...fieldInput, ...border }} />
          <button
            type="button"
            onClick={() => onValue(f.kind === 'date' ? today() : nowTime())}
            style={{ height: 44, padding: '0 16px', borderRadius: 10, border: '1px solid rgba(103,216,242,.4)', background: 'rgba(103,216,242,.1)', color: '#a9e9f8', fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', flexShrink: 0 }}
          >
            {f.kind === 'date' ? 'Hoje' : 'Agora'}
          </button>
        </span>
      ) : (
        <input id={id} type="text" inputMode={f.kind === 'number' ? 'decimal' : undefined} value={str} onChange={(e) => onValue(e.target.value)} style={{ ...fieldInput, ...border }} />
      )}
    </div>
  )
}

function useObjectUrl(file: File | null | undefined): string | null {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])
  return url
}

function fmtDuration(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return ''
  if (s < 60) return `${Math.round(s)} s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

function pickRecorderType(): { mime: string; ext: string } {
  const cands = [
    { mime: 'audio/webm;codecs=opus', ext: 'webm' },
    { mime: 'audio/webm', ext: 'webm' },
    { mime: 'audio/mp4', ext: 'm4a' },
    { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
  ]
  for (const c of cands) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(c.mime)) return c
  return { mime: '', ext: 'webm' }
}

function AudioField({ field: f, files, onFiles, received, invalid, phone, onRecording, label }: Parameters<typeof FieldInput>[0] & { label: string }) {
  const file = files[0] ?? null
  const url = useObjectUrl(file)
  const [duration, setDuration] = useState(0)
  const [rec, setRec] = useState<{ started: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [recErr, setRecErr] = useState<string | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  const mr = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])

  useEffect(() => {
    setDuration(0)
    if (!url) return
    const a = new Audio()
    a.preload = 'metadata'
    a.onloadedmetadata = () => setDuration(a.duration)
    a.src = url
  }, [url])
  useEffect(() => {
    if (!rec) return
    const t = setInterval(() => setElapsed((Date.now() - rec.started) / 1000), 500)
    return () => clearInterval(t)
  }, [rec])
  // fechar o formulário no meio da gravação libera o microfone
  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop())
      onRecording(false)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const start = async () => {
    setRecErr(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return setRecErr('Este navegador não grava áudio — escolha um arquivo.')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = s
      const { mime, ext } = pickRecorderType()
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined)
      chunks.current = []
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
      r.onstop = () => {
        s.getTracks().forEach((t) => t.stop())
        stream.current = null
        const type = r.mimeType || mime || 'audio/webm'
        const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
        onFiles([new File(chunks.current, `gravacao-${stamp}.${ext}`, { type })])
        setRec(null)
        onRecording(false)
      }
      r.start(1000)
      mr.current = r
      setElapsed(0)
      setRec({ started: Date.now() })
      onRecording(true)
    } catch {
      setRecErr('Não consegui acessar o microfone. Libere a permissão do navegador ou escolha um arquivo.')
    }
  }
  const stop = () => mr.current?.state === 'recording' && mr.current.stop()

  const small = (extra?: CSSProperties): CSSProperties => ({ height: phone ? 44 : 40, padding: '0 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: C.text, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', ...extra })
  const mic = (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="1.8" strokeLinecap="round" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
  const title = rec
    ? `Gravando… ${fmtDuration(elapsed) || '0 s'}`
    : file
      ? [file.name, fmtDuration(duration), fmtSize(file.size)].filter(Boolean).join(' · ')
      : received.length
        ? `Já recebido: ${received[0].name}`
        : phone
          ? 'Nenhuma gravação ainda'
          : 'Arraste o arquivo aqui ou escolha'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={labelText}>{label}</span>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const fl = e.dataTransfer.files[0]
          if (fl) onFiles([fl])
        }}
        style={{
          padding: phone ? 14 : 16, borderRadius: 12, border: `1px dashed ${invalid ? 'rgba(240,98,114,.6)' : rec ? 'rgba(240,98,114,.5)' : 'rgba(103,216,242,.4)'}`,
          background: rec ? 'rgba(240,98,114,.06)' : 'rgba(103,216,242,.05)', display: 'flex', flexDirection: phone ? 'column' : 'row', alignItems: phone ? 'stretch' : 'center', gap: phone ? 10 : 14,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          {rec ? <span aria-hidden className="wf-pulse" style={{ width: 14, height: 14, borderRadius: '50%', background: C.crit, boxShadow: `0 0 10px ${C.crit}`, margin: 7, flexShrink: 0 }} /> : mic}
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>{title}</span>
            <span style={{ display: 'block', fontSize: 12, color: C.t2, marginTop: 2 }}>
              {rec ? 'Toque em Parar quando terminar.' : `Será transcrita depois de enviar${duration > 120 ? ` (≈${Math.max(1, Math.round(duration / 60 / 15))} min)` : ''}. Aceita mp3, m4a, wav, ogg, webm, mp4.`}
            </span>
          </span>
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          {rec ? (
            <button type="button" style={small({ border: '1px solid rgba(240,98,114,.5)', color: '#f39aa4', flex: phone ? 1 : undefined })} onClick={stop}>■ Parar</button>
          ) : (
            <>
              <button type="button" style={small({ flex: phone ? 1 : undefined })} onClick={() => pick.current?.click()}>{file || received.length ? 'Trocar' : 'Escolher arquivo'}</button>
              <button type="button" style={small({ flex: phone ? 1 : undefined })} onClick={() => void start()}><span style={{ color: C.crit }}>●</span> Gravar agora</button>
            </>
          )}
        </span>
        <input
          ref={pick}
          type="file"
          accept={AUDIO_ACCEPT}
          hidden
          aria-label={`Arquivo de áudio: ${f.label}`}
          onChange={(e) => {
            const fl = e.target.files?.[0]
            if (fl) onFiles([fl])
            e.target.value = ''
          }}
        />
      </div>
      {url && !rec && <audio controls src={url} style={{ width: '100%', height: 36 }} aria-label="Prévia da gravação" />}
      {recErr && <span role="alert" style={{ fontSize: 12.5, color: '#f39aa4' }}>{recErr}</span>}
    </div>
  )
}

function Thumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useObjectUrl(file)
  return (
    <span style={{ position: 'relative', width: 84, height: 64, borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,.08)', flexShrink: 0 }}>
      {url && <img src={url} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      <button type="button" aria-label={`Remover ${file.name}`} onClick={onRemove} style={{ position: 'absolute', top: 2, right: 2, width: 24, height: 24, borderRadius: 8, border: 'none', background: 'rgba(6,7,13,.75)', color: C.text, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
    </span>
  )
}

function FilesField({ field: f, files, onFiles, received, invalid, phone, label }: Parameters<typeof FieldInput>[0] & { label: string }) {
  const pick = useRef<HTMLInputElement>(null)
  const images = f.kind === 'images'
  const add = (list: FileList | null) => {
    if (!list?.length) return
    const extra = Array.from(list).filter((x) => !images || x.type.startsWith('image/'))
    onFiles([...files, ...extra])
  }
  const remove = (i: number) => onFiles(files.filter((_, j) => j !== i))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files) }}>
      <span style={labelText}>{label}</span>
      {received.length > 0 && <span style={{ fontSize: 12.5, color: C.t2 }}>Já recebido: {received.map((r) => r.name).join(', ')}</span>}
      {images ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {files.map((fl, i) => <Thumb key={`${fl.name}-${i}`} file={fl} onRemove={() => remove(i)} />)}
          {phone && files.length === 0 ? (
            <button type="button" onClick={() => pick.current?.click()} style={{ flex: 1, height: 64, borderRadius: 10, border: `1px dashed ${invalid ? 'rgba(240,98,114,.6)' : 'rgba(255,255,255,.2)'}`, background: 'transparent', color: C.t2, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>
              Câmera ou galeria
            </button>
          ) : (
            <button type="button" aria-label="Adicionar imagem" onClick={() => pick.current?.click()} style={{ width: 84, height: 64, borderRadius: 10, border: `1px dashed ${invalid ? 'rgba(240,98,114,.6)' : 'rgba(255,255,255,.2)'}`, background: 'transparent', color: C.t2, fontSize: 22, cursor: 'pointer' }}>
              +
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {files.map((fl, i) => (
            <span key={`${fl.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: 'rgba(0,0,0,.2)', fontSize: 13 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fl.name}</span>
              <span style={{ color: C.t3, fontSize: 12, flexShrink: 0 }}>{fmtSize(fl.size)}</span>
              <button type="button" aria-label={`Remover ${fl.name}`} onClick={() => remove(i)} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent', color: '#f39aa4', cursor: 'pointer', fontSize: 16 }}>×</button>
            </span>
          ))}
          <button type="button" onClick={() => pick.current?.click()} style={{ height: 44, borderRadius: 10, border: `1px dashed ${invalid ? 'rgba(240,98,114,.6)' : 'rgba(255,255,255,.2)'}`, background: 'transparent', color: C.t2, fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer' }}>
            + {files.length ? 'Mais arquivos' : 'Escolher arquivos'}
          </button>
        </div>
      )}
      <input
        ref={pick}
        type="file"
        multiple
        accept={images ? 'image/*' : undefined}
        hidden
        aria-label={`Arquivos: ${f.label}`}
        onChange={(e) => {
          add(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
