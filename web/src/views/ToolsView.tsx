import { useMemo, useState } from 'react'
import type { AgentConfig, ClaudeInitInfo, ToolboxItem } from '@shared/protocol'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { startRun, submitText } from '../lib/actions'
import { C } from '../lib/colors'
import { ago } from '../lib/format'
import { useYui } from '../store/yui'
import { card, Empty, ErrorNote, Skeleton, useHeader } from './ui'
import { Chip, mcpStatusMeta, SearchBox, SmallBtn, STATUS_META, StatusPill, Tabs } from './kit'

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
  const toolbox = useApi<ToolboxItem[]>('/api/toolbox', [], 60000)
  const caps = useApi<ClaudeInitInfo | { at?: string }>('/api/capabilities')
  const agents = useApi<AgentConfig[]>('/api/agents/all')
  const init = caps.data && 'tools' in caps.data ? (caps.data as ClaudeInitInfo) : null

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14 }}>
        {kpis.map((k) => (
          <div key={k.l} style={card}>
            <div style={{ fontSize: 12, color: C.t2, marginBottom: 8 }}>{k.l}</div>
            <div style={{ fontSize: 40, fontWeight: 300, lineHeight: 1, letterSpacing: '-.02em', color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <Tabs value={tab} onChange={setTab} items={TABS.map((id) => ({ id, label: labels[id], count: counts[id] }))} />
        <SearchBox value={q} onChange={setQ} placeholder="Filtrar…" />
      </div>
      {init?.at && (
        <div style={{ fontSize: 12, color: C.t3, marginTop: -10 }}>
          Capacidades lidas do Claude Code {ago(init.at)} · modelo {init.model}
        </div>
      )}

      {(tab === 'connectors' || tab === 'apps') && <ToolList items={tab === 'connectors' ? connectors : apps} />}

      {tab === 'mcp' &&
        (mcp.length ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {mcp.map((m) => {
              const meta = mcpStatusMeta(m.status)
              const prefix = `mcp__${m.name.replace(/[^a-zA-Z0-9_-]/g, '_')}__`
              const tools = (init?.tools ?? []).filter((t) => t.startsWith(prefix)).length
              const users = agentsUsingMcp(m.name, activeAgents)
              const short = m.name.replace(/^claude\.ai /, '')
              return (
                <div key={m.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px,1.2fr) 150px minmax(0,2fr) auto', gap: 14, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.05)', fontSize: 14 }}>
                  <span style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {short}
                    <span style={{ fontSize: 11, color: C.t3, fontWeight: 400, marginLeft: 8 }}>{m.name.startsWith('claude.ai') ? 'claude.ai' : m.source ?? 'local'}</span>
                  </span>
                  <StatusPill {...meta} />
                  <span style={{ fontSize: 12, color: C.t3, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tools ? `${tools} ferramentas · ` : ''}
                    {activeAgents.length && users.length === activeAgents.length ? 'todos os agentes' : users.join(', ') || 'nenhum agente'}
                  </span>
                  {m.status === 'needs-auth' ? (
                    <SmallBtn onClick={() => window.open(CONNECTORS_URL, '_blank', 'noopener')}>Autorizar</SmallBtn>
                  ) : (
                    <SmallBtn onClick={() => submitText(`Testa o conector ${short} com uma consulta rápida somente leitura.`)}>Pedir à Yui</SmallBtn>
                  )}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
            {plugins.map((p) => {
              const sk = (init?.skills ?? []).filter((s) => s.startsWith(`${p.name}:`))
              const users = activeAgents.filter((a) => a.plugins.includes(p.name)).map((a) => a.name)
              return (
                <div key={p.name} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
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

function ToolList({ items }: { items: ToolboxItem[] }) {
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
                  <div style={{ display: 'flex', gap: 6 }}>
                    {t.status === 'needs-auth' && t.access.type === 'mcp' ? (
                      <SmallBtn onClick={() => window.open(CONNECTORS_URL, '_blank', 'noopener')}>Autorizar</SmallBtn>
                    ) : (
                      <SmallBtn onClick={() => testTool(t)} title="Run curta somente leitura">
                        Testar
                      </SmallBtn>
                    )}
                  </div>
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
