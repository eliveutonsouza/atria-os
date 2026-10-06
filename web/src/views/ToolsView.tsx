import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AgentConfig, ClaudeInitInfo, ToolboxItem } from '@shared/protocol'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { startRun, submitText } from '../lib/actions'
import { C } from '../lib/colors'
import { ago } from '../lib/format'
import { useYui } from '../store/yui'
import { BottomSheet } from './Sheet'
import { card, ConfirmDeleteModal, Empty, ErrorNote, Skeleton, useHeader } from './ui'
import { Chip, Field, input, mcpStatusMeta, SearchBox, SmallBtn, STATUS_META, StatusPill, Tabs } from './kit'

// Painel Ferramentas: o que a Yui e os agentes conseguem usar — conectores do dia a dia, MCP, skills,
// plugins e apps/stacks da VPS — com status vivo e quem usa cada um.

type Tab = 'connectors' | 'mcp' | 'skills' | 'plugins' | 'apps'
const TABS: Tab[] = ['connectors', 'mcp', 'skills', 'plugins', 'apps']
const APP_TYPES = new Set(['stack', 'url', 'repo'])
const mcpPrefix = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
const CONNECTORS_URL = 'https://claude.ai/settings/connectors'

function agentsUsingMcp(server: string, agents: AgentConfig[]): string[] {
  return agents.filter((a) => !a.archived && (!a.mcp.length || a.mcp.some((m) => mcpPrefix(m) === mcpPrefix(server)))).map((a) => a.name)
}

function testTool(t: ToolboxItem) {
  void startRun(
    t.agent ?? 'assistente',
    null,
    `Teste rápido e SOMENTE LEITURA da ferramenta "${t.name}" (${t.access.type}: ${t.access.ref}). Verifique se ela responde/está acessível e diga o resultado em 1 frase. Não crie, envie, altere nem apague nada.`,
  )
}

export function ToolsView() {
  const paramTab = useYui((s) => s.viewParams.tab) as Tab | undefined
  const [tab, setTab] = useState<Tab>(paramTab && TABS.includes(paramTab) ? paramTab : 'connectors')
  const [q, setQ] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const phone = useYui((s) => s.device === 'phone')
  const toolbox = useApi<ToolboxItem[]>('/api/toolbox', [], 60000)
  const caps = useApi<ClaudeInitInfo | { at?: string }>('/api/capabilities')
  const agents = useApi<AgentConfig[]>('/api/agents/all')
  const init = caps.data && 'tools' in caps.data ? (caps.data as ClaudeInitInfo) : null
  const [editing, setEditing] = useState<ToolboxItem | 'new' | null>(null)

  const refresh = async () => {
    setRefreshing(true)
    try {
      await api.post('/api/capabilities/refresh')
      await api.get('/api/toolbox/status')
    } catch {
      /* mantém dados atuais */
    }
    caps.reload()
    toolbox.reload()
    setRefreshing(false)
  }

  useHeader(
    'Ferramentas · capacidades',
    'Conectores, MCP, skills e plugins',
    [
      { label: '+ Nova ferramenta', fn: () => setEditing('new'), primary: true },
      { label: refreshing ? 'Atualizando…' : 'Atualizar capacidades', fn: () => void refresh() },
      { label: 'Mapa do Claude Code', fn: () => useYui.getState().show('claude') },
    ],
    [refreshing],
  )

  const n = q.trim().toLowerCase()
  const match = (s: string) => !n || s.toLowerCase().includes(n)
  const items = toolbox.data ?? []
  const connectors = items.filter((t) => !APP_TYPES.has(t.access.type) && match(`${t.name} ${t.category} ${t.purpose}`))
  const apps = items.filter((t) => APP_TYPES.has(t.access.type) && match(`${t.name} ${t.category} ${t.purpose}`))
  const mcp = (init?.mcp ?? []).filter((m) => match(m.name))
  const skills = (init?.skills ?? []).filter(match)
  const plugins = (init?.plugins ?? []).filter((p) => match(p.name))
  const activeAgents = (agents.data ?? []).filter((a) => !a.archived)

  const counts: Record<Tab, number> = { connectors: connectors.length, mcp: mcp.length, skills: skills.length, plugins: plugins.length, apps: apps.length }
  const labels: Record<Tab, string> = { connectors: 'Conectores', mcp: 'MCP', skills: 'Skills', plugins: 'Plugins', apps: 'Apps & stacks' }

  if ((toolbox.loading && !toolbox.data) || (caps.loading && !caps.data)) return <Skeleton kpis={4} rows={6} />
  if (toolbox.error && caps.error) return <ErrorNote />

  const kpis = [
    { l: 'Ferramentas', v: items.length, c: C.text },
    { l: 'Com problema', v: items.filter((t) => t.status === 'down' || t.status === 'needs-auth').length, c: C.warn },
    { l: 'MCP conectados', v: (init?.mcp ?? []).filter((m) => m.status === 'connected' || m.status === 'pending').length, c: C.cyan },
    { l: 'Skills', v: init?.skills.length ?? 0, c: C.lav },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'grid', gridTemplateColumns: phone ? 'repeat(4,minmax(0,1fr))' : 'repeat(auto-fit,minmax(150px,1fr))', gap: phone ? 8 : 14 }}>
        {kpis.map((k) => (
          <div key={k.l} style={phone ? { ...card, padding: '10px 8px', minWidth: 0 } : card}>
            <div style={{ fontSize: phone ? 11 : 12, color: C.t2, marginBottom: phone ? 6 : 8, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{k.l}</div>
            <div style={{ fontSize: phone ? 24 : 40, fontWeight: 300, lineHeight: 1, letterSpacing: '-.02em', color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div className={phone ? 'h-scroll' : undefined} style={phone ? { width: '100%', minWidth: 0 } : undefined}>
          <Tabs value={tab} onChange={setTab} items={TABS.map((id) => ({ id, label: labels[id], count: counts[id] }))} />
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="Filtrar…" />
      </div>
      {init?.at && (
        <div style={{ fontSize: 12, color: C.t3, marginTop: -10 }}>
          Capacidades lidas do Claude Code {ago(init.at)} · modelo {init.model}
        </div>
      )}

      {(tab === 'connectors' || tab === 'apps') && <ToolList items={tab === 'connectors' ? connectors : apps} onEdit={setEditing} />}
      {editing && (
        <ToolForm
          initial={editing === 'new' ? null : editing}
          defaultType={tab === 'apps' ? 'url' : 'mcp'}
          categories={[...new Set(items.map((t) => t.category))].sort()}
          agents={activeAgents}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            toolbox.reload()
          }}
        />
      )}

      {tab === 'mcp' &&
        (mcp.length ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {mcp.map((m) => {
              const meta = mcpStatusMeta(m.status)
              const prefix = `mcp__${m.name.replace(/[^a-zA-Z0-9_-]/g, '_')}__`
              const tools = (init?.tools ?? []).filter((t) => t.startsWith(prefix)).length
              const users = agentsUsingMcp(m.name, activeAgents)
              const short = m.name.replace(/^claude\.ai /, '')
              const source = m.name.startsWith('claude.ai') ? 'claude.ai' : m.source ?? 'local'
              const usedBy = activeAgents.length && users.length === activeAgents.length ? 'todos os agentes' : users.join(', ') || 'nenhum agente'
              const action =
                m.status === 'needs-auth' ? (
                  <SmallBtn onClick={() => window.open(CONNECTORS_URL, '_blank', 'noopener')}>Autorizar</SmallBtn>
                ) : (
                  <SmallBtn onClick={() => submitText(`Testa o conector ${short} com uma consulta rápida somente leitura.`)}>Pedir à Yui</SmallBtn>
                )
              if (phone)
                return (
                  <PhoneRow key={m.name} name={short} pill={<StatusPill {...meta} />} desc={`${source}${tools ? ` · ${tools} ferramentas` : ''}`} agents={usedBy} action={action} />
                )
              return (
                <div key={m.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px,1.2fr) 150px minmax(0,2fr) auto', gap: 14, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.05)', fontSize: 14 }}>
                  <span style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {short}
                    <span style={{ fontSize: 11, color: C.t3, fontWeight: 400, marginLeft: 8 }}>{source}</span>
                  </span>
                  <StatusPill {...meta} />
                  <span style={{ fontSize: 12, color: C.t3, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tools ? `${tools} ferramentas · ` : ''}
                    {usedBy}
                  </span>
                  {action}
                </div>
              )
            })}
          </div>
        ) : (
          <Empty text="Ainda não li os servidores MCP." hint="Use “Atualizar capacidades”." />
        ))}

      {tab === 'skills' && (skills.length ? <SkillGroups skills={skills} /> : <Empty text="Nenhuma skill encontrada." hint="Use “Atualizar capacidades”." />)}

      {tab === 'plugins' &&
        (plugins.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: phone ? 'minmax(0,1fr)' : 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
            {plugins.map((p) => {
              const sk = (init?.skills ?? []).filter((s) => s.startsWith(`${p.name}:`))
              const users = activeAgents.filter((a) => a.plugins.includes(p.name)).map((a) => a.name)
              return (
                <div key={p.name} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{p.name}</span>
                    <StatusPill label="ativo" color={C.ok} />
                  </div>
                  <div style={{ fontSize: 12, color: C.t3 }}>
                    {p.version ? `v${p.version} · ` : ''}
                    {sk.length} skills{users.length ? ` · preferido por ${users.join(', ')}` : ''}
                  </div>
                  {sk.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {sk.slice(0, 8).map((s) => (
                        <Chip key={s}>{s.split(':')[1]}</Chip>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <Empty text="Nenhum plugin ativo." hint="Instale pelo terminal com /plugin." />
        ))}
    </div>
  )
}

// Linha de ferramenta no celular: cartão em 3 linhas (nome + estado · descrição · agentes + ação).
function PhoneRow({ name, pill, desc, agents, action, children }: { name: string; pill: ReactNode; desc: ReactNode; agents: ReactNode; action: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.05)', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        {pill}
      </div>
      <div style={{ fontSize: 13, color: C.t2, overflowWrap: 'anywhere' }}>{desc}</div>
      {children}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.cyan, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>→ {agents}</span>
        {action}
      </div>
    </div>
  )
}

function ToolList({ items, onEdit }: { items: ToolboxItem[]; onEdit: (t: ToolboxItem) => void }) {
  const phone = useYui((s) => s.device === 'phone')
  const cats = useMemo(() => [...new Set(items.map((t) => t.category))], [items])
  if (!items.length) return <Empty text="Nada por aqui com esse filtro." />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {cats.map((cat) => (
        <div key={cat} style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="eyebrow" style={{ paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,.08)' }}>{cat}</div>
          {items
            .filter((t) => t.category === cat)
            .map((t) => {
              const meta = STATUS_META[t.status]
              const action = (
                <>
                  {t.status === 'needs-auth' && t.access.type === 'mcp' ? (
                    <SmallBtn onClick={() => window.open(CONNECTORS_URL, '_blank', 'noopener')}>Autorizar</SmallBtn>
                  ) : (
                    <SmallBtn onClick={() => testTool(t)} title="Run curta somente leitura">
                      Testar
                    </SmallBtn>
                  )}
                  <SmallBtn onClick={() => onEdit(t)}>Editar</SmallBtn>
                </>
              )
              if (phone)
                return (
                  <PhoneRow key={t.id} name={t.name} pill={<StatusPill {...meta} />} desc={t.purpose} agents={`${t.agent ?? 'qualquer agente'} · ${t.access.type}`} action={action}>
                    {t.note && <span style={{ fontSize: 12, color: t.status === 'ok' ? C.t3 : meta.color, overflowWrap: 'anywhere' }}>{t.note}</span>}
                    {t.examples.length > 0 && (
                      <div className="h-scroll" style={{ gap: 6 }}>
                        {t.examples.slice(0, 3).map((ex) => (
                          <Chip key={ex} onClick={() => submitText(ex)} title="Pedir à Yui">
                            “{ex}”
                          </Chip>
                        ))}
                      </div>
                    )}
                  </PhoneRow>
                )
              return (
                <div key={t.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 140px auto', gap: 14, alignItems: 'center', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{t.name}</span>
                      {t.agent && <span style={{ fontSize: 12, color: C.cyan }}>→ {t.agent}</span>}
                      <span className="mono" style={{ fontSize: 11, color: C.t4 }}>{t.access.type}</span>
                    </div>
                    <span style={{ fontSize: 13, color: C.t2 }}>{t.purpose}</span>
                    {t.note && <span style={{ fontSize: 12, color: t.status === 'ok' ? C.t3 : meta.color }}>{t.note}</span>}
                    {t.examples.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                        {t.examples.slice(0, 3).map((ex) => (
                          <Chip key={ex} onClick={() => submitText(ex)} title="Pedir à Yui">
                            “{ex}”
                          </Chip>
                        ))}
                      </div>
                    )}
                  </div>
                  <StatusPill {...meta} />
                  <div style={{ display: 'flex', gap: 6 }}>{action}</div>
                </div>
              )
            })}
        </div>
      ))}
    </div>
  )
}

function SkillGroups({ skills }: { skills: string[] }) {
  const groups = new Map<string, string[]>()
  for (const s of skills) {
    const i = s.indexOf(':')
    const g = i > 0 ? s.slice(0, i) : 'Claude Code'
    groups.set(g, [...(groups.get(g) ?? []), i > 0 ? s.slice(i + 1) : s])
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {[...groups.entries()].map(([g, list]) => (
        <div key={g} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="eyebrow">
            {g} · {list.length}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {list.map((s) => (
              <Chip key={s} onClick={() => useYui.getState().show('terminal', { kind: 'claude', cmd: `/${g === 'Claude Code' ? s : `${g}:${s}`} ` })} title="Abrir no terminal">
                /{s}
              </Chip>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- criar/editar/excluir item da caixa de ferramentas ----------

type ToolDef = Omit<ToolboxItem, 'status'>
const ACCESS_TYPES: { id: ToolboxItem['access']['type']; label: string; hint: string }[] = [
  { id: 'mcp', label: 'Conector MCP', hint: 'nome do servidor, ex.: claude.ai Gmail' },
  { id: 'cli', label: 'Linha de comando', hint: 'comando, ex.: gh' },
  { id: 'url', label: 'Site / URL', hint: 'https://…' },
  { id: 'stack', label: 'Stack Docker', hint: 'prefixo dos containers, ex.: twentycrm' },
  { id: 'repo', label: 'Repositório', hint: 'dono/nome' },
  { id: 'skill', label: 'Skill', hint: 'nome da skill' },
  { id: 'plugin', label: 'Plugin', hint: 'nome do plugin' },
  { id: 'browser', label: 'Navegador', hint: 'nome do conector do navegador' },
]
const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'ferramenta'

// A lista crua (sem status nem nota calculada) vem de /api/toolbox/defs; o PUT regrava o arquivo inteiro.
async function saveDefs(change: (list: ToolDef[]) => ToolDef[]) {
  const list = await api.get<ToolDef[]>('/api/toolbox/defs')
  await api.put('/api/toolbox', change(list))
}

function FormPanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const phone = useYui((s) => s.device === 'phone')
  useEffect(() => {
    if (phone) return // a folha inferior cuida do ESC
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose, phone])
  const head = <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
  if (phone)
    return (
      <BottomSheet label={title} onClose={onClose}>
        {head}
        {children}
      </BottomSheet>
    )
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,10,.66)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: '100%', maxHeight: 'calc(var(--vvh) - 32px)', overflowY: 'auto', boxSizing: 'border-box', padding: 22, borderRadius: 18, background: '#10132a', border: '1px solid rgba(160,170,255,.16)', boxShadow: '0 30px 80px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 14, color: C.text }}>
        {head}
        {children}
      </div>
    </div>,
    document.body,
  )
}

function ToolForm({ initial, defaultType, categories, agents, onClose, onSaved }: {
  initial: ToolboxItem | null
  defaultType: ToolboxItem['access']['type']
  categories: string[]
  agents: AgentConfig[]
  onClose: () => void
  onSaved: () => void
}) {
  const phone = useYui((s) => s.device === 'phone')
  const say = useYui.getState().say
  const [name, setName] = useState(initial?.name ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [purpose, setPurpose] = useState(initial?.purpose ?? '')
  const [type, setType] = useState<ToolboxItem['access']['type']>(initial?.access.type ?? defaultType)
  const [ref, setRef] = useState(initial?.access.ref ?? '')
  const [agent, setAgent] = useState(initial?.agent ?? '')
  const [examples, setExamples] = useState((initial?.examples ?? []).join('\n'))
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)

  // a nota da tela mistura a nota salva com o status calculado: lê a salva da lista crua
  useEffect(() => {
    if (!initial) return
    api.get<ToolDef[]>('/api/toolbox/defs').then((l) => setNote(l.find((d) => d.id === initial.id)?.note ?? '')).catch(() => {})
  }, [initial])

  const save = async () => {
    setErr(null)
    if (!name.trim()) return setErr('Dê um nome à ferramenta.')
    if (!ref.trim()) return setErr('Informe a referência de acesso.')
    if (type === 'url' && !/^https?:\/\//i.test(ref.trim())) return setErr('A URL precisa começar com http(s)://')
    setBusy(true)
    try {
      await saveDefs((list) => {
        const def: ToolDef = {
          id: initial?.id ?? '',
          name: name.trim(),
          category: category.trim() || 'Outros',
          purpose: purpose.trim(),
          access: { type, ref: ref.trim() },
          agent: agent || null,
          examples: examples.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 10),
          ...(note.trim() ? { note: note.trim() } : {}),
        }
        if (initial) return list.map((d) => (d.id === initial.id ? def : d))
        const base = slugify(name)
        let id = base
        for (let i = 2; list.some((d) => d.id === id); i++) id = `${base}-${i}`
        return [...list, { ...def, id }]
      })
      say(initial ? 'Ferramenta atualizada.' : `Ferramenta ${name.trim()} adicionada.`)
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!initial) return
    setBusy(true)
    try {
      await saveDefs((list) => list.filter((d) => d.id !== initial.id))
      say(`Removi ${initial.name} da caixa de ferramentas.`)
      onSaved()
    } catch (e) {
      say(`Não consegui excluir: ${(e as Error).message}.`)
      setBusy(false)
      setConfirm(false)
    }
  }

  const two = phone ? 'minmax(0,1fr)' : 'repeat(2,minmax(0,1fr))'
  const typeMeta = ACCESS_TYPES.find((a) => a.id === type)
  return (
    <FormPanel title={initial ? `Editar ${initial.name}` : 'Nova ferramenta'} onClose={busy ? () => {} : onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: two, gap: 12 }}>
        <Field label="Nome">
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Gmail" />
        </Field>
        <Field label="Categoria">
          <input style={input} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Comunicação" list="toolbox-categories" />
          <datalist id="toolbox-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Para que serve">
            <input style={input} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Ler e responder e-mails do trabalho" />
          </Field>
        </div>
        <Field label="Tipo de acesso">
          <select style={{ ...input, height: phone ? 44 : 38 }} value={type} onChange={(e) => setType(e.target.value as ToolboxItem['access']['type'])}>
            {ACCESS_TYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </Field>
        <Field label="Referência" hint={typeMeta?.hint}>
          <input style={input} value={ref} onChange={(e) => setRef(e.target.value)} autoCapitalize="off" spellCheck={false} />
        </Field>
        <Field label="Agente padrão">
          <select style={{ ...input, height: phone ? 44 : 38 }} value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">Qualquer agente</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Nota (opcional)">
          <input style={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: autorize em claude.ai" />
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Exemplos de pedido" hint="Um por linha; viram atalhos para pedir à Yui.">
            <textarea style={{ ...input, minHeight: 72, resize: 'vertical' }} value={examples} onChange={(e) => setExamples(e.target.value)} placeholder="Resume meus e-mails não lidos" />
          </Field>
        </div>
      </div>
      {err && <div style={{ fontSize: 13, color: C.crit, overflowWrap: 'anywhere' }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: phone ? 'repeat(2,minmax(0,1fr))' : initial ? 'auto 1fr auto auto' : 'auto auto', justifyContent: phone || initial ? undefined : 'end', gap: 8 }}>
        {initial && (
          <button className="app-btn danger" style={phone ? { gridColumn: '1 / -1', height: 44 } : undefined} disabled={busy} onClick={() => setConfirm(true)}>Excluir</button>
        )}
        {initial && !phone && <span />}
        <button className="app-btn" style={phone ? { height: 50 } : undefined} disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="app-btn primary" style={phone ? { height: 50 } : undefined} disabled={busy} onClick={() => void save()}>{busy && !confirm ? 'Salvando…' : 'Salvar'}</button>
      </div>
      {confirm && initial && (
        <ConfirmDeleteModal
          title={`Excluir ${initial.name}?`}
          text="Sai da caixa de ferramentas: a Yui deixa de saber para que serve e qual agente usa. O conector, app ou repositório em si não é alterado."
          rows={[
            { label: 'Acesso', value: `${initial.access.type} · ${initial.access.ref}` },
            { label: 'Agente padrão', value: initial.agent ?? 'qualquer' },
          ]}
          busy={busy}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void remove()}
        />
      )}
    </FormPanel>
  )
}
