import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { api, ApiError } from '../api/client'
import { C } from '../lib/colors'
import { greeting } from '../lib/format'
import { useYui } from '../store/yui'
import { OrbLayer } from './parts'

const field = { flex: 1, minWidth: 0, height: 40, border: 'none', outline: 'none', background: 'transparent', color: C.text, fontSize: 15, fontFamily: 'var(--sans)' } as const
const box = (err: boolean) =>
  ({ width: 'min(420px,100%)', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 7px 7px 16px', background: 'rgba(16,20,42,.78)', border: `1px solid ${err ? 'rgba(240,98,114,.45)' : 'rgba(160,170,255,.14)'}`, borderRadius: 18, backdropFilter: 'blur(16px)' }) as const

// Posição do formulário: ~36% + offset abaixo do orbe, mas sobe (sem passar da safe area) quando a altura
// visível encolhe (celular deitado, teclado aberto — o main termina em var(--kb)). h = altura aproximada do form.
const formBox = (offset: number, h: number) => {
  const top = `max(calc(12px + var(--sat, 0px)), min(calc(36% + ${offset}px), calc(100% - ${h}px - var(--sab, 0px))))`
  return { top, maxHeight: `calc(100% - ${top})`, overflowY: 'auto', padding: '0 calc(24px + var(--sar, 0px)) calc(8px + var(--sab, 0px)) calc(24px + var(--sal, 0px))' } as const
}
const mainBox = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 'var(--kb, 0px)', overflow: 'hidden', background: 'radial-gradient(120% 90% at 50% 28%, #0f1533 0%, #0a0c1d 45%, #06070d 100%)' } as const

// Instalação nova: ninguém tem senha ainda — quem abre o painel cria o acesso.
function CreateAccess() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (pw.length < 8) return setErr('A senha precisa de pelo menos 8 caracteres.')
    if (pw !== pw2) return setErr('As senhas não conferem.')
    setBusy(true)
    setErr('')
    useYui.getState().set({ yst: 'thinking' })
    try {
      await api.post('/api/auth/setup', { password: pw, name, email })
      useYui.getState().set({ authed: null, yst: 'success' })
      nav('/app/settings', { replace: true })
    } catch (e2) {
      useYui.getState().set({ yst: 'warning' })
      setErr(e2 instanceof ApiError ? e2.message : 'Não consegui criar o acesso.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} style={{ position: 'absolute', left: 0, right: 0, ...formBox(96, 400), zIndex: 25, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 11, letterSpacing: '.32em', color: C.t2, fontWeight: 600 }}>ATRIA OS · PRIMEIRO ACESSO</div>
      <div style={{ fontSize: 28, fontWeight: 300, lineHeight: 1.3 }}>Olá. Vamos criar o seu acesso.</div>
      <div style={{ fontSize: 14, color: C.t2, maxWidth: 420, marginBottom: 6 }}>Depois eu te guio para conectar sua conta Claude, o GitHub e a OpenAI aqui mesmo no painel.</div>
      <label style={box(false)}><input aria-label="Seu nome" placeholder="Seu nome" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} style={field} /></label>
      <label style={box(false)}><input aria-label="E-mail (notificações)" type="email" placeholder="E-mail (opcional, para avisos)" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={field} /></label>
      <label style={box(!!err)}><input aria-label="Senha" type="password" placeholder="Senha (mín. 8 caracteres)" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} style={field} /></label>
      <label style={box(!!err)}>
        <input aria-label="Confirme a senha" type="password" placeholder="Confirme a senha" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} style={field} />
        <button type="submit" aria-label="Criar acesso" disabled={busy} style={{ width: 40, height: 40, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#67d8f2,#a68cf7)', color: '#0a0c1d', fontSize: 17, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>→</button>
      </label>
      <div role="alert" style={{ minHeight: 20, fontSize: 13, color: '#f39aa4' }}>{err}</div>
    </form>
  )
}

export function Login() {
  const [needsPassword, setNeedsPassword] = useState<boolean | null>(null)
  useEffect(() => {
    api.get<{ needsPassword: boolean }>('/api/auth/setup').then((r) => setNeedsPassword(r.needsPassword)).catch(() => setNeedsPassword(false))
  }, [])
  if (needsPassword === null) return <main style={{ position: 'fixed', inset: 0, background: '#06070d' }} />
  if (needsPassword)
    return (
      <main style={mainBox}>
        <OrbLayer />
        <CreateAccess />
      </main>
    )
  return <PasswordLogin />
}

function PasswordLogin() {
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
    <main style={mainBox}>
      <OrbLayer />
      <form
        onSubmit={submit}
        style={{ position: 'absolute', left: 0, right: 0, ...formBox(104, 210), zIndex: 25, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, letterSpacing: '.32em', color: C.t2, fontWeight: 600 }}>
          <img src="/favicon.svg" alt="" width={22} height={22} style={{ borderRadius: 6 }} />
          ATRIA OS
        </div>
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
