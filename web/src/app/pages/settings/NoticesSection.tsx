import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { NotifyChannel, NotifyStatus } from '@shared/protocol'
import { api, ApiError } from '../../../api/client'
import { C } from '../../../lib/colors'
import { useYui } from '../../../store/yui'
import { input, StatusPill } from '../../../views/kit'
import { bigBtn, SaveMsg, Section, useSettings } from './sections'

// Configurações › Avisos (Settings.dc.html do canvas de workflows): Telegram, e-mail (Resend) e celular (push).
// Usados pelos passos "Avisar" e "Pedir informação" dos workflows.

type Msg = { ok: boolean; text: string } | null

function useNotifyStatus() {
  const [st, setSt] = useState<NotifyStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const load = useCallback(
    () =>
      api
        .get<NotifyStatus>('/api/notify/status')
        .then((s) => {
          setSt(s)
          setFailed(false)
        })
        .catch(() => setFailed(true)),
    [],
  )
  useEffect(() => {
    void load()
  }, [load])
  return { st, failed, reload: load }
}

async function sendTest(channel: NotifyChannel): Promise<Msg> {
  try {
    const r = await api.post<{ ok: boolean; error?: string }>('/api/notify/test', { channel })
    return r.ok ? { ok: true, text: 'Teste enviado — confira.' } : { ok: false, text: r.error ?? 'Não consegui enviar.' }
  } catch (e) {
    return { ok: false, text: e instanceof ApiError ? e.message : 'Não consegui enviar.' }
  }
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: '#c9cde0', lineHeight: 1.5 }}>
      <span aria-hidden style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(103,216,242,.12)', color: '#a9e9f8', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{n}</span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </li>
  )
}

const row = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } as const

export function NoticesSection() {
  const { st, failed, reload } = useNotifyStatus()
  const { data, save } = useSettings()
  const [token, setToken] = useState('')
  const [tgMsg, setTgMsg] = useState<Msg>(null)
  const [mailMsg, setMailMsg] = useState<Msg>(null)
  const [hoursMsg, setHoursMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [mail, setMail] = useState({ from: '', to: '' })
  const [resendKey, setResendKey] = useState('')
  const [hours, setHours] = useState(24)
  const phone = useYui((s) => s.device === 'phone')

  useEffect(() => {
    if (!data) return
    setMail({ from: String(data.values['notify.email.from'] ?? ''), to: String(data.values['notify.email.to'] ?? '') })
    setHours(Number(data.values['notify.remindHours'] ?? 24) || 24)
  }, [data])

  const tg = st?.telegram
  // enquanto espera o "/start <código>", confere o vínculo a cada 4 s
  const waitingLink = !!tg?.configured && !tg.linked
  useEffect(() => {
    if (!waitingLink) return
    const t = setInterval(() => void reload(), 4000)
    return () => clearInterval(t)
  }, [waitingLink, reload])

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }
  const saveToken = () =>
    act('token', async () => {
      if (await save({ 'notify.telegram.token': token.trim() })) {
        setToken('')
        setTgMsg({ ok: true, text: 'Token salvo.' })
        await reload()
      } else setTgMsg({ ok: false, text: 'Não consegui salvar o token.' })
    })
  const newCode = () =>
    act('code', async () => {
      try {
        await api.post<{ code: string }>('/api/notify/telegram/link-code')
        await reload()
      } catch (e) {
        setTgMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Não consegui gerar o código.' })
      }
    })
  const unlink = () =>
    act('unlink', async () => {
      try {
        await api.del('/api/notify/telegram/link')
        setTgMsg({ ok: true, text: 'Chat desvinculado. Gere um código novo para ligar outro.' })
        await reload()
      } catch {
        setTgMsg({ ok: false, text: 'Não consegui desvincular agora.' })
      }
    })
  const saveMail = () =>
    act('mail', async () => {
      const patch: Record<string, unknown> = { 'notify.email.from': mail.from.trim(), 'notify.email.to': mail.to.trim() }
      if (resendKey.trim()) patch['notify.email.resendKey'] = resendKey.trim()
      if (await save(patch)) {
        setResendKey('')
        setMailMsg({ ok: true, text: 'Salvo.' })
        await reload()
      } else setMailMsg({ ok: false, text: 'Não consegui salvar.' })
    })
  const saveHours = () =>
    act('hours', async () => {
      const ok = await save({ 'notify.remindHours': Math.max(1, Math.min(720, Math.round(hours))) })
      setHoursMsg(ok ? { ok: true, text: 'Salvo.' } : { ok: false, text: 'Não consegui salvar.' })
    })

  if (failed && !st)
    return (
      <Section title="Avisos" hint="Não consegui ler o estado dos avisos agora.">
        <div>
          <button type="button" style={bigBtn()} onClick={() => void reload()}>Tentar de novo</button>
        </div>
      </Section>
    )

  const tgPill = !tg ? <StatusPill label="verificando…" color={C.t3} /> : tg.linked ? <StatusPill label="ligado" color={C.ok} /> : tg.configured ? <StatusPill label="falta ligar o chat" color={C.warn} /> : <StatusPill label="não configurado" color={C.t3} />
  const startCmd = tg?.linkCode ? `/start ${tg.linkCode}` : null
  const deepLink = tg?.botName && tg.linkCode ? `https://t.me/${tg.botName.replace(/^@/, '')}?start=${encodeURIComponent(tg.linkCode)}` : null
  const em = st?.email

  return (
    <>
      <Section title="Avisos (Telegram, e-mail e celular)" hint="Por onde os workflows te avisam — o passo “Avisar” manda mensagens e o “Pedir informação” para e espera a sua resposta.">
        <span style={{ fontSize: 12.5, color: C.t3 }}>Cada passo escolhe os canais. Canal não configurado aqui fica de fora, sem travar o fluxo.</span>
      </Section>

      <Section title="Telegram" hint="Recebe avisos e responde pedidos: mande áudio, foto ou texto respondendo a mensagem do bot.">
        <div style={{ ...row, justifyContent: 'space-between' }}>
          {tgPill}
          {tg?.botName && <span style={{ fontSize: 12.5, color: C.t2 }}>Bot: @{tg.botName.replace(/^@/, '')}</span>}
        </div>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Step n={1}>
            No Telegram, fale com <b>@BotFather</b> → <span className="mono">/newbot</span> e escolha um nome.
          </Step>
          <Step n={2}>Cole o token que ele te der aqui.</Step>
          <Step n={3}>
            Mande <span className="mono">{startCmd ?? '/start <código>'}</span> para o seu bot — o Atria reconhece o seu chat e só ele passa a ser aceito.
          </Step>
        </ol>
        <div style={row}>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={data?.secrets['notify.telegram.token'] ? '•••••••• (configurado — cole outro para trocar)' : '123456789:AA…'}
            aria-label="Token do bot"
            autoComplete="off"
            style={{ ...input, maxWidth: phone ? undefined : 460 }}
          />
          <button type="button" style={bigBtn(true)} disabled={!token.trim() || busy === 'token'} onClick={() => void saveToken()}>{busy === 'token' ? 'Salvando…' : 'Salvar token'}</button>
        </div>
        {tg?.configured && !tg.linked && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: 12, background: 'rgba(103,216,242,.06)', border: '1px solid rgba(103,216,242,.25)' }}>
            {startCmd ? (
              <>
                <span style={{ fontSize: 13 }}>
                  Código de vínculo: <b className="mono" style={{ fontSize: 15, letterSpacing: '.08em' }}>{tg.linkCode}</b>
                </span>
                <span style={{ fontSize: 12.5, color: C.t2 }}>Mande <span className="mono">{startCmd}</span> para o bot. Esta tela atualiza sozinha quando o chat ligar.</span>
              </>
            ) : (
              <span style={{ fontSize: 12.5, color: C.t2 }}>Gere um código e mande para o bot para ligar o seu chat.</span>
            )}
            <div style={row}>
              {deepLink && (
                <a href={deepLink} target="_blank" rel="noreferrer" style={{ ...bigBtn(true), display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
                  Abrir o bot no Telegram
                </a>
              )}
              {startCmd && (
                <button type="button" style={bigBtn()} onClick={() => void navigator.clipboard?.writeText(startCmd).then(() => setTgMsg({ ok: true, text: 'Copiado.' }))}>
                  Copiar comando
                </button>
              )}
              <button type="button" style={bigBtn()} disabled={busy === 'code'} onClick={() => void newCode()}>{startCmd ? 'Gerar outro código' : 'Gerar código'}</button>
            </div>
          </div>
        )}
        {tg?.linked && (
          <div style={{ ...row, fontSize: 13 }}>
            <span>
              Chat ligado: <b>{tg.chatName ?? 'seu chat'}</b> <span style={{ color: C.t3 }}>· só este chat é aceito</span>
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" style={{ ...bigBtn(), color: '#f39aa4' }} disabled={busy === 'unlink'} onClick={() => void unlink()}>Desvincular</button>
          </div>
        )}
        {tg?.error && <span role="alert" style={{ fontSize: 12.5, color: '#f39aa4' }}>{tg.error}</span>}
        <div style={row}>
          <button type="button" style={bigBtn()} disabled={!tg?.linked || busy === 'tg-test'} onClick={() => void act('tg-test', async () => setTgMsg(await sendTest('telegram')))}>
            {busy === 'tg-test' ? 'Enviando…' : 'Mandar teste'}
          </button>
          <SaveMsg msg={tgMsg} />
        </div>
      </Section>

      <Section title="E-mail" hint="Pelo Resend (resend.com): crie uma chave de API e verifique o domínio do remetente. Anexos até 10 MB.">
        <div style={{ ...row, justifyContent: 'space-between' }}>
          {em ? <StatusPill label={em.configured ? `configurado${em.to ? ` · para ${em.to}` : ''}` : 'não configurado'} color={em.configured ? C.ok : C.t3} /> : <StatusPill label="verificando…" color={C.t3} />}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: phone ? 'minmax(0,1fr)' : 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <span className="eyebrow">Chave da Resend</span>
            <input type="password" value={resendKey} onChange={(e) => setResendKey(e.target.value)} placeholder={data?.secrets['notify.email.resendKey'] ? '•••••••• (configurada)' : 're_…'} autoComplete="off" style={input} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <span className="eyebrow">Remetente</span>
            <input type="email" value={mail.from} onChange={(e) => setMail((m) => ({ ...m, from: e.target.value }))} placeholder="vazio = Atria OS <onboarding@resend.dev>" style={input} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <span className="eyebrow">Para</span>
            <input type="text" inputMode="email" value={mail.to} onChange={(e) => setMail((m) => ({ ...m, to: e.target.value }))} placeholder="vazio = o e-mail da sua conta; vírgula para vários" style={input} />
          </label>
        </div>
        <div style={row}>
          <button type="button" style={bigBtn(true)} disabled={busy === 'mail'} onClick={() => void saveMail()}>{busy === 'mail' ? 'Salvando…' : 'Salvar'}</button>
          <button type="button" style={bigBtn()} disabled={!em?.configured || busy === 'mail-test'} onClick={() => void act('mail-test', async () => setMailMsg(await sendTest('email')))}>
            {busy === 'mail-test' ? 'Enviando…' : 'Mandar teste'}
          </button>
          <SaveMsg msg={mailMsg} />
        </div>
      </Section>

      <Section title="Celular (push)" hint="Usa o app Atria OS instalado. Pedidos de informação sempre chegam, mesmo com o app aberto em outra aba.">
        <div style={{ ...row, justifyContent: 'space-between' }}>
          <StatusPill label={st ? `${st.push.devices} aparelho${st.push.devices === 1 ? '' : 's'}` : 'verificando…'} color={st?.push.devices ? C.ok : C.t3} />
          <button type="button" style={bigBtn()} onClick={() => useYui.getState().set({ appParams: { id: 'notifications' } })}>Gerenciar aparelhos</button>
        </div>
        <div style={row}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#c9cde0', flexWrap: 'wrap' }}>
            Lembrete de pedido parado: a cada
            <input type="number" min={1} max={720} value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Horas entre lembretes" style={{ ...input, width: 84, height: 40 }} />
            h
          </label>
          <button type="button" style={bigBtn()} disabled={busy === 'hours' || hours === (Number(data?.values['notify.remindHours'] ?? 24) || 24)} onClick={() => void saveHours()}>
            Salvar
          </button>
          <SaveMsg msg={hoursMsg} />
        </div>
        <span style={{ fontSize: 12, color: C.t3 }}>O lembrete vai pelos mesmos canais escolhidos no passo. Vale para todos os workflows.</span>
      </Section>
    </>
  )
}
