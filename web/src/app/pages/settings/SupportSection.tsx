import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from '../../../api/client'
import { onSupportUpdated } from '../../../api/events'
import { C } from '../../../lib/colors'
import { toastErr, toastOk } from '../../../lib/feedback'
import { dayTime, hhmm } from '../../../lib/format'
import { SmallBtn } from '../../../views/kit'
import type { AuthStatus } from '../../../shell/SupportBanners'
import { panel, SaveMsg, SettingsLoadError, useSettings } from './sections'

// Configurações › Suporte e atualizações (ClientSettings.dc.html): o cliente decide se a equipe Atria
// pode entrar para ajudar e se aceita atualizações mandadas pelo Atria Central; vê cada acesso e a versão.

interface Access { id: string; by: string | null; startedAt: string; expiresAt: string; endedAt: string | null; endedBy: string | null; active: boolean }
interface LocalUpdate { jobId: string; tag: string; step: string; startedAt: string; finishedAt: string | null; result: 'done' | 'rolled_back' | 'failed' | 'refused' | null; error: string | null }
interface UpdatesStatus {
  version: string
  allowRemote: boolean
  updater: { status: 'ready' | 'busy' | 'missing' | 'error'; tag: string | null; step: string | null; version: string | null }
  current: LocalUpdate | null
  queueHeld: boolean
}

const ENDED: Record<string, string> = {
  client: 'encerrado por você',
  support: 'encerrado pelo suporte',
  central: 'encerrado pela equipe',
  password: 'encerrado (senha trocada)',
  expired: 'expirou',
}
const STEP: Record<string, string> = {
  received: 'pedido recebido',
  draining: 'esperando as execuções terminarem',
  pulling: 'baixando a nova versão',
  restarting: 'reiniciando',
}
const UPDATER: Record<UpdatesStatus['updater']['status'], [string, string]> = {
  ready: ['pronto', C.ok],
  busy: ['atualizando…', C.cyan],
  error: ['com erro', C.crit],
  missing: ['não instalado', C.t3],
}

const minutes = (a: string, b: string) => {
  const m = Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60_000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

function Toggle({ on, title, hint, disabled, onChange }: { on: boolean; title: string; hint: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 44, padding: 0, border: 'none', background: 'transparent', color: C.text, textAlign: 'left', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, fontFamily: 'inherit', width: '100%' }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 13, color: C.t2, lineHeight: 1.45 }}>{hint}</span>
      </span>
      <span aria-hidden style={{ flex: '0 0 auto', width: 44, height: 24, borderRadius: 12, position: 'relative', background: on ? C.ok : 'rgba(255,255,255,.14)', transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: on ? '#0a0c1d' : C.soft, transition: 'left .15s' }} />
      </span>
    </button>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ ...panel, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div className="eyebrow">{title}</div>
      {children}
    </section>
  )
}

function UpdateNote({ u, now }: { u: LocalUpdate; now: number }) {
  const box = (color: string, text: ReactNode) => (
    <div role="status" style={{ padding: '12px 14px', borderRadius: 12, background: `${color}14`, border: `1px solid ${color}40`, fontSize: 14, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{text}</div>
  )
  if (!u.finishedAt) return box(C.cyan, <>Atualização para <b>{u.tag}</b> em andamento · {STEP[u.step] ?? u.step}. As execuções novas esperam na fila até terminar.</>)
  if (now - Date.parse(u.finishedAt) > 7 * 86400_000) return null
  if (u.result === 'done') return box(C.ok, <>Atualizado para <b>{u.tag}</b> · {dayTime(u.finishedAt)}</>)
  if (u.result === 'refused') return box(C.warn, <>A equipe Atria pediu a atualização para <b>{u.tag}</b> · {dayTime(u.finishedAt)}. Recusada porque as atualizações estão desligadas.</>)
  if (u.result === 'rolled_back') return box(C.warn, <>A atualização para <b>{u.tag}</b> não ficou saudável e voltou sozinha para a versão anterior · {dayTime(u.finishedAt)}</>)
  return box(C.crit, <>A atualização para <b>{u.tag}</b> falhou · {dayTime(u.finishedAt)}{u.error ? ` · ${u.error}` : ''}</>)
}

export function SupportSection() {
  const settings = useSettings()
  const { data, save, msg, saving } = settings
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [history, setHistory] = useState<Access[] | null>(null)
  const [histErr, setHistErr] = useState(false)
  const [upd, setUpd] = useState<UpdatesStatus | null>(null)
  const [ending, setEnding] = useState(false)
  const [now, setNow] = useState(() => Date.now()) // relógio da última leitura (duração do acesso ativo)

  const load = useCallback(() => {
    api.get<AuthStatus>('/api/auth/status').then(setAuth).catch(() => {})
    api
      .get<Access[]>('/api/support/sessions')
      .then((h) => {
        setHistory(h)
        setHistErr(false)
        setNow(Date.now())
      })
      .catch(() => setHistErr(true))
    api.get<UpdatesStatus>('/api/updates/status').then(setUpd).catch(() => {})
  }, [])
  const running = !!upd?.current && !upd.current.finishedAt
  useEffect(() => {
    load()
    const off = onSupportUpdated(load)
    const t = setInterval(load, running ? 15_000 : 60_000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [load, running])

  // até carregar, os interruptores ficam desligados e bloqueados (não mostram um estado que não é o real)
  const remote = data ? data.values['support.remoteAccess'] !== false : false
  const allowUpdates = data ? data.values['update.allowRemote'] !== false : false
  const support = auth?.support?.active ? auth.support : null
  const asSupport = auth?.session === 'support'
  const endAccess = async () => {
    setEnding(true)
    try {
      await api.del('/api/support/sessions')
      toastOk(asSupport ? 'Você saiu do suporte.' : 'Acesso do suporte encerrado.')
      load()
    } catch (e) {
      toastErr(e, 'Não consegui encerrar o acesso')
    } finally {
      setEnding(false)
    }
  }
  const [uLabel, uColor] = UPDATER[upd?.updater.status ?? 'missing']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SettingsLoadError s={settings} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16, alignItems: 'start' }}>
        <Card title="Suporte remoto">
          <Toggle on={remote} title="Permitir que a equipe Atria acesse para ajudar" hint="Cada acesso aparece numa faixa no topo e fica registrado. Dura no máximo 2 h." disabled={!data || saving} onChange={(v) => void save({ 'support.remoteAccess': v })} />
          {support && (
            <div role="status" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(103,216,242,.08)', border: '1px solid rgba(103,216,242,.25)', fontSize: 14 }}>
              <span style={{ flex: '1 1 200px' }}>
                <b>Suporte conectado</b> desde {hhmm(support.since)}, expira {hhmm(support.expiresAt)}
              </span>
              <SmallBtn disabled={ending} onClick={() => void endAccess()}>{asSupport ? 'Sair do suporte' : 'Encerrar acesso'}</SmallBtn>
            </div>
          )}
          <div className="eyebrow" style={{ fontSize: 12, letterSpacing: '.1em' }}>Acessos recentes</div>
          <div>
            {history === null && (histErr ? (
              <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13, color: C.t2 }}>
                Não consegui carregar os acessos.
                <SmallBtn onClick={load}>Tentar de novo</SmallBtn>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: C.t3 }}>Carregando…</div>
            ))}
            {history?.length === 0 && <div style={{ fontSize: 13, color: C.t2 }}>Nenhum acesso do suporte até agora.</div>}
            {history?.slice(0, 8).map((a, i, list) => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 14, padding: '8px 0', borderBottom: i < list.length - 1 ? '1px solid rgba(255,255,255,.05)' : 'none' }}>
                <span>
                  {dayTime(a.startedAt)} · {a.active ? `${minutes(a.startedAt, new Date(now).toISOString())} até agora` : minutes(a.startedAt, a.endedAt ?? a.expiresAt)}
                </span>
                <span style={{ color: a.active ? C.cyan : C.t2 }}>{a.active ? 'conectado agora' : ENDED[a.endedBy ?? ''] ?? 'encerrado'}</span>
              </div>
            ))}
          </div>
        </Card>
  
        <Card title="Atualizações">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontSize: 14, color: C.t2 }}>Versão instalada</span>
            <span className="mono" style={{ fontSize: 18, overflowWrap: 'anywhere' }}>{upd?.version ?? auth?.version ?? '—'}</span>
          </div>
          {upd?.current && <UpdateNote u={upd.current} now={now} />}
          <Toggle on={allowUpdates} title="Aceitar atualizações da equipe Atria" hint="Desligado, as atualizações ficam pausadas até você ligar de novo. Quando a equipe agenda uma, um aviso aparece no topo um dia antes." disabled={!data || saving} onChange={(v) => void save({ 'update.allowRemote': v })} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: C.t2 }}>
            <span>Atualizador</span>
            <span style={{ color: uColor }}>
              {uLabel}
              {upd?.updater.status === 'busy' && upd.updater.step ? ` · ${upd.updater.step}` : ''}
            </span>
          </div>
          {upd?.updater.status === 'missing' && (
            <div style={{ fontSize: 12.5, color: C.t3, lineHeight: 1.45 }}>Esta instalação é atualizada direto no servidor (por um técnico, com ./install.sh --update). A atualização pela equipe Atria vale para instalações feitas pelo comando do Atria Central.</div>
          )}
        </Card>
      </div>
      <SaveMsg msg={msg} />
    </div>
  )
}
