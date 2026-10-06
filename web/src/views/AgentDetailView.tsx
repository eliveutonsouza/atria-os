import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentConfig, AgentInfo, AgentUsageRef, ClaudeInitInfo, ModelsCatalog, RunInfo } from '@shared/protocol'
import { api, ApiError } from '../api/client'
import { useApi } from '../api/useApi'
import { startRun } from '../lib/actions'
import { C } from '../lib/colors'
import { ago } from '../lib/format'
import { useYui } from '../store/yui'
import { card, Empty, ErrorNote, Skeleton, useHeader } from './ui'
import { Chip, Field, input, mcpStatusMeta, SearchBox, SmallBtn, StatusPill } from './kit'
import { ModelSelect } from './ModelSelect'
import { BottomSheet } from './Sheet'

// Ficha do agente: prompt, skills, conectores MCP (allowlist), plugins, modelo e turnos — salvos no
// frontmatter de /workspace/.claude/agents/<id>.md, aplicados a cada execução.

type Detail = AgentConfig & { runs: RunInfo[] }
const RUN_COLOR: Record<string, string> = { running: C.cyan, queued: C.t2, waiting_approval: C.warn, done: C.ok, failed: C.crit, cancelled: C.t3 }

// onGone: para onde ir depois de arquivar/demitir (padrão: lista de agentes do canvas).
export function AgentDetailView({ onGone }: { onGone?: () => void } = {}) {
  const id = useYui((s) => s.viewParams.agentId)
  const models = useApi<ModelsCatalog>('/api/models')
  const [firing, setFiring] = useState(false)
  const gone = onGone ?? (() => useYui.getState().show('agents'))
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
    gone()
  }

  useHeader(
    draft?.group ? `Agente · ${draft.group}` : 'Agente',
    draft?.name ?? id ?? 'Agente',
    [
      { label: saving ? 'Salvando…' : dirty ? 'Salvar' : 'Salvo', fn: () => void save(), primary: dirty },
      { label: 'Testar', primary: !dirty, fn: () => id && void startRun(id, null, 'Apresente-se em 2 frases: quem você é, o que faz e quais ferramentas/conectores você tem disponíveis agora. Não altere nada.') },
      { label: 'Abrir no terminal', fn: () => useYui.getState().show('terminal', { kind: 'shell', cmd: `claude --agent ${JSON.stringify(draft?.name ?? id)}` }) },
      { label: 'Duplicar', fn: () => void duplicate() },
      { label: draft?.archived ? 'Reativar' : 'Arquivar', fn: () => void archive() },
      { label: 'Demitir', fn: () => setFiring(true), danger: true },
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
  const defaultId = models.data ? models.data.defaults.claudeConsole || models.data.defaults.claudeAccount : null
  const defaultLabel = (defaultId && models.data?.claude.find((m) => m.value === defaultId)?.label) || defaultId || 'conta do Claude'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 1100 }}>
      {firing && <FireAgentModal agent={draft} onCancel={() => setFiring(false)} onDone={gone} />}
      {draft.archived && <div style={{ ...card, borderColor: 'rgba(245,181,74,.25)', color: '#f5c97a', fontSize: 14 }}>Agente arquivado — não recebe tarefas. Use “Reativar” ou, para excluir de vez, “Demitir”.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(220px,100%),1fr))', gap: 14 }}>
        <Field label="Nome">
          <input style={input} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Grupo">
          <input style={input} value={draft.group} onChange={(e) => set({ group: e.target.value })} />
        </Field>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span className="eyebrow">Modelo</span>
          <ModelSelect
            ariaLabel="Modelo do agente"
            value={draft.model ?? ''}
            onChange={(v) => set({ model: v.trim() || null })}
            options={models.data?.claude ?? []}
            placeholderDefault={`Padrão do console — ${defaultLabel}`}
          />
          <span style={{ fontSize: 12, color: C.t3, overflowWrap: 'anywhere' }}>
            Padrão definido em Configurações › Modelos.{defaultId && <> Hoje: <span className="mono">{defaultId}</span>.</>}
          </span>
        </div>
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

const USAGE_TAG: Record<AgentUsageRef['kind'], string> = { routine: 'Rotina', workflow: 'Workflow', mission: 'Missão', toolbox: 'Ferramenta' }

// Demitir = excluir de vez (Desktop-Demitir.dc.html): mostra onde o agente está escalado e quem assume.
export function FireAgentModal({ agent, onCancel, onDone }: { agent: { id: string; name: string }; onCancel: () => void; onDone: () => void }) {
  const phone = useYui((s) => s.device === 'phone')
  const usage = useApi<AgentUsageRef[]>(`/api/agents/${encodeURIComponent(agent.id)}/usage`, [agent.id])
  const team = useApi<AgentInfo[]>('/api/agents')
  const [rep, setRep] = useState('')
  const [busy, setBusy] = useState(false)
  const refs = usage.data ?? []
  const others = (team.data ?? []).filter((a) => a.id !== agent.id)
  const needsRep = refs.length > 0
  const ready = !!usage.data && (!needsRep || !!rep)

  useEffect(() => {
    if (phone) return // a folha inferior cuida do ESC
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel, phone])

  const confirm = async () => {
    if (!ready) return
    setBusy(true)
    try {
      await api.del(`/api/agents/${encodeURIComponent(agent.id)}?hard=1${needsRep ? `&replaceWith=${encodeURIComponent(rep)}` : ''}`)
      const who = others.find((a) => a.id === rep)?.name
      useYui.getState().say(`${agent.name} demitido${needsRep && who ? `; ${who} assumiu os lugares dele` : ''}.`, { state: 'success' })
      onDone()
    } catch (e) {
      // 409: o uso mudou desde que o modal abriu — recarrega a lista
      if (e instanceof ApiError && e.status === 409) usage.reload()
      useYui.getState().say(`Não consegui demitir ${agent.name}: ${(e as Error).message}`, { state: 'warning' })
      setBusy(false)
    }
  }

  const body = (
    <>
      <div style={{ fontSize: 11, letterSpacing: '.2em', color: C.crit, fontWeight: 700 }}>AÇÃO DESTRUTIVA · NÃO DÁ PARA DESFAZER</div>
      <div id="fam-title" style={{ fontSize: 18, fontWeight: 700, overflowWrap: 'anywhere' }}>Demitir o agente {agent.name}?</div>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: '#c9cde0' }}>
        O arquivo do agente é apagado e ele não volta quando o console reinicia. As execuções antigas continuam no histórico.
      </p>
      {!usage.data ? (
        <span style={{ fontSize: 13, color: C.t3 }}>{usage.error ? 'Não consegui ver onde ele é usado.' : 'Vendo onde ele é usado…'}</span>
      ) : refs.length === 0 ? (
        <span style={{ fontSize: 13, color: C.t2 }}>Ele não está escalado em nenhuma rotina, workflow, missão ou ferramenta.</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}>Ele está escalado em {refs.length} {refs.length === 1 ? 'lugar' : 'lugares'}</div>
          {refs.map((u) => (
            <div key={`${u.kind}:${u.id}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,.06)', fontSize: 13.5, minWidth: 0 }}>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,.06)', color: C.t2, flexShrink: 0 }}>{USAGE_TAG[u.kind]}</span>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                {u.label}
                {u.detail && <span style={{ color: C.t3 }}> · {u.detail}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {needsRep && (
        <label style={{ fontSize: 12, color: C.t2, display: 'flex', flexDirection: 'column', gap: 6 }}>
          Quem assume esses lugares
          <select value={rep} onChange={(e) => setRep(e.target.value)} disabled={busy} style={{ ...input, height: 44, borderRadius: 12, background: '#0e1126' }}>
            <option value="">Escolha um agente…</option>
            {others.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.group}
              </option>
            ))}
          </select>
        </label>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: phone ? 'repeat(2, minmax(0, 1fr))' : 'auto auto', justifyContent: phone ? undefined : 'end', gap: 8 }}>
        <button autoFocus disabled={busy} onClick={onCancel} style={{ height: phone ? 50 : 42, padding: '0 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.03)', color: '#dfe3f3', fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancelar
        </button>
        <button
          disabled={busy || !ready}
          onClick={() => void confirm()}
          style={{ height: phone ? 50 : 42, padding: '0 16px', borderRadius: 10, border: 'none', background: '#e2566a', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: ready ? 'pointer' : 'not-allowed', fontFamily: 'inherit', opacity: busy || !ready ? 0.6 : 1 }}
        >
          {busy ? 'Demitindo…' : needsRep ? 'Reatribuir e demitir' : 'Demitir'}
        </button>
      </div>
    </>
  )
  if (phone)
    return (
      <BottomSheet label={`Demitir ${agent.name}`} role="alertdialog" tone="rgba(240,98,114,.5)" onClose={busy ? () => {} : onCancel}>
        {body}
      </BottomSheet>
    )
  return createPortal(
    <div onClick={busy ? undefined : onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,10,.66)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 16 }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="fam-title" onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: '100%', maxHeight: 'calc(var(--vvh) - 32px)', overflowY: 'auto', boxSizing: 'border-box', padding: 22, borderRadius: 18, background: '#10132a', border: '1px solid rgba(240,98,114,.35)', boxShadow: '0 30px 80px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {body}
      </div>
    </div>,
    document.body,
  )
}
