import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { TelemetrySnapshot } from '@shared/telemetry'
import { api } from '../../../api/client'
import { C } from '../../../lib/colors'
import { ago } from '../../../lib/format'
import { useYui } from '../../../store/yui'
import { input, SmallBtn } from '../../../views/kit'
import { SaveMsg, Section, SettingsLoadError, useSettings } from './sections'

// Configurações › Sistema › Monitoramento remoto (YuiMonitoramento.dc.html): pulso para o Atria Central
// do administrador, URL de saúde protegida pela mesma chave e a prévia do que sai desta VPS.

interface PulseResult { at: string; ok: boolean; status: number | null; ms: number; error: string | null }
interface MonitorStatus { enabled: boolean; url: string; hasKey: boolean; last: PulseResult | null; instanceId: string; version: string }

const since = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  return s < 60 ? `há ${Math.max(0, s)} s` : ago(iso)
}

function Row({ label, hint, children, last }: { label: string; hint?: string; children: ReactNode; last?: boolean }) {
  const phone = useYui((s) => s.device === 'phone')
  return (
    <div style={{ display: 'grid', gridTemplateColumns: phone ? 'minmax(0,1fr)' : '220px minmax(0,1fr)', gap: phone ? 8 : 20, padding: '12px 0', borderBottom: last ? 'none' : '1px solid rgba(255,255,255,.06)', alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</span>
        {hint && <span style={{ fontSize: 12.5, color: C.t2, lineHeight: 1.45 }}>{hint}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>{children}</div>
    </div>
  )
}

export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{ flex: '0 0 auto', width: 40, height: 22, borderRadius: 11, border: 'none', padding: 0, cursor: 'pointer', position: 'relative', background: on ? C.cyan : 'rgba(255,255,255,.14)' }}
    >
      <span aria-hidden style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: on ? '#0a0c1d' : '#c9cde0', transition: 'left .15s' }} />
    </button>
  )
}

export function MonitorSection() {
  const settings = useSettings()
  const { data, save, msg, saving } = settings
  const [st, setSt] = useState<MonitorStatus | null>(null)
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [preview, setPreview] = useState<TelemetrySnapshot | null>(null)
  const load = useCallback(() => api.get<MonitorStatus>('/api/telemetry/status').then(setSt).catch(() => {}), [])
  useEffect(() => {
    void load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])
  useEffect(() => {
    if (data) setUrl(String(data.values['monitor.url'] ?? ''))
  }, [data])

  const healthUrl = `${location.origin}/api/telemetry`
  const hasKey = !!data?.secrets['monitor.key']
  const toggle = async (v: boolean) => {
    if (await save({ 'monitor.enabled': v })) void load()
  }
  const saveConn = async () => {
    if (await save({ 'monitor.url': url.trim(), 'monitor.key': key.trim() })) {
      setKey('')
      void load()
    }
  }
  const runTest = async () => {
    setTesting(true)
    setTest(null)
    const r = await api
      .post<{ ok: boolean; status: number | null; ms: number; error: string | null }>('/api/telemetry/test', { url: url.trim() || undefined, key: key.trim() || undefined })
      .catch(() => ({ ok: false, status: null, ms: 0, error: 'falhou' }))
    setTest(r.ok ? { ok: true, text: `Conectado · ${r.status} em ${r.ms} ms` } : { ok: false, text: `Falhou: ${r.error ?? r.status}` })
    setTesting(false)
    void load()
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(healthUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      useYui.getState().say('Não consegui copiar; selecione o endereço e copie à mão.')
    }
  }

  const last = st?.last
  const statusText = !st
    ? 'Lendo…'
    : !st.enabled
      ? 'Desligado'
      : !st.url || !st.hasKey
        ? 'Ligado · falta o endereço ou a chave'
        : !last
          ? 'Ligado · aguardando o primeiro envio'
          : last.ok
            ? `Ligado · último envio ${since(last.at)} (${last.status} ok)`
            : `Ligado · último envio falhou ${since(last.at)} (${last.error ?? last.status})`
  const statusColor = !st?.enabled ? C.t2 : last?.ok ? C.ok : C.warn

  return (
    <Section title="Monitoramento remoto" hint="Para quem administra várias instalações do Atria OS: um painel de fora acompanha a saúde desta instância.">
      <SettingsLoadError s={settings} />
      <div>
        <Row label="Monitoramento remoto" hint="Envia um pulso a cada 30 s para o painel do administrador.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minHeight: 36 }}>
            <Switch on={!!st?.enabled} label="Ligar monitoramento remoto" onChange={toggle} />
            <span role="status" style={{ fontSize: 13, color: statusColor, overflowWrap: 'anywhere' }}>{statusText}</span>
          </div>
        </Row>
        <Row label="Endereço do monitor">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://central.seudominio.com" inputMode="url" autoComplete="off" spellCheck={false} aria-label="Endereço do monitor" style={{ ...input, maxWidth: 460 }} className="mono" />
        </Row>
        <Row label="Chave da instância" hint="Gerada no Atria Central ao cadastrar esta instalação.">
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? '•••••••• guardada (vazio = não mudar)' : 'atk_…'} autoComplete="off" aria-label="Chave da instância" style={{ ...input, maxWidth: 460 }} className="mono" />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <SmallBtn primary disabled={!data || saving} onClick={() => void saveConn()}>{saving ? 'Salvando…' : 'Salvar'}</SmallBtn>
            <SmallBtn disabled={testing} onClick={() => void runTest()}>{testing ? 'Testando…' : 'Testar conexão'}</SmallBtn>
            <SaveMsg msg={test ?? msg} />
          </div>
        </Row>
        <Row label="URL de saúde" hint="O monitor também consulta esta URL para detalhes e quando o pulso atrasa.">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input readOnly value={healthUrl} aria-label="URL de saúde" onFocus={(e) => e.currentTarget.select()} style={{ ...input, flex: '1 1 240px', maxWidth: 400 }} className="mono" />
            <SmallBtn onClick={() => void copy()}>{copied ? 'Copiado' : 'Copiar'}</SmallBtn>
          </div>
          <span style={{ fontSize: 12.5, color: C.t2 }}>Protegida pela mesma chave (cabeçalho Authorization). Sem a chave responde 401.</span>
        </Row>
        <Row label="O que é enviado" hint="Só métricas. Conversas, documentos, tarefas e resultados nunca saem desta VPS." last>
          <details onToggle={(e) => { if (e.currentTarget.open && !preview) api.get<TelemetrySnapshot>('/api/telemetry/preview').then(setPreview).catch(() => {}) }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: C.cyan, minHeight: 32, display: 'flex', alignItems: 'center' }}>Ver o JSON de agora</summary>
            <pre className="mono" style={{ margin: '8px 0 0', maxHeight: 360, overflow: 'auto', maxWidth: '100%', padding: '12px 14px', borderRadius: 12, background: '#0a0c17', border: '1px solid rgba(255,255,255,.08)', fontSize: 12, lineHeight: 1.55, color: '#c9cde0' }}>
              {preview ? JSON.stringify(preview, null, 2) : 'Carregando…'}
            </pre>
          </details>
        </Row>
      </div>
    </Section>
  )
}
