import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentInfo, ClaudeInitInfo, RepoInfo, RunInfo } from '@shared/protocol'
import { api, ApiError } from '../../api/client'
import { C } from '../../lib/colors'
import { useYui } from '../../store/yui'
import { ClaudeGuideView } from '../../views/ClaudeGuideView'
import { Chip, input, SearchBox, SmallBtn, Tabs } from '../../views/kit'
import { useHeader } from '../../views/ui'

// Central de comandos (Claude.dc.html): as ferramentas do Claude Code viram botões.
// Cada botão roda de verdade — como agente em segundo plano (resultado volta para a Yui/Execuções)
// ou no terminal interativo (comando já digitado na sessão Claude do projeto).

type Mode = 'bg' | 'tty'
type Cmd = {
  key: string // o que aparece em mono no botão
  label: string
  kind: 'slash' | 'skill' | 'prompt' | 'nav'
  value: string // nome do comando/skill, texto do pedido ou destino
  agent?: string // agente sugerido para rodar em segundo plano
}
type Cat = { title: string; color: string; desc: string; cmds: Cmd[] }

const CATS: Cat[] = [
  {
    title: 'Revisar código', color: C.cyan, desc: 'Revisões do diff atual ou do projeto inteiro, com achados por severidade.',
    cmds: [
      { key: '/review', label: 'Revisar PR', kind: 'slash', value: 'review', agent: 'backend' },
      { key: '/code-review', label: 'Revisão profunda', kind: 'slash', value: 'code-review', agent: 'backend' },
      { key: '/security-review', label: 'Segurança', kind: 'slash', value: 'security-review', agent: 'security' },
      { key: '/simplify', label: 'Simplificar', kind: 'slash', value: 'simplify', agent: 'backend' },
    ],
  },
  {
    title: 'Entender & documentar', color: C.lav, desc: 'Mapear a arquitetura, gerar CLAUDE.md e explicar partes do sistema.',
    cmds: [
      { key: '/init', label: 'Gerar CLAUDE.md', kind: 'slash', value: 'init', agent: 'backend' },
      { key: 'explain', label: 'Explicar arquitetura', kind: 'prompt', value: 'Explique a arquitetura deste projeto: pastas principais, fluxo de dados, dependências externas e pontos de atenção. Seja objetivo.', agent: 'backend' },
      { key: '/insights', label: 'Insights', kind: 'slash', value: 'insights', agent: 'backend' },
      { key: '/context', label: 'Contexto', kind: 'slash', value: 'context', agent: 'backend' },
    ],
  },
  {
    title: 'Construir & testar', color: C.ok, desc: 'Rodar, depurar e verificar mudanças com o app de verdade.',
    cmds: [
      { key: '/run', label: 'Rodar o app', kind: 'skill', value: 'run', agent: 'qa' },
      { key: '/debug', label: 'Depurar', kind: 'skill', value: 'debug', agent: 'backend' },
      { key: '/verify', label: 'Verificar', kind: 'skill', value: 'verify', agent: 'qa' },
      { key: 'tests', label: 'Gerar testes', kind: 'prompt', value: 'Escreva testes automatizados para as partes mais críticas deste projeto que ainda não têm cobertura, rode a suíte e informe quantos passam.', agent: 'qa' },
    ],
  },
  {
    title: 'Design & documentos', color: C.violet, desc: 'Claude Design, decks, PDFs, planilhas e visualizações.',
    cmds: [
      { key: 'design', label: 'Claude Design', kind: 'skill', value: 'design', agent: 'designer' },
      { key: 'pptx', label: 'Apresentação', kind: 'skill', value: 'anthropic-skills:pptx', agent: 'designer' },
      { key: 'pdf', label: 'PDF', kind: 'skill', value: 'anthropic-skills:pdf', agent: 'designer' },
      { key: 'dataviz', label: 'Gráficos', kind: 'skill', value: 'dataviz', agent: 'designer' },
    ],
  },
  {
    title: 'Automatizar', color: C.warn, desc: 'Rotinas, loops e agentes em segundo plano viram agendamentos da Yui.',
    cmds: [
      { key: '/schedule', label: 'Agendar', kind: 'nav', value: 'schedule' },
      { key: '/loop', label: 'Repetir', kind: 'nav', value: 'schedule' },
      { key: '--bg', label: 'Segundo plano', kind: 'nav', value: 'runs' },
      { key: 'workflow', label: 'Novo workflow', kind: 'nav', value: 'workflows' },
    ],
  },
  {
    title: 'Pesquisar', color: '#7fdcf5', desc: 'Pesquisa profunda na web com fontes, resumo e relatório.',
    cmds: [
      { key: 'deep-research', label: 'Pesquisa', kind: 'skill', value: 'deep-research', agent: 'research' },
      { key: 'browser', label: 'Navegar', kind: 'nav', value: 'browser' },
      { key: 'firecrawl', label: 'Extrair site', kind: 'prompt', value: 'Use o conector Firecrawl para extrair o conteúdo do site que eu indicar abaixo e resuma os pontos principais.', agent: 'research' },
      { key: 'apify', label: 'Leads', kind: 'prompt', value: 'Use o conector Apify para buscar leads conforme o pedido abaixo e devolva uma tabela com nome, site, contato e motivo.', agent: 'research' },
    ],
  },
]

function instructionFor(cmd: Cmd, extra: string): string {
  const tail = extra.trim() ? `\n\nDetalhes do pedido: ${extra.trim()}` : ''
  const close = '\n\nNo final, resuma em português: o que encontrou ou fez, o que mudou e o próximo passo.'
  if (cmd.kind === 'slash') return `Execute o comando /${cmd.value} do Claude Code neste projeto (se ele for uma skill, use a ferramenta Skill com "${cmd.value}").${tail}${close}`
  if (cmd.kind === 'skill') return `Use a skill "${cmd.value}" (ferramenta Skill) neste projeto.${tail}${close}`
  return `${cmd.value}${tail}${close}`
}

function ttyCommand(cmd: Cmd, extra: string): string {
  if (cmd.kind === 'slash' || cmd.kind === 'skill') return `/${cmd.value.replace(/^anthropic-skills:/, 'anthropic-skills:')}${extra.trim() ? ` ${extra.trim()}` : ''}`
  return `${cmd.value}${extra.trim() ? ` ${extra.trim()}` : ''}`
}

function openTerminal(kind: 'claude' | 'shell', project: string | null, cmd?: string) {
  const s = useYui.getState()
  s.set({
    viewParams: { ...s.viewParams, kind, cmd: cmd || undefined, project: project ?? undefined },
    ...(project ? { activeProject: project } : {}),
    shellMode: 'app',
    appPage: 'terminal',
    appParams: {},
  })
}

const goPage = (page: 'schedule' | 'runs' | 'workflows' | 'browser') => useYui.getState().set({ shellMode: 'app', appPage: page, appParams: {} })

function CommandsTab({ caps, agents }: { caps: ClaudeInitInfo | null; agents: AgentInfo[] }) {
  const active = useYui((s) => s.activeProject)
  const [repos, setRepos] = useState<RepoInfo[]>([])
  const [project, setProject] = useState<string>(active ?? '')
  const [mode, setMode] = useState<Mode>('bg')
  const [extra, setExtra] = useState('')
  const [sent, setSent] = useState<{ ok: boolean; text: string; runId?: string } | null>(null)
  const phone = useYui((s) => s.device === 'phone')
  useEffect(() => {
    api.get<RepoInfo[]>('/api/repos').then((r) => setRepos(r.filter((x) => x.cloned))).catch(() => {})
  }, [])
  useEffect(() => {
    if (!project && active) setProject(active)
  }, [active, project])

  const installed = useMemo(() => new Set([...(caps?.skills ?? []), ...(caps?.slashCommands ?? [])]), [caps])
  const agentIds = useMemo(() => new Set(agents.map((a) => a.id)), [agents])
  const available = (c: Cmd) => (c.kind === 'slash' || c.kind === 'skill' ? !caps || installed.has(c.value) : true)
  const pickAgent = (c: Cmd) => (c.agent && agentIds.has(c.agent) ? c.agent : c.agent === 'designer' && agentIds.has('frontend') ? 'frontend' : agents[0]?.id ?? 'backend')

  const run = async (c: Cmd) => {
    if (c.kind === 'nav') return goPage(c.value as 'schedule')
    if (mode === 'tty') return openTerminal('claude', project || null, ttyCommand(c, extra))
    setSent(null)
    try {
      const r = await api.post<RunInfo>('/api/runs', { agentId: pickAgent(c), project: project || null, instruction: instructionFor(c, extra) })
      setSent({ ok: true, text: `${c.key} enviado para ${r.agent}${project ? ` no ${project}` : ''}. O resultado volta para a Yui e para Execuções.`, runId: r.id })
    } catch (e) {
      setSent({ ok: false, text: e instanceof ApiError ? e.message : 'Não consegui iniciar agora.' })
    }
  }

  const seg = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      style={{ height: phone ? 40 : 32, flex: phone ? '1 1 0' : undefined, minWidth: 0, padding: '0 12px', borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit', border: `1px solid ${mode === m ? 'rgba(103,216,242,.3)' : 'rgba(255,255,255,.08)'}`, background: mode === m ? 'rgba(103,216,242,.12)' : 'transparent', color: mode === m ? '#a9e9f8' : C.t2 }}
    >
      {label}
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: C.t2, flex: phone ? '1 1 100%' : undefined, minWidth: 0 }}>
          Projeto
          <select value={project} onChange={(e) => setProject(e.target.value)} style={{ ...input, width: phone ? '100%' : 'auto', minWidth: phone ? 0 : 180, flex: phone ? 1 : undefined, padding: '7px 10px', fontWeight: 600 }}>
            <option value="">workspace (sem projeto)</option>
            {repos.map((r) => <option key={r.slug} value={r.slug}>{r.slug}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12, color: C.t2, marginLeft: phone ? 0 : 6, flexBasis: phone ? '100%' : undefined }}>Executar como</span>
        {seg('bg', phone ? 'Segundo plano' : 'Agente em segundo plano')}
        {seg('tty', phone ? 'Terminal' : 'Terminal interativo')}
        {!phone && <span style={{ flex: 1 }} />}
        <span style={{ fontSize: 12, color: C.t3 }}>{mode === 'bg' ? 'Resultado volta para a Yui e para Execuções' : 'Abre o Claude do projeto com o comando digitado'}</span>
      </section>
      <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Detalhes opcionais (ex.: “só a pasta src/auth”, “tema: vendas de setembro”, URL do site…)" aria-label="Detalhes do pedido" style={input} />
      {sent && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, fontSize: 13, background: sent.ok ? 'rgba(79,224,176,.08)' : 'rgba(240,98,114,.08)', border: `1px solid ${sent.ok ? 'rgba(79,224,176,.25)' : 'rgba(240,98,114,.3)'}`, color: sent.ok ? '#8af0cc' : '#f39aa4' }}>
          <span style={{ flex: 1 }}>{sent.text}</span>
          {sent.runId && <SmallBtn onClick={() => useYui.getState().set({ shellMode: 'app', appPage: 'runs', appParams: { id: sent.runId! } })}>Acompanhar</SmallBtn>}
        </div>
      )}
      <section style={{ display: 'grid', gridTemplateColumns: phone ? 'minmax(0,1fr)' : 'repeat(auto-fit,minmax(300px,1fr))', gap: 12 }}>
        {CATS.map((cat) => (
          <div key={cat.title} style={{ padding: 16, borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color }} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{cat.title}</span>
            </div>
            <span style={{ fontSize: 12, color: C.t2, lineHeight: 1.45 }}>{cat.desc}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {cat.cmds.map((c) => {
                const ok = available(c)
                return (
                  <button
                    key={c.key}
                    type="button"
                    disabled={!ok}
                    onClick={() => run(c)}
                    title={ok ? (c.kind === 'nav' ? `Abrir ${c.label}` : mode === 'bg' ? `Rodar ${c.key} como agente` : `Abrir ${c.key} no terminal`) : 'Não instalado nesta conta'}
                    className="hov-bg2"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.03)', color: '#dfe3f3', fontSize: 12.5, cursor: ok ? 'pointer' : 'not-allowed', opacity: ok ? 1 : 0.45, fontFamily: 'inherit' }}
                  >
                    <span className="mono" style={{ color: cat.color, fontSize: 11.5 }}>{c.key}</span>
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

function SkillsTab({ caps, agents }: { caps: ClaudeInitInfo | null; agents: AgentInfo[] }) {
  const phone = useYui((s) => s.device === 'phone')
  const [q, setQ] = useState('')
  const [note, setNote] = useState('')
  const active = useYui((s) => s.activeProject)
  const skills = (caps?.skills ?? []).filter((s) => !q || s.toLowerCase().includes(q.toLowerCase()))
  const use = async (skill: string) => {
    const agent = /design|canvas|pptx|pdf|docx|xlsx|dataviz|artifacts/.test(skill) ? 'designer' : /research/.test(skill) ? 'research' : 'backend'
    const agentId = agents.some((a) => a.id === agent) ? agent : agents[0]?.id ?? 'backend'
    try {
      const r = await api.post<RunInfo>('/api/runs', { agentId, project: active ?? null, instruction: `Use a skill "${skill}" (ferramenta Skill) no projeto atual e resuma o resultado em português.` })
      setNote(`${skill} enviado para ${r.agent}.`)
    } catch {
      setNote('Não consegui iniciar agora.')
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <SearchBox value={q} onChange={setQ} placeholder="Buscar skill…" />
        <span style={{ fontSize: 12, color: C.t3 }}>{caps ? `${caps.skills.length} skills instaladas` : 'Capacidades ainda não lidas — Configurações › Sistema › Atualizar.'}</span>
        {note && <span role="status" style={{ fontSize: 12.5, color: C.ok }}>{note}</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: phone ? 'minmax(0,1fr)' : 'repeat(auto-fill,minmax(260px,1fr))', gap: 8 }}>
        {skills.map((s) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
            <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#cbbcff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s}>{s}</span>
            <SmallBtn onClick={() => use(s)}>Usar</SmallBtn>
            <SmallBtn onClick={() => openTerminal('claude', active, `/${s}`)}>Terminal</SmallBtn>
          </div>
        ))}
      </div>
    </div>
  )
}

function SessionsTab() {
  const phone = useYui((s) => s.device === 'phone')
  const [list, setList] = useState<{ name: string; created: string; attached: boolean }[] | null>(null)
  const load = useCallback(() => api.get<{ name: string; created: string; attached: boolean }[]>('/api/terminal/sessions').then(setList).catch(() => setList([])), [])
  useEffect(() => {
    void load()
  }, [load])
  if (!list) return null
  if (!list.length) return <span style={{ fontSize: 13, color: C.t3 }}>Nenhuma sessão de terminal aberta. Abra uma pela aba Comandos ou pela página Terminal.</span>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.map((s) => {
        const m = /^yui-(claude|shell)-(.+)$/.exec(s.name)
        const kind = (m?.[1] ?? 'shell') as 'claude' | 'shell'
        const slug = m?.[2] === 'workspace' ? null : m?.[2] ?? null
        return (
          <div key={s.name} style={{ display: 'grid', gridTemplateColumns: phone ? '1fr 1fr' : 'minmax(0,1fr) auto auto', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, gridColumn: phone ? '1 / -1' : undefined }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: 'anywhere' }}>{kind === 'claude' ? 'Claude' : 'Shell'} · {slug ?? 'workspace'}</span>
              <span style={{ fontSize: 12, color: C.t3 }}>aberta {new Date(s.created).toLocaleString('pt-BR')}{s.attached ? ' · em uso agora' : ''}</span>
            </span>
            <SmallBtn onClick={() => openTerminal(kind, slug)}>Reconectar</SmallBtn>
            <SmallBtn onClick={() => api.del(`/api/terminal/sessions/${encodeURIComponent(s.name)}`).then(load).catch(() => {})}>Encerrar</SmallBtn>
          </div>
        )
      })}
    </div>
  )
}

export function ClaudePage() {
  const [tab, setTab] = useState<'cmds' | 'guide' | 'skills' | 'sessions'>('cmds')
  const [caps, setCaps] = useState<ClaudeInitInfo | null>(null)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  useEffect(() => {
    api.get<ClaudeInitInfo & { tools?: string[] }>('/api/capabilities').then((c) => setCaps(c.tools ? c : null)).catch(() => {})
    api.get<AgentInfo[]>('/api/agents').then(setAgents).catch(() => {})
  }, [])
  const phone = useYui((s) => s.device === 'phone')
  useHeader('Claude Code · central de comandos', 'Um clique, o Claude faz', [], [tab])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div className={phone ? 'h-scroll' : undefined}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'cmds', label: 'Comandos' },
            { id: 'guide', label: 'Guia' },
            { id: 'skills', label: 'Skills', count: caps?.skills.length },
            { id: 'sessions', label: 'Sessões' },
          ]}
        />
      </div>
      {tab === 'cmds' && <CommandsTab caps={caps} agents={agents} />}
      {tab === 'guide' && <GuideTab />}
      {tab === 'skills' && <SkillsTab caps={caps} agents={agents} />}
      {tab === 'sessions' && <SessionsTab />}
      {tab === 'cmds' && !caps && <Chip>As capacidades do Claude ainda não foram lidas — os botões ficam todos liberados.</Chip>}
    </div>
  )
}

// O mapa visual reaproveitado; ele define o próprio cabeçalho, então restauramos o da central ao sair.
function GuideTab() {
  useEffect(() => () => useYui.getState().setHeader({ eyebrow: 'Claude Code · central de comandos', title: 'Um clique, o Claude faz', actions: [] }), [])
  return <ClaudeGuideView />
}
