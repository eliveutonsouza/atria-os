import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { api, ApiError } from '../api/client'
import { C } from '../lib/colors'
import { greeting } from '../lib/format'
import { useYui } from '../store/yui'
import { OrbLayer } from './parts'

export function Login() {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    useYui.getState().set({ mode: 'center', yst: 'idle' })
    ref.current?.focus()
  }, [])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!pw || busy) return
    setBusy(true)
    setErr('')
    useYui.getState().set({ yst: 'thinking' })
    try {
      await api.post('/api/auth/login', { password: pw })
      useYui.getState().set({ authed: null, yst: 'success' })
      nav('/', { replace: true })
    } catch (e2) {
      useYui.getState().set({ yst: 'warning' })
      setErr(e2 instanceof ApiError && e2.status === 429 ? 'Muitas tentativas. Espere um pouco.' : 'Senha incorreta.')
      setTimeout(() => useYui.getState().set({ yst: 'idle' }), 1400)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'radial-gradient(120% 90% at 50% 28%, #0f1533 0%, #0a0c1d 45%, #06070d 100%)' }}>
      <OrbLayer />
      <form
        onSubmit={submit}
        style={{ position: 'absolute', left: 0, right: 0, top: 'calc(36% + 104px)', zIndex: 25, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '0 24px', textAlign: 'center' }}
      >
        <div style={{ fontSize: 11, letterSpacing: '.32em', color: C.t2, fontWeight: 600 }}>YUI CONSOLE</div>
        <div style={{ fontSize: 30, fontWeight: 300, lineHeight: 1.3 }}>{greeting()} Quem é você?</div>
        <div style={{ width: 'min(420px,100%)', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 7px 7px 16px', background: 'rgba(16,20,42,.78)', border: `1px solid ${err ? 'rgba(240,98,114,.45)' : 'rgba(160,170,255,.14)'}`, borderRadius: 18, backdropFilter: 'blur(16px)', marginTop: 12 }}>
          <input
            ref={ref}
            type="password"
            autoComplete="current-password"
            aria-label="Senha"
            placeholder="Senha"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            style={{ flex: 1, minWidth: 0, height: 40, border: 'none', outline: 'none', background: 'transparent', color: C.text, fontSize: 15, fontFamily: 'var(--sans)' }}
          />
          <button type="submit" aria-label="Entrar" disabled={busy} style={{ width: 40, height: 40, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#67d8f2,#a68cf7)', color: '#0a0c1d', fontSize: 17, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>→</button>
        </div>
        <div role="alert" style={{ minHeight: 20, fontSize: 13, color: '#f39aa4' }}>{err}</div>
      </form>
    </main>
  )
}
