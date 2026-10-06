import { useEffect, useMemo, useState } from 'react'
import type { AgentConfig, ClaudeInitInfo, RunInfo } from '@shared/protocol'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { startRun } from '../lib/actions'
import { C } from '../lib/colors'
import { ago } from '../lib/format'
import { useYui } from '../store/yui'
import { card, Empty, ErrorNote, Skeleton, useHeader } from './ui'
import { Chip, Field, input, mcpStatusMeta, SearchBox, SmallBtn, StatusPill } from './kit'

// Ficha do agente: prompt, skills, conectores MCP (allowlist), plugins, modelo e turnos — salvos no
// frontmatter de /workspace/.claude/agents/<id>.md, aplicados a cada execução.

type Detail = AgentConfig & { runs: RunInfo[] }
const MODELS = ['', 'opus', 'sonnet', 'haiku']
const RUN_COLOR: Record<string, string> = { running: C.cyan, queued: C.t2, waiting_approval: C.warn, done: C.ok, failed: C.crit, cancelled: C.t3 }

export function AgentDetailView() {
  const id = useYui((s) => s.viewParams.agentId)
  const { data, loading, error, reload } = useApi<Detail>(id ? `/api/agents/${encodeURIComponent(id)}` : null, [id])
  const caps = useApi<ClaudeInitInfo | { at?: string }>('/api/capabilities')
  const init = caps.data && 'tools' in caps.data ? (caps.data as ClaudeInitInfo) : null
  const [draft, setDraft] = useState<AgentConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [skillQ, setSkillQ] = useState('')

  useEffect(() => {
    if (data) setDraft({ ...data })
  }, [data])

  const dirty = useMemo(() => {
    if (!data || !draft) return false
    const keys: (keyof AgentConfig)[] = ['name', 'description', 'group', 'prompt', 'model', 'maxTurns', 'skills', 'mcp', 'plugins']
    return keys.some((k) => JSON.stringify(data[k]) !== JSON.stringify(draft[k]))
  }, [data, draft])

  const save = async () => {
    if (!draft || !id) return
    setSaving(true)
    try {
      await api.put(`/api/agents/${encodeURIComponent(id)}`, draft)
      reload()
      useYui.getState().say(`${draft.name} atualizado.`, { state: 'success' })
    } catch {
      useYui.getState().say('Não consegui salvar o agente.', { state: 'warning' })
    } finally {
      setSaving(false)
    }
  }
  const duplicate = async () => {
    if (!id) return
    const a = await api.post<AgentConfig>(`/api/agents/${encodeURIComponent(id)}/duplicate`).catch(() => null)
    if (a) useYui.getState().show('agent', { agentId: a.id })
  }
  const archive = async () => {
    if (!id || !draft) return
    if (draft.archived) {
      await api.put(`/api/agents/${encodeURIComponent(id)}`, { archived: false }).catch(() => null)
      reload()
      return
    }
    await api.del(`/api/agents/${encodeURIComponent(id)}`).catch(() => null)
    useYui.getState().show('agents')
  }

  useHeader(
    draft?.group ? `Agente · ${draft.group}` : 'Agente',
    draft?.name ?? id ?? 'Agente',
    [
      { label: saving ? 'Salvando…' : dirty ? 'Salvar' : 'Salvo', fn: () => void save(), primary: dirty },
      { label: 'Testar', primary: !dirty, fn: () => id && void startRun(id, null, 'Apresente-se em 2 frases: quem você é, o que faz e quais ferramentas/conectores você tem disponíveis agora. Não altere nada.') },
      { label: 'Abrir no terminal', fn: () => useYui.getState().show('terminal', { kind: 'shell', cmd: `claude --agent ${JSON.stringify(draft?.name ?? id)}` }) },
      { label: 'Duplicar', fn: () => void duplicate() },
      { label: draft?.archived ? 'Reativar' : 'Arquivar', fn: () => void archive(), danger: !draft?.archived },
    ],
    [saving, dirty, draft?.name, draft?.archived, draft?.group],
  )

  if (!id) return <Empty text="Qual agente? Diga: “Abre o agente Designer.”" />
  if (loading && !data) return <Skeleton kpis={0} rows={6} />
  if (error || !data || !draft) return <ErrorNote text="Não encontrei esse agente." />

  const set = (p: Partial<AgentConfig>) => setDraft((d) => (d ? { ...d, ...p } : d))
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const mcpServers = init?.mcp ?? []
  const skills = (init?.skills ?? []).filter((s) => !skillQ || s.toLowerCase().includes(skillQ.toLowerCase()))
  const plugins = init?.plugins ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 1100 }}>
      {draft.archived && <div style={{ ...card, borderColor: 'rgba(245,181,74,.25)', color: '#f5c97a', fontSize: 14 }}>Agente arquivado — não recebe tarefas. Use “Reativar”.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(220px,100%),1fr))', gap: 14 }}>
        <Field label="Nome">
          <input style={input} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Grupo">
          <input style={input} value={draft.group} onChange={(e) => set({ group: e.target.value })} />
        </Field>
        <Field label="Modelo" hint="vazio = padrão do console">
          <select style={input} value={draft.model ?? ''} onChange={(e) => set({ model: e.target.value || null })}>
            {[...new Set([...MODELS, draft.model ?? ''])].map((m) => (
              <option key={m} value={m} style={{ background: '#10142a' }}>
                {m || 'padrão'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Máx. de turnos" hint="vazio = 80">
          <input style={input} type="number" min={1} max={500} value={draft.maxTurns ?? ''} onChange={(e) => set({ maxTurns: e.target.value ? Number(e.target.value) : null })} />
        </Field>
      </div>

      <Field label="Especialidade" hint="A Yui usa este texto para decidir quando delegar a este agente.">
        <input style={input} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>

      <Field label="Instruções (prompt)">
        <textarea
          className="mono"
          value={draft.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
          rows={10}
          style={{ ...input, fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.6, resize: 'vertical', minHeight: 180 }}
        />
      </Field>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span className="eyebrow">Conectores MCP</span>
          <span style={{ fontSize: 12, color: C.t3 }}>{draft.mcp.length ? `${draft.mcp.length} liberados — os demais ficam bloqueados para este agente` : 'todos liberados (marque para restringir)'}</span>
          {draft.mcp.length > 0 && <SmallBtn onClick={() => set({ mcp: [] })}>Liberar todos</SmallBtn>}
        </div>
        {mcpServers.length ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {mcpServers.map((m) => {
              const on = draft.mcp.includes(m.name)
              const meta = mcpStatusMeta(m.status)
              return (
                <Chip key={m.name} on={on} onClick={() => set({ mcp: toggle(draft.mcp, m.name) })} title={meta.label}>
                  <span aria-hidden style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: meta.color, marginRight: 6 }} />
                  {m.name.replace(/^claude\.ai /, '')}
                </Chip>
              )
            })}
          </div>
        ) : (
          <span style={{ fontSize: 13, color: C.t3 }}>Capacidades ainda não lidas — abra Ferramentas › Atualizar capacidades.</span>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="eyebrow">Skills</span>
          <span style={{ fontSize: 12, color: C.t3 }}>{draft.skills.length ? `${draft.skills.length} preferidas` : 'todas disponíveis'}</span>
          <SearchBox value={skillQ} onChange={setSkillQ} placeholder="Filtrar skills…" />
        </div>
        {draft.skills.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {draft.skills.map((s) => (
              <Chip key={s} on onClick={() => set({ skills: toggle(draft.skills, s) })}>
                {s} ×
              </Chip>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 150, overflow: 'auto' }}>
          {skills
            .filter((s) => !draft.skills.includes(s))
            .map((s) => (
              <Chip key={s} onClick={() => set({ skills: [...draft.skills, s] })}>
                + {s}
              </Chip>
            ))}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="eyebrow">Plugins preferidos</span>
        {plugins.length ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {plugins.map((p) => (
              <Chip key={p.name} on={draft.plugins.includes(p.name)} onClick={() => set({ plugins: toggle(draft.plugins, p.name) })}>
                {p.name}
              </Chip>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 13, color: C.t3 }}>Nenhum plugin ativo.</span>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Execuções nas últimas 24h</div>
        {data.runs.length ? (
          data.runs.map((r) => (
            <button
              key={r.id}
              onClick={() => useYui.getState().show('runs', { runId: r.id })}
              className="hov-row"
              style={{ display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: '11px 8px', minHeight: 44, margin: '0 -8px', border: 'none', borderBottom: '1px solid rgba(255,255,255,.05)', background: 'transparent', color: C.text, textAlign: 'left', cursor: 'pointer', borderRadius: 8, fontSize: 14 }}
            >
              <StatusPill label="" color={RUN_COLOR[r.state] ?? C.t3} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.task}</span>
              <span style={{ fontSize: 12, color: C.t3, whiteSpace: 'nowrap' }}>{ago(r.finishedAt ?? r.startedAt)}</span>
            </button>
          ))
        ) : (
          <span style={{ fontSize: 13, color: C.t3 }}>Dormindo — nenhuma execução nas últimas 24h.</span>
        )}
      </section>
    </div>
  )
}
