import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { onSupportUpdated } from '../api/events'
import { C } from '../lib/colors'
import { toastErr, toastOk } from '../lib/feedback'
import { dayTime, hhmm } from '../lib/format'
import { useYui } from '../store/yui'

// Faixas do topo (ClientBanner.dc.html): "Suporte conectado" enquanto a equipe Atria está dentro da conta,
// o aviso não lido mandado pelo Atria Central (com "Entendi") e o toast "Atria OS atualizado para vX".

export interface AuthStatus {
  authed: boolean
  session?: 'owner' | 'support'
  version?: string
  support?: { active: boolean; since: string | null; expiresAt: string | null }
}
export interface Notice {
  id: string
  title: string
  body: string
  level: 'info' | 'warn' | 'crit'
  createdAt: string
  expiresAt: string | null
  readAt: string | null
}

const LEVEL = {
  info: { bg: 'rgba(103,216,242,.10)', border: 'rgba(103,216,242,.35)', title: '#a9e9f8', text: '#c9dfe8', meta: '#7f9aa6', btn: 'rgba(103,216,242,.2)', icon: C.cyan },
  warn: { bg: 'rgba(245,181,74,.10)', border: 'rgba(245,181,74,.35)', title: '#f5c97a', text: '#e3d3b0', meta: '#a99b7c', btn: 'rgba(245,181,74,.2)', icon: C.warn },
  crit: { bg: 'rgba(240,98,114,.10)', border: 'rgba(240,98,114,.4)', title: '#f7a3ad', text: '#ecc5ca', meta: '#a98088', btn: 'rgba(240,98,114,.22)', icon: C.crit },
} as const
const RANK = { crit: 0, warn: 1, info: 2 } as const
const VERSION_KEY = 'atria.version'

const read = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* navegação privada */
  }
}

export function SupportBanners({ onHeight }: { onHeight: (h: number) => void }) {
  const authed = useYui((s) => s.authed)
  const coarse = useYui((s) => s.coarse)
  const [st, setSt] = useState<AuthStatus | null>(null)
  const [notices, setNotices] = useState<Notice[]>([])
  const [busy, setBusy] = useState(false)
  const [updated, setUpdated] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    api
      .get<AuthStatus>('/api/auth/status')
      .then((r) => {
        setSt(r)
        // versão nova desde a última visita neste aparelho → toast
        const prev = read(VERSION_KEY)
        if (r.version && prev && prev !== r.version && /^v\d/.test(r.version)) setUpdated(r.version)
        if (r.version) write(VERSION_KEY, r.version)
      })
      .catch(() => {})
    api.get<Notice[]>('/api/notices').then(setNotices).catch(() => {})
  }, [])
  useEffect(() => {
    if (!authed) return
    load()
    const off = onSupportUpdated(load)
    const t = setInterval(load, 60_000) // expiração do suporte e dos avisos
    return () => {
      off()
      clearInterval(t)
    }
  }, [authed, load])

  useEffect(() => {
    if (!updated) return
    const t = setTimeout(() => setUpdated(null), 20_000)
    return () => clearTimeout(t)
  }, [updated])

  const support = st?.support?.active ? st.support : null
  const notice = notices.filter((n) => !n.readAt).sort((a, b) => RANK[a.level] - RANK[b.level] || b.createdAt.localeCompare(a.createdAt))[0]
  const more = notices.filter((n) => !n.readAt).length - 1

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return onHeight(0)
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight))
    ro.observe(el)
    onHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [support, notice, onHeight])

  const endAccess = async () => {
    setBusy(true)
    try {
      await api.del('/api/support/sessions')
      toastOk(st?.session === 'support' ? 'Você saiu do suporte.' : 'Acesso do suporte encerrado.')
      load()
    } catch (e) {
      toastErr(e, 'Não consegui encerrar o acesso')
    } finally {
      setBusy(false)
    }
  }
  const ack = async (id: string) => {
    setNotices((list) => list.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)))
    await api.post(`/api/notices/${encodeURIComponent(id)}/read`).catch(() => {})
  }

  const btnH = coarse ? 44 : 34
  const L = notice ? LEVEL[notice.level] : null

  return (
    <>
      {(support || notice) && (
        <div ref={box} style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60, paddingTop: 'var(--sat)', background: '#06070d' }}>
          {support && (
            <div role="status" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 12px', padding: '10px calc(16px + var(--sar)) 10px calc(16px + var(--sal))', background: 'rgba(103,216,242,.12)', borderBottom: '1px solid rgba(103,216,242,.3)', fontSize: 14, color: C.text }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: C.cyan, flex: '0 0 auto' }} />
              <span style={{ flex: '1 1 240px', minWidth: 0 }}>
                <b>{st?.session === 'support' ? 'Você está como suporte' : 'Suporte conectado'}</b>
                {st?.session === 'support' ? ' · o cliente vê esta faixa' : ' · a equipe Atria está acessando sua conta para ajudar'} · desde {hhmm(support.since)}, expira {hhmm(support.expiresAt)}
              </span>
              <button type="button" disabled={busy} onClick={() => void endAccess()} style={{ height: btnH, padding: '0 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: C.text, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                {st?.session === 'support' ? 'Sair do suporte' : 'Encerrar acesso'}
              </button>
            </div>
          )}
          {notice && L && (
            <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, margin: '12px calc(16px + var(--sar)) 4px calc(16px + var(--sal))', padding: '14px 18px', borderRadius: 14, background: L.bg, border: `1px solid ${L.border}` }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={L.icon} strokeWidth="2" strokeLinecap="round" aria-hidden style={{ flex: '0 0 auto', marginTop: 1 }}>
                {notice.level === 'info' ? <path d="M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7.5h.01" /> : <path d="M12 3l10 18H2zM12 10v5M12 18h.01" />}
              </svg>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: L.title, overflowWrap: 'anywhere' }}>{notice.title}</div>
                {notice.body && <div style={{ fontSize: 14, color: L.text, marginTop: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '30dvh', overflowY: 'auto' }}>{notice.body}</div>}
                <div style={{ fontSize: 12, color: L.meta, marginTop: 6 }}>
                  Aviso da equipe Atria · {dayTime(notice.createdAt)}
                  {more > 0 && ` · mais ${more} ${more === 1 ? 'aviso' : 'avisos'}`}
                </div>
              </div>
              <button type="button" onClick={() => void ack(notice.id)} style={{ height: btnH, padding: '0 14px', borderRadius: 10, border: 0, background: L.btn, color: L.title, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', marginLeft: 'auto' }}>
                Entendi
              </button>
            </div>
          )}
        </div>
      )}
      {updated && (
        <div role="status" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(96px + var(--sab))', zIndex: 61, display: 'flex', alignItems: 'center', gap: 12, width: 'max-content', maxWidth: 'calc(100% - 32px)', boxSizing: 'border-box', padding: '10px 10px 10px 16px', borderRadius: 14, background: 'rgba(14,30,30,.95)', border: '1px solid rgba(79,224,176,.3)', backdropFilter: 'blur(16px)', boxShadow: '0 18px 50px rgba(0,0,0,.45)', fontSize: 14, color: C.text }}>
          <span aria-hidden style={{ color: C.ok }}>✓</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            Atria OS atualizado para <b>{updated}</b>.
          </span>
          <button type="button" onClick={() => setUpdated(null)} style={{ height: btnH, padding: '0 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: C.text, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>
            Fechar
          </button>
        </div>
      )}
    </>
  )
}
