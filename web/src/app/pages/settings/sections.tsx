import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { SettingsPayload, SetupStatus } from '@shared/protocol'
import { api, ApiError } from '../../../api/client'
import { C } from '../../../lib/colors'
import { disablePush, enablePush, isIOS, isStandalone, promptInstall, pushSupported, testPush } from '../../../pwa/pwa'
import { useYui } from '../../../store/yui'
import { Chip, Field, input, SmallBtn, StatusPill } from '../../../views/kit'
import { EmbeddedTerminal } from './EmbeddedTerminal'

// ---------- dados compartilhados ----------

export function useSettings() {
  const [data, setData] = useState<SettingsPayload | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const load = useCallback(() => api.get<SettingsPayload>('/api/settings').then(setData).catch(() => {}), [])
  useEffect(() => {
    void load()
  }, [load])
  const save = async (patch: Record<string, unknown>) => {
    setMsg(null)
    try {
      setData(await api.put<SettingsPayload>('/api/settings', patch))
      setMsg({ ok: true, text: 'Salvo.' })
      return true
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Não consegui salvar.' })
      return false
    }
  }
  return { data, save, msg, reload: load }
}

export function useSetupStatus() {
  const [st, setSt] = useState<SetupStatus | null>(null)
  const load = useCallback(() => api.get<SetupStatus>('/api/setup/status').then(setSt).catch(() => {}), [])
  useEffect(() => {
    void load()
    const t = setInterval(load, 5000) // logins feitos no terminal aparecem sozinhos
    return () => clearInterval(t)
  }, [load])
  return { st, reload: load }
}

// ---------- peças visuais (Settings.dc.html) ----------

export const panel = { padding: '16px 18px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' } as const

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</span>
        {hint && <span style={{ fontSize: 12.5, color: C.t2 }}>{hint}</span>}
      </div>
      {children}
    </section>
  )
}

export function SaveMsg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null
  return (
    <span role="status" style={{ fontSize: 12.5, color: msg.ok ? C.ok : '#f39aa4' }}>
      {msg.text}
    </span>
  )
}

function ConnRow({ letter, color, name, ok, status, desc, action }: { letter: string; color: string; name: string; ok: boolean; status: string; desc: string; action: ReactNode }) {
  return (
    <div style={{ ...panel, display: 'grid', gridTemplateColumns: '44px minmax(0,1fr) auto', alignItems: 'center', gap: 14 }}>
      <span aria-hidden style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color }}>{letter}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {name}
          <StatusPill label={status} color={ok ? C.ok : C.warn} />
        </span>
        <span style={{ fontSize: 12.5, color: C.t2 }}>{desc}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{action}</div>
    </div>
  )
}

const bigBtn = (primary = false) =>
  ({
    height: 36, padding: '0 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    border: primary ? 'none' : '1px solid rgba(255,255,255,.1)',
    background: primary ? 'linear-gradient(135deg,#67d8f2,#a68cf7)' : 'transparent',
    color: primary ? '#0a0c1d' : '#dfe3f3',
  }) as const

// ---------- Primeiros passos ----------

export function SetupSteps({ onGo }: { onGo: (tab: 'connections' | 'notifications') => void }) {
  const { st } = useSetupStatus()
  if (!st) return null
  const steps = [
    { done: !st.needsPassword, t: 'Acesso criado', d: 'Senha do painel definida.' },
    { done: st.claude !== 'none', t: 'Conta Claude conectada', d: st.claude === 'claude.ai' ? 'Login claude.ai: agentes com conectores, skills e plugins.' : st.claude === 'token' ? 'Usando token — conecte o login claude.ai para ter conectores.' : 'Os agentes precisam da sua conta Claude para trabalhar.', go: 'connections' as const },
    { done: st.openai, t: 'OpenAI conectada', d: 'Voz da Yui (GPT-Live) e o cérebro que decide o que fazer.', go: 'connections' as const },
    { done: st.github, t: 'GitHub conectado', d: 'Opcional: catálogo automático e clone dos seus repositórios.', go: 'connections' as const },
    { done: st.push > 0, t: 'App e notificações', d: 'Opcional: instale no celular/desktop e receba aprovações.', go: 'notifications' as const },
  ]
  const n = steps.filter((s) => s.done).length
  return (
    <Section title={`Primeiros passos · ${n} de ${steps.length}`} hint={st.completed ? 'Tudo pronto para o dia a dia. Os opcionais você ativa quando quiser.' : 'Conecte o essencial para a Yui e os agentes funcionarem.'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((s) => (
          <div key={s.t} style={{ display: 'grid', gridTemplateColumns: '26px minmax(0,1fr) auto', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.02)', border: `1px solid ${s.done ? 'rgba(79,224,176,.18)' : 'rgba(255,255,255,.06)'}` }}>
            <span aria-hidden style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: s.done ? 'rgba(79,224,176,.15)' : 'rgba(255,255,255,.05)', color: s.done ? C.ok : C.t3 }}>{s.done ? '✓' : '·'}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: s.done ? C.text : '#dfe3f3' }}>{s.t}</span>
              <span style={{ fontSize: 12, color: C.t2 }}>{s.d}</span>
            </span>
            {!s.done && s.go && <SmallBtn onClick={() => onGo(s.go!)}>Configurar</SmallBtn>}
          </div>
        ))}
      </div>
    </Section>
  )
}

// ---------- Conta ----------

export function AccountSection() {
  const { data, save, msg } = useSettings()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    if (data) {
      setName(String(data.values['user.name'] ?? ''))
      setEmail(String(data.values['user.email'] ?? ''))
    }
  }, [data])
  const changePw = async () => {
    setPwMsg(null)
    try {
      await api.post('/api/auth/password', { current: cur, next })
      setCur('')
      setNext('')
      setPwMsg({ ok: true, text: 'Senha alterada. Outras sessões foram encerradas.' })
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Não consegui trocar a senha.' })
    }
  }
  return (
    <>
      <Section title="Você" hint="Como a Yui te chama e para onde vão os avisos.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
          <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} style={input} autoComplete="name" /></Field>
          <Field label="E-mail" hint="Usado como remetente das notificações push."><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={input} autoComplete="email" /></Field>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="button" style={bigBtn(true)} onClick={() => save({ 'user.name': name, 'user.email': email })}>Salvar</button>
          <SaveMsg msg={msg} />
        </div>
      </Section>
      <Section title="Senha do painel" hint="Trocar a senha encerra as outras sessões abertas.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
          <Field label="Senha atual"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} style={input} autoComplete="current-password" /></Field>
          <Field label="Nova senha" hint="Mínimo de 8 caracteres."><input type="password" value={next} onChange={(e) => setNext(e.target.value)} style={input} autoComplete="new-password" /></Field>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="button" style={bigBtn()} disabled={!cur || next.length < 8} onClick={changePw}>Trocar senha</button>
          <SaveMsg msg={pwMsg} />
        </div>
      </Section>
    </>
  )
}

// ---------- Conexões ----------

// Login interativo: o token do .env (se houver) é removido só para este comando, senão o CLI não pede login.
const CLAUDE_LOGIN = 'env -u CLAUDE_CODE_OAUTH_TOKEN claude'
const GH_LOGIN = 'gh auth login --hostname github.com --git-protocol https --web'

export function ConnectionsSection() {
  const { st, reload } = useSetupStatus()
  const { data, save, msg } = useSettings()
  const [term, setTerm] = useState<null | 'claude' | 'github'>(null)
  const [key, setKey] = useState('')
  const [test, setTest] = useState<string | null>(null)
  const [mcp, setMcp] = useState<{ name: string; status: string }[]>([])
  useEffect(() => {
    api.get<{ mcp?: { name: string; status: string }[] }>('/api/capabilities').then((c) => setMcp(c.mcp ?? [])).catch(() => {})
  }, [st?.claude])
  const connectors = mcp.filter((m) => m.name.startsWith('claude.ai '))
  const needAuth = connectors.filter((m) => m.status === 'needs-auth')
  const testKey = async () => {
    setTest('Testando…')
    const r = await api.post<{ ok: boolean; models?: string[]; error?: string }>('/api/settings/test-openai', { key: key || undefined }).catch(() => ({ ok: false, error: 'falhou' }) as { ok: boolean; models?: string[]; error?: string })
    setTest(r.ok ? `Chave válida · ${r.models?.join(' · ')}` : `Falhou: ${r.error}`)
  }
  if (!st) return null
  return (
    <>
      <ConnRow
        letter="C"
        color="#f5c97a"
        name="Claude"
        ok={st.claude === 'claude.ai'}
        status={st.claude === 'claude.ai' ? 'conectado' : st.claude === 'token' ? 'só token' : 'desconectado'}
        desc={st.claude === 'claude.ai' ? `Login claude.ai · ${connectors.filter((m) => m.status === 'connected').length} conectores MCP` : 'Entre com a sua conta Claude (Pro/Max) — os agentes usam ela para trabalhar.'}
        action={<button type="button" style={bigBtn(st.claude !== 'claude.ai')} onClick={() => setTerm(term === 'claude' ? null : 'claude')}>{st.claude === 'claude.ai' ? 'Reconectar' : 'Conectar conta Claude'}</button>}
      />
      {term === 'claude' && (
        <Section title="Conectar conta Claude" hint="No terminal abaixo digite /login, escolha a conta claude.ai, abra o link que aparecer, autorize e cole o código de volta. Depois digite /exit. Esta página detecta sozinha quando terminar.">
          <EmbeddedTerminal command={CLAUDE_LOGIN} onClose={() => { setTerm(null); void reload(); api.post('/api/capabilities/refresh').catch(() => {}) }} />
        </Section>
      )}
      <ConnRow
        letter="G"
        color={C.text}
        name="GitHub"
        ok={st.github}
        status={st.github ? 'conectado' : 'opcional'}
        desc={st.github ? 'Repositórios no catálogo; os ativos são clonados sozinhos.' : 'Conecte para a Yui enxergar e clonar seus repositórios.'}
        action={<button type="button" style={bigBtn(!st.github)} onClick={() => setTerm(term === 'github' ? null : 'github')}>{st.github ? 'Trocar conta' : 'Conectar GitHub'}</button>}
      />
      {term === 'github' && (
        <Section title="Conectar GitHub" hint="Siga as perguntas no terminal: ele mostra um código de 8 letras e um link — abra o link, cole o código e autorize. Em até 5 minutos o catálogo aparece em Projetos.">
          <EmbeddedTerminal command={GH_LOGIN} onClose={() => { setTerm(null); void reload() }} />
        </Section>
      )}
      <ConnRow
        letter="O"
        color={C.ok}
        name="OpenAI"
        ok={st.openai}
        status={st.openai ? 'chave válida' : 'falta a chave'}
        desc={`Voz ${data?.values['models.live'] ?? ''} · cérebro ${data?.values['models.brain'] ?? ''} · planner ${data?.values['models.planner'] ?? ''}`}
        action={<button type="button" style={bigBtn()} onClick={testKey}>Testar chave</button>}
      />
      <Section title="Chave da OpenAI" hint="Chave de API da plataforma OpenAI (platform.openai.com). O plano ChatGPT não serve. Fica guardada só no servidor.">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={data?.secrets['openai.key'] ? '•••••••• (configurada — cole outra para trocar)' : 'sk-…'} aria-label="Chave da OpenAI" style={{ ...input, maxWidth: 460 }} autoComplete="off" />
          <button type="button" style={bigBtn(true)} disabled={!key} onClick={async () => { if (await save({ 'openai.key': key })) { setKey(''); void reload() } }}>Salvar chave</button>
          <SaveMsg msg={msg} />
        </div>
        {test && <span style={{ fontSize: 12.5, color: test.startsWith('Chave válida') ? C.ok : test === 'Testando…' ? C.t2 : '#f39aa4' }}>{test}</span>}
      </Section>
      {needAuth.length > 0 && (
        <ConnRow
          letter={needAuth[0].name.replace('claude.ai ', '').slice(0, 1)}
          color="#a9e9f8"
          name={needAuth.map((m) => m.name.replace('claude.ai ', '')).join(' / ')}
          ok={false}
          status="pede autorização"
          desc="Conectores da sua conta Claude que ainda precisam ser autorizados (ex.: publicar posts pelos workflows)."
          action={<a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer" style={{ ...bigBtn(true), display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>Autorizar no claude.ai</a>}
        />
      )}
    </>
  )
}

// ---------- Yui & voz ----------

const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'quartz', 'willow']

export function VoiceSection() {
  const { data, save, msg } = useSettings()
  const [v, setV] = useState<Record<string, string | number | boolean | null>>({})
  useEffect(() => {
    if (data) setV(data.values)
  }, [data])
  const set = (k: string, val: string | number | boolean) => setV((o) => ({ ...o, [k]: val }))
  return (
    <Section title="Yui & voz" hint="Mudanças valem na próxima conversa por voz.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        <Field label="Voz">
          <select value={String(v['voice.name'] ?? 'marin')} onChange={(e) => set('voice.name', e.target.value)} style={input}>
            {VOICES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Encerrar voz após (min parada)" hint="A voz é cobrada por segundo.">
          <input type="number" min={1} max={60} value={Number(v['voice.idleMin'] ?? 5)} onChange={(e) => set('voice.idleMin', Number(e.target.value))} style={input} />
        </Field>
        <Field label="Tecla de falar (segurar)">
          <select value={String(v['voice.pttKey'] ?? 'Space')} onChange={(e) => set('voice.pttKey', e.target.value)} style={input}>
            <option value="Space">Espaço</option>
            <option value="Backquote">Crase (`)</option>
            <option value="F8">F8</option>
            <option value="AltRight">Alt direito</option>
          </select>
        </Field>
        <Field label="Densidade de partículas do orb">
          <input type="range" min={0.3} max={2} step={0.1} value={Number(v['ui.particleDensity'] ?? 1)} onChange={(e) => set('ui.particleDensity', Number(e.target.value))} />
        </Field>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5 }}>
        <input type="checkbox" checked={!!v['ui.reducedMotion']} onChange={(e) => set('ui.reducedMotion', e.target.checked)} />
        Reduzir movimento (animações mais calmas)
      </label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" style={bigBtn(true)} onClick={() => save({ 'voice.name': v['voice.name'], 'voice.idleMin': v['voice.idleMin'], 'voice.pttKey': v['voice.pttKey'], 'ui.particleDensity': v['ui.particleDensity'], 'ui.reducedMotion': !!v['ui.reducedMotion'] })}>Salvar</button>
        <SaveMsg msg={msg} />
      </div>
    </Section>
  )
}

// ---------- Modelos ----------

export function ModelsSection() {
  const { data, save, msg } = useSettings()
  const [v, setV] = useState<Record<string, string | number | boolean | null>>({})
  useEffect(() => {
    if (data) setV(data.values)
  }, [data])
  const set = (k: string, val: string | number) => setV((o) => ({ ...o, [k]: val }))
  const keys = ['models.live', 'models.brain', 'models.planner', 'claude.model', 'runs.concurrency']
  return (
    <Section title="Modelos" hint="Quem conversa, quem decide, quem planeja e com que modelo os agentes Claude trabalham.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        <Field label="Voz (OpenAI)" hint="Ex.: gpt-live-1"><input value={String(v['models.live'] ?? '')} onChange={(e) => set('models.live', e.target.value)} style={input} /></Field>
        <Field label="Cérebro (OpenAI)" hint="Decide telas e delegações. Ex.: gpt-6-luna"><input value={String(v['models.brain'] ?? '')} onChange={(e) => set('models.brain', e.target.value)} style={input} /></Field>
        <Field label="Planner de missões (OpenAI)" hint="Monta planos multi-agente. Ex.: gpt-6-sol"><input value={String(v['models.planner'] ?? '')} onChange={(e) => set('models.planner', e.target.value)} style={input} /></Field>
        <Field label="Agentes Claude (padrão)" hint="Vazio = padrão da sua conta. Cada agente pode ter o seu."><input value={String(v['claude.model'] ?? '')} onChange={(e) => set('claude.model', e.target.value)} placeholder="padrão da conta" style={input} /></Field>
        <Field label="Agentes ao mesmo tempo" hint="1 a 8. Mais = mais rápido, mais uso do plano."><input type="number" min={1} max={8} value={Number(v['runs.concurrency'] ?? 2)} onChange={(e) => set('runs.concurrency', Number(e.target.value))} style={input} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" style={bigBtn(true)} onClick={() => save(Object.fromEntries(keys.map((k) => [k, v[k] ?? ''])))}>Salvar</button>
        <SaveMsg msg={msg} />
      </div>
    </Section>
  )
}

// ---------- Agentes & aprovações ----------

export function AgentsApprovalsSection() {
  const { data, save, msg } = useSettings()
  const on = data ? data.values['approvals.mcpSensitive'] === true : false
  return (
    <>
      <Section title="Aprovações" hint="Workflows, rotinas, missões e projetos rodam no automático. Só pedem sua permissão onde você pediu.">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: '#c9cde0' }}>
          <li>Bloqueado sempre (negado, sem perguntar): apagar raiz/workspace/dados inteiros, formatar disco, DROP DATABASE, prune do Docker, mexer nos stacks de produção protegidos e force push na main.</li>
          <li>Workflows: a Yui decide os passos de Aprovação com base nas suas decisões anteriores; marque “Sempre me perguntar” no passo para decidir você.</li>
          <li>Missões: só pedem OK nas etapas em que você pediu aprovação.</li>
          <li>Por projeto: padrões em <span className="mono">yui.json → approvalPatterns</span> pedem aprovação.</li>
        </ul>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5 }}>
          <input type="checkbox" checked={on} onChange={(e) => save({ 'approvals.mcpSensitive': e.target.checked })} />
          Pedir aprovação antes de enviar/publicar/pagar por conectores (desligado = automático)
        </label>
        <SaveMsg msg={msg} />
      </Section>
      <Section title="Agentes" hint="Prompt, modelo, MCP, skills e plugins de cada agente ficam na página Agentes.">
        <div>
          <SmallBtn onClick={() => useYui.getState().set({ shellMode: 'app', appPage: 'agents', appParams: {} })}>Abrir Agentes</SmallBtn>
        </div>
      </Section>
    </>
  )
}

// ---------- Notificações ----------

export function NotificationsSection() {
  const [devices, setDevices] = useState<{ device: string; created_at: string }[]>([])
  const [note, setNote] = useState('')
  const pushOn = useYui((s) => s.pushEnabled)
  const load = useCallback(() => api.get<{ device: string; created_at: string }[]>('/api/push/devices').then(setDevices).catch(() => {}), [])
  useEffect(() => {
    void load()
  }, [load])
  const run = (p: Promise<string>) => p.then((m) => { setNote(m); void load() }).catch(() => setNote('Não consegui agora.'))
  const install = async () => {
    const r = await promptInstall()
    setNote(r === 'ios' ? 'No iPhone: Compartilhar → Adicionar à Tela de Início.' : r === 'accepted' ? 'App instalado.' : r === 'dismissed' ? 'Instalação cancelada.' : isStandalone() ? 'Você já está no app instalado.' : 'Use o ícone de instalar na barra de endereço do navegador.')
  }
  return (
    <>
      <Section title="Este dispositivo" hint={pushSupported() ? 'Aprovações, falhas e entregas chegam mesmo com o app fechado.' : isIOS() ? 'No iPhone, instale o app na tela inicial para receber notificações.' : 'Este navegador não suporta notificações push.'}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {!isStandalone() && <button type="button" style={bigBtn()} onClick={install}>Instalar app</button>}
          <button type="button" style={bigBtn(!pushOn)} onClick={() => run(pushOn ? disablePush() : enablePush())}>{pushOn ? 'Desativar notificações' : 'Ativar notificações'}</button>
          <button type="button" style={bigBtn()} onClick={() => run(testPush())}>Enviar teste</button>
          {note && <span style={{ fontSize: 12.5, color: C.t2 }}>{note}</span>}
        </div>
      </Section>
      <Section title={`Dispositivos inscritos · ${devices.length}`}>
        {devices.length === 0 ? (
          <span style={{ fontSize: 13, color: C.t3 }}>Nenhum dispositivo recebe notificações ainda.</span>
        ) : (
          devices.map((d, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <span>{d.device || 'Dispositivo'}</span>
              <span style={{ color: C.t3 }}>{new Date(d.created_at).toLocaleDateString('pt-BR')}</span>
            </div>
          ))
        )}
      </Section>
    </>
  )
}

// ---------- Sistema ----------

interface Health {
  openai: boolean; claudeAuth: string; github: boolean; repos: number; dockerProxy: boolean; browser: boolean; live: boolean
  capabilitiesAt: string | null; mcpConnected: number | null; workspaceDiskPct: number | null; queue: { state: string; n: number }[]
}

export function SystemSection() {
  const [h, setH] = useState<Health | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => api.get<Health>('/api/health/full').then(setH).catch(() => {}), [])
  useEffect(() => {
    void load()
  }, [load])
  const row = (label: string, ok: boolean, text: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.05)', fontSize: 13 }}>
      <span style={{ color: '#c9cde0' }}>{label}</span>
      <StatusPill label={text} color={ok ? C.ok : C.warn} />
    </div>
  )
  return (
    <>
      <Section title="Saúde" hint="Cada peça que o Yui Console usa.">
        {!h ? (
          <span style={{ fontSize: 13, color: C.t3 }}>Verificando…</span>
        ) : (
          <div>
            {row('Claude', h.claudeAuth !== 'none', h.claudeAuth === 'claude.ai' ? 'login claude.ai' : h.claudeAuth === 'token' ? 'token' : 'desconectado')}
            {row('OpenAI', h.openai, h.openai ? 'configurada' : 'falta a chave')}
            {row('GitHub', h.github, h.github ? `${h.repos} repositórios` : 'não conectado')}
            {row('Navegador dos agentes', h.browser, h.browser ? 'no ar' : 'fora do ar')}
            {row('Docker (somente leitura)', h.dockerProxy, h.dockerProxy ? 'no ar' : 'fora do ar')}
            {row('Conectores MCP', (h.mcpConnected ?? 0) > 0, h.mcpConnected === null ? 'não lido ainda' : `${h.mcpConnected} conectados`)}
            {row('Disco do workspace', (h.workspaceDiskPct ?? 0) < 85, h.workspaceDiskPct === null ? '—' : `${h.workspaceDiskPct}% usado`)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <SmallBtn onClick={() => void load()}>Verificar de novo</SmallBtn>
          <SmallBtn
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await api.post('/api/capabilities/refresh').catch(() => {})
              setBusy(false)
              void load()
            }}
          >
            {busy ? 'Lendo capacidades…' : 'Atualizar capacidades do Claude'}
          </SmallBtn>
          {h?.capabilitiesAt && <span style={{ fontSize: 12, color: C.t3 }}>lidas em {new Date(h.capabilitiesAt).toLocaleString('pt-BR')}</span>}
        </div>
      </Section>
      <Section title="Atualizar e backup" hint="Na VPS, na pasta do Yui Console:">
        <div className="mono" style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(0,0,0,.4)', fontSize: 12.5, lineHeight: 1.8, color: '#c9cde0' }}>
          <div>./install.sh --update        <span style={{ color: C.t3 }}># puxa a versão nova, espera execuções e reinicia</span></div>
          <div>./install.sh --backup        <span style={{ color: C.t3 }}># copia banco, workspace e logins para ./backups</span></div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip>sessões: 30 dias</Chip>
          <Chip>dados: volume yui-data</Chip>
          <Chip>projetos: volume yui-workspace</Chip>
        </div>
      </Section>
    </>
  )
}
