import { useEffect, useState } from 'react'
import type { AgentConfig, AgentInfo, RunInfo, StatsOverview } from '@shared/protocol'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { startRun } from '../../lib/actions'
import { C } from '../../lib/colors'
import { plural, toastErr, toastOk, useAction } from '../../lib/feedback'
import { useYui } from '../../store/yui'
import { AgentDetailView, FireAgentModal } from '../../views/AgentDetailView'
import { Empty, ErrorNote, Skeleton, useHeader } from '../../views/ui'
import { agentColor, Card, Dot, fmtCost, fmtDuration, fmtTokens, HBar, Kpi, openApp, relTime, useViewParams } from './common'

// Agentes (Agents.dc.html): equipe à esquerda; à direita o agente escolhido com Estatísticas | Configuração | Execuções.

interface AgentStats {
  runs30d: number
  success: number | null
  avgMs: number | null
  costUsd: number
  tokens: number
  daily: { date: string; runs: number; failed: number }[]
  topTools: { name: string; count: number }[]
}
type Tab = 'stats' | 'config' | 'runs'
type Filter = 'active' | 'archived'

async function newAgent() {
  const a = await api.post<AgentConfig>('/api/agents', { name: 'Novo agente', description: 'Descreva a especialidade', group: 'Geral', prompt: 'Instruções de trabalho do agente.' })
  if (a) {
    openApp('agents', a.id)
    setTimeout(() => window.dispatchEvent(new CustomEvent('atria-agent-tab', { detail: 'config' })), 50)
  }
}

const RUN_COLOR: Record<string, string> = { running: C.cyan, queued: C.t2, waiting_approval: C.warn, done: C.ok, failed: C.crit, cancelled: C.t3 }
const RUN_LABEL: Record<string, string> = { running: 'rodando', queued: 'na fila', waiting_approval: 'aguardando', done: 'concluído', failed: 'falhou', cancelled: 'cancelado' }

export function AgentsPage() {
  const working = useYui((s) => s.agentsWorking)
  const paramId = useYui((s) => s.appParams.id)
  const device = useYui((s) => s.device)
  const phone = device === 'phone'
  const coarse = useYui((s) => s.coarse)
  const agents = useApi<AgentInfo[]>('/api/agents', [working], 15000)
  const ov = useApi<StatsOverview>('/api/stats/overview?days=7', [], 60000)
  const list = agents.data ?? []
  const [filter, setFilter] = useState<Filter>('active')
  const all = useApi<AgentConfig[]>('/api/agents/all', [working, filter])
  const archived = (all.data ?? []).filter((a) => a.archived)
  const [firing, setFiring] = useState<AgentConfig | null>(null)
  const { run: createAgent, busy: creating } = useAction(newAgent, { error: 'Não consegui criar o agente' })
  const refresh = () => {
    agents.reload()
    all.reload()
  }
  // depois de arquivar/demitir: volta para a lista
  const gone = () => {
    refresh()
    openApp('agents')
  }
  // celular: sem id mostra só a lista (não abre o primeiro agente sozinho)
  const id = phone ? paramId : (paramId ?? list[0]?.id)
  const [tab, setTab] = useState<Tab>('stats')
  useViewParams({ agentId: id })

  // celular, só a lista: "+ Novo agente" sobe para o cabeçalho
  useEffect(() => {
    if (phone && !paramId) useYui.getState().setHeader({ eyebrow: 'Agentes', title: 'Equipe', actions: [{ label: creating ? 'Criando…' : '+ Novo agente', fn: () => void createAgent(), primary: true, disabled: creating }] })
  }, [phone, paramId, creating, createAgent])

  // "+ Novo agente" abre direto a configuração
  useEffect(() => {
    const h = (e: Event) => setTab((e as CustomEvent<Tab>).detail)
    window.addEventListener('atria-agent-tab', h)
    return () => window.removeEventListener('atria-agent-tab', h)
  }, [])

  const okBy = new Map((ov.data?.byAgent ?? []).map((a) => [a.agentId, a.success]))
  const tabs = (
    <div role="tablist" className={phone ? 'h-scroll' : undefined} style={{ display: 'flex', gap: 6, borderBottom: '1px solid rgba(255,255,255,.06)' }}>
      {(
        [
          ['stats', 'Estatísticas'],
          ['config', 'Configuração'],
          ['runs', 'Execuções'],
        ] as [Tab, string][]
      ).map(([t, l]) => (
        <button
          key={t}
          role="tab"
          aria-selected={tab === t}
          onClick={() => setTab(t)}
          style={{ padding: '8px 12px', minHeight: phone ? 44 : undefined, fontSize: phone ? 14 : 13, color: tab === t ? C.text : C.t2, border: 'none', background: 'transparent', borderBottom: `2px solid ${tab === t ? C.cyan : 'transparent'}`, cursor: 'pointer', marginBottom: -1 }}
        >
          {l}
        </button>
      ))}
    </div>
  )
  const detail = (
    <>
      {tabs}
      {tab === 'stats' && id && <AgentStatsTab id={id} info={list.find((a) => a.id === id)} onGone={gone} />}
      {tab === 'config' && <AgentDetailView onGone={gone} />}
      {tab === 'runs' && id && <AgentRunsTab id={id} info={list.find((a) => a.id === id)} />}
    </>
  )

  const reactivate = async (a: AgentConfig) => {
    try {
      await api.put(`/api/agents/${encodeURIComponent(a.id)}`, { archived: false })
      refresh()
      toastOk(`${a.name} reativado.`)
    } catch (e) {
      toastErr(e, `Não consegui reativar ${a.name}`)
    }
  }

  // celular: agente aberto ocupa a tela toda (sem a lista)
  if (phone && id) return <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>{detail}</div>

  return (
    <div className="app-split" style={{ alignItems: 'flex-start' }}>
      {firing && (
        <FireAgentModal
          agent={firing}
          onCancel={() => setFiring(null)}
          onDone={() => {
            setFiring(null)
            refresh()
          }}
        />
      )}
      <section style={{ width: phone ? '100%' : device === 'tablet' ? 280 : 380, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="app-muted">
            {plural(list.length, 'agente', 'agentes')} · {list.filter((a) => a.status === 'running').length} trabalhando
          </span>
          {!phone && (
            <button className="app-btn small" disabled={creating} onClick={() => void createAgent()}>
              {creating ? 'Criando…' : '+ Novo agente'}
            </button>
          )}
        </div>
        <div role="tablist" aria-label="Filtro de agentes" style={{ display: 'flex', gap: 6 }}>
          {(
            [
              ['active', `Ativos · ${list.length}`],
              ['archived', `Arquivados${all.data ? ` · ${archived.length}` : ''}`],
            ] as [Filter, string][]
          ).map(([f, l]) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              style={{ padding: '6px 12px', minHeight: phone || coarse ? 44 : 32, fontSize: phone ? 14 : 12.5, borderRadius: 999, cursor: 'pointer', color: filter === f ? C.text : C.t2, background: filter === f ? 'rgba(103,216,242,.1)' : 'transparent', border: `1px solid ${filter === f ? 'rgba(103,216,242,.3)' : 'rgba(255,255,255,.08)'}` }}
            >
              {l}
            </button>
          ))}
        </div>
        {filter === 'archived' && (
          <>
            {archived.length === 0 && !all.loading && <Empty text="Nenhum agente arquivado." hint="Arquivar pausa um agente sem apagar; demitir exclui de vez." />}
            {archived.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: phone ? 14 : '10px 12px', borderRadius: phone ? 16 : 14, background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: '1 1 140px' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.t2 }}>
                    {a.name} <span style={{ fontSize: 11, color: C.t3, fontWeight: 500 }}>· {a.group}</span>
                  </span>
                  <span style={{ fontSize: 12, color: C.t3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.description || 'Arquivado'}</span>
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button className="app-btn small" style={{ minHeight: phone ? 44 : undefined }} onClick={() => void reactivate(a)}>
                    Reativar
                  </button>
                  <button className="app-btn small" style={{ minHeight: phone ? 44 : undefined, color: C.critSoft, borderColor: 'rgba(240,98,114,.35)' }} onClick={() => setFiring(a)}>
                    Demitir
                  </button>
                </span>
              </div>
            ))}
          </>
        )}
        {filter === 'active' && phone && list.length === 0 && !agents.loading && <Empty text="Nenhum agente ainda." hint="Crie um com “+ Novo agente” ou peça para a Yui." />}
        {filter === 'active' && list.map((a) => {
          const sel = a.id === id
          const c = a.status === 'running' ? C.cyan : a.status === 'waiting' ? C.warn : null
          const ok = okBy.get(a.id)
          return (
            <button
              key={a.id}
              onClick={() => openApp('agents', a.id)}
              aria-current={sel ? 'true' : undefined}
              className={sel ? undefined : 'app-row'}
              style={{
                display: 'grid', gridTemplateColumns: phone ? '36px minmax(0,1fr) auto 12px' : '36px minmax(0,1fr) 54px', alignItems: 'center', gap: 12, padding: phone ? 14 : '10px 12px', minHeight: 44, borderRadius: phone ? 16 : 14, textAlign: 'left', cursor: 'pointer', color: C.text,
                background: sel ? 'rgba(103,216,242,.07)' : phone ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.02)', border: `1px solid ${sel ? 'rgba(103,216,242,.25)' : phone ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.05)'}`,
              }}
            >
              <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {c ? <Dot c={c} pulse={a.status === 'running'} size={9} /> : <span style={{ fontSize: 12, fontWeight: 700, color: agentColor(a.id) }}>{a.name.slice(0, 1)}</span>}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {a.name} <span style={{ fontSize: 11, color: C.t3, fontWeight: 500 }}>· {a.group}</span>
                </span>
                <span style={{ fontSize: 12, color: a.task ? '#c9cde0' : C.t3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.task ?? (a.status === 'sleeping' ? `Dormindo${a.nextWake && a.nextWake !== 'sob demanda' ? ` · próxima ${a.nextWake}` : ''}` : '—')}
                </span>
              </span>
              <span className="app-mono" style={{ textAlign: 'right', fontSize: 11, color: C.t2 }}>{ok == null ? '—' : `${ok}%`}</span>
              {phone && <span aria-hidden style={{ fontSize: 22, color: C.t3, lineHeight: 1 }}>›</span>}
            </button>
          )
        })}
      </section>
      {!phone && (
        <section style={{ flex: 1, minWidth: 0, width: '100%', padding: '18px 20px', borderRadius: 18, background: 'linear-gradient(180deg, rgba(20,24,50,.62), rgba(12,14,32,.62))', border: '1px solid rgba(160,170,255,.11)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!id ? <Empty text="Nenhum agente ainda." hint="Crie um com “+ Novo agente” ou peça para a Yui." /> : detail}
        </section>
      )}
    </div>
  )
}

function AgentStatsTab({ id, info, onGone }: { id: string; info?: AgentInfo; onGone: () => void }) {
  const [firing, setFiring] = useState(false)
  const st = useApi<AgentStats>(`/api/stats/agent/${encodeURIComponent(id)}`, [id], 30000)
  const cfg = useApi<AgentConfig>(`/api/agents/${encodeURIComponent(id)}`, [id])
  useHeader(
    info ? `Agente · ${info.group}` : 'Agente',
    info?.name ?? id,
    [
      { label: 'Testar', primary: true, fn: () => void startRun(id, null, 'Apresente-se em 2 frases: quem você é, o que faz e quais ferramentas/conectores você tem disponíveis agora. Não altere nada.') },
      { label: 'Abrir no terminal', fn: () => useYui.getState().show('terminal', { kind: 'shell', cmd: `claude --agent ${JSON.stringify(info?.name ?? id)}` }) },
      { label: 'Demitir', fn: () => setFiring(true), danger: true },
    ],
    [id, info?.name, info?.group],
  )
  const d = st.data
  const max = Math.max(1, ...(d?.daily ?? []).map((x) => x.runs))
  const status = info?.status === 'running' ? `● Rodando · ${info.task ?? ''}` : info?.status === 'waiting' ? `● Aguardando · ${info.task ?? ''}` : `Dormindo · última atividade ${relTime(info?.lastActivity)}`
  return (
    <>
      {firing && <FireAgentModal agent={{ id, name: info?.name ?? id }} onCancel={() => setFiring(false)} onDone={onGone} />}
      <div style={{ fontSize: 12.5, color: info?.status === 'running' ? C.cyan : info?.status === 'waiting' ? C.warn : C.t2 }}>{status}</div>
      <div className="app-grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        <Kpi label="Execuções 30d" value={d ? String(d.runs30d) : '—'} size={28} />
        <Kpi label="Sucesso" value={d?.success != null ? `${d.success}%` : '—'} color={C.ok} size={28} />
        <Kpi label="Duração média" value={fmtDuration(d?.avgMs)} size={28} />
        <Kpi label="Custo 30d" value={fmtCost(d?.costUsd)} color={C.lav} delta={d ? `${fmtTokens(d.tokens)} tokens` : undefined} size={28} />
      </div>
      <div className="app-grid-2">
        <Card title="Execuções · 14 dias">
          <div role="img" aria-label="Execuções por dia" style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 120 }}>
            {(d?.daily ?? []).map((x) => (
              <div key={x.date} title={`${x.date.slice(8)}/${x.date.slice(5, 7)} — ${x.runs} execuções${x.failed ? `, ${x.failed} falhas` : ''}`} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                <div style={{ height: x.runs ? `${(x.runs / max) * 100}%` : 2, borderRadius: '3px 3px 1px 1px', background: x.runs ? (x.failed ? `linear-gradient(180deg, ${C.warn}, rgba(166,140,247,.35))` : 'linear-gradient(180deg, #67d8f2, rgba(166,140,247,.35))') : 'rgba(255,255,255,.05)' }} />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Ferramentas mais usadas">
          {(d?.topTools ?? []).length === 0 && <span className="app-muted">Sem execuções registradas.</span>}
          {(d?.topTools ?? []).slice(0, 6).map((t, _i, arr) => (
            <HBar key={t.name} label={t.name} value={String(t.count)} pct={(t.count / (arr[0]?.count || 1)) * 100} color={C.violet} labelW={110} mono />
          ))}
        </Card>
        <Card className="app-span-2" title="Acesso deste agente" right="Configuração para editar">
          <AccessRow label="MCP" items={cfg.data?.mcp ?? []} all="todos os conectores" color={C.cyan} />
          <AccessRow label="Skills" items={cfg.data?.skills ?? []} all="todas as skills" color={C.lav} />
          <AccessRow label="Plugins" items={cfg.data?.plugins ?? []} all="plugins padrão" color={C.ok} />
          {cfg.data?.description && <div style={{ fontSize: 12.5, color: C.t2, lineHeight: 1.5 }}>{cfg.data.description}</div>}
        </Card>
      </div>
    </>
  )
}

function AccessRow({ label, items, all, color }: { label: string; items: string[]; all: string; color: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: C.t3, width: 60 }}>{label}</span>
      {items.length === 0 ? (
        <span style={{ fontSize: 12, color: C.t2 }}>{all}</span>
      ) : (
        items.map((m) => (
          <span key={m} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 9, background: `${color}1a`, border: `1px solid ${color}4d`, color }}>
            {m}
          </span>
        ))
      )}
    </div>
  )
}

function AgentRunsTab({ id, info }: { id: string; info?: AgentInfo }) {
  const phone = useYui((s) => s.device === 'phone')
  const runs = useApi<{ runs: RunInfo[] }>('/api/runs', [id], 15000)
  useHeader('Agente · execuções', info?.name ?? 'Execuções do agente', [], [id, info?.name])
  const mine = (runs.data?.runs ?? []).filter((r) => r.agentId === id)
  if (!runs.data) return runs.error ? <ErrorNote text="Não consegui carregar as execuções." retry={runs.reload} /> : <Skeleton rows={4} kpis={0} />
  if (!mine.length) return <Empty text="Esse agente ainda não rodou recentemente." hint="Use “Testar” ou peça uma tarefa para a Yui." />
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {mine.map((r) => (
        <button
          key={r.id}
          onClick={() => openApp('runs', r.id)}
          className="app-row"
          style={{ display: 'grid', gridTemplateColumns: phone ? '12px minmax(0,1fr) auto' : '12px minmax(0,1fr) 90px 70px', alignItems: 'center', gap: phone ? 10 : 12, padding: phone ? '12px 4px' : '10px 8px', minHeight: 44, border: 'none', borderBottom: '1px solid rgba(255,255,255,.05)', background: 'transparent', color: C.text, textAlign: 'left', cursor: 'pointer', borderRadius: 8 }}
        >
          <Dot c={RUN_COLOR[r.state] ?? C.t3} size={7} />
          <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.task}</span>
          {phone ? (
            // celular: estado e tempo empilhados à direita
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <span style={{ fontSize: 12, color: RUN_COLOR[r.state] ?? C.t3, whiteSpace: 'nowrap' }}>{RUN_LABEL[r.state] ?? r.state}</span>
              <span className="app-mono" style={{ fontSize: 11, color: C.t3 }}>{relTime(r.finishedAt ?? r.startedAt)}</span>
            </span>
          ) : (
            <>
              <span style={{ fontSize: 12, color: RUN_COLOR[r.state] ?? C.t3 }}>{RUN_LABEL[r.state] ?? r.state}</span>
              <span className="app-mono" style={{ fontSize: 11, color: C.t3, textAlign: 'right' }}>{relTime(r.finishedAt ?? r.startedAt)}</span>
            </>
          )}
        </button>
      ))}
    </div>
  )
}
