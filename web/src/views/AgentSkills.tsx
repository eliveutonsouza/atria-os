import { useEffect, useState } from 'react'
import type { HubSkill } from '@shared/protocol'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { openPage } from '../app/Sidebar'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { card } from './ui'
import { input } from './kit'
import { fmtInstalls, SkillDrawer } from './SkillDrawer'
import { useInstalledSkills } from './SkillsView'
import { toastErr } from '../lib/feedback'

// Ficha do agente › Skills do skills.sh (Agent.dc.html): as só dele, as da plataforma e a busca
// para adicionar uma nova já com este agente marcado.

export function AgentSkills({ agentId, agentName, pluginSkills }: { agentId: string; agentName: string; pluginSkills: number }) {
  const phone = useYui((s) => s.device === 'phone')
  const inst = useInstalledSkills()
  const all = inst.data?.skills ?? []
  const mine = all.filter((s) => s.scope === 'agents' && s.agents.includes(agentId))
  const platform = all.filter((s) => s.scope === 'platform')
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  const search = useApi<{ skills: HubSkill[] }>(dq.length >= 2 ? `/api/skills/search?q=${encodeURIComponent(dq)}` : null, [dq])
  const top = useApi<{ skills: HubSkill[] }>(dq.length >= 2 ? null : '/api/skills/catalog?view=all')
  const [pick, setPick] = useState<{ source: string; skillId: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const has = (s: { source: string; skillId: string }) => all.find((i) => i.source === s.source && i.skillId === s.skillId) ?? null
  const results = (dq.length >= 2 ? search.data?.skills : top.data?.skills)?.filter((s) => !mine.some((m) => m.source === s.source && m.skillId === s.skillId)).slice(0, 6) ?? []

  const removeHere = async (name: string) => {
    if (busy) return
    setBusy(name)
    try {
      await api.del(`/api/skills/${encodeURIComponent(name)}?agent=${encodeURIComponent(agentId)}`)
      useYui.getState().say(`${name} removida de ${agentName}.`, { state: 'success' })
    } catch (e) {
      toastErr(e, `Não consegui remover ${name}`)
    } finally {
      setBusy(null)
      inst.reload()
    }
  }

  const row = { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.05)' } as const

  return (
    <section aria-label="Skills do skills.sh" style={{ display: 'grid', gridTemplateColumns: phone ? 'minmax(0,1fr)' : 'repeat(auto-fit,minmax(min(360px,100%),1fr))', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ ...card, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', marginBottom: 6, flexWrap: 'wrap' }}>
            <span className="eyebrow">Só deste agente</span>
            <span style={{ fontSize: 12, color: C.t3 }}>outros agentes não veem</span>
          </div>
          {mine.length ? (
            mine.map((s) => (
              <div key={s.name} style={row}>
                <button onClick={() => setPick(s)} style={{ minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', padding: 0, color: C.text, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div className="mono" style={{ fontSize: 12, color: C.t3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.source}
                    {s.agents.length > 1 ? ` · também em ${s.agents.length - 1} ${s.agents.length === 2 ? 'agente' : 'agentes'}` : ''}
                  </div>
                </button>
                <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, color: s.updateAvailable ? C.warn : C.ok, background: s.updateAvailable ? 'rgba(245,181,74,.10)' : 'rgba(79,224,176,.10)' }}>{s.updateAvailable ? 'atualização' : 'em dia'}</span>
                <button onClick={() => void removeHere(s.name)} disabled={busy === s.name} className="app-btn small" style={{ height: phone ? 44 : 34, padding: '0 12px', color: C.t2, fontSize: 13 }}>
                  {busy === s.name ? 'Removendo…' : 'Remover'}
                </button>
              </div>
            ))
          ) : (
            <span style={{ fontSize: 13, color: C.t3, padding: '6px 0' }}>Nenhuma skill exclusiva ainda. Adicione do skills.sh ao lado.</span>
          )}
        </div>
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span className="eyebrow">Da plataforma (todos usam)</span>
            <button onClick={() => openPage('skills')} style={{ background: 'transparent', border: 'none', color: '#7fdcf5', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
              Gerenciar em Skills →
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {platform.map((s) => (
              <span key={s.name} style={{ padding: '5px 12px', borderRadius: 999, background: 'rgba(255,255,255,.05)', fontSize: 13 }}>{s.name}</span>
            ))}
            <span style={{ padding: '5px 12px', borderRadius: 999, background: 'rgba(255,255,255,.03)', fontSize: 13, color: C.t2 }}>
              {platform.length ? '+ ' : ''}
              {pluginSkills} do Claude e plugins
            </span>
          </div>
        </div>
      </div>

      <div style={{ ...card, background: 'rgba(166,140,247,.05)', borderColor: 'rgba(166,140,247,.25)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="eyebrow" style={{ color: C.lav }}>Adicionar do skills.sh</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar skill (ex.: tdd, seo, playwright)…" aria-label="Buscar skill no skills.sh" style={{ ...input, minHeight: 44 }} />
        <span style={{ fontSize: 12, color: C.t3 }}>{dq.length >= 2 ? `Resultados para “${dq}”` : 'Mais populares no skills.sh'}</span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {(dq.length >= 2 ? search.loading && !search.data : top.loading && !top.data) ? (
            <div className="skel" style={{ height: 120 }} />
          ) : results.length ? (
            results.map((s) => {
              const other = has(s)
              return (
                <div key={`${s.source}/${s.skillId}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                  <button onClick={() => setPick(s)} style={{ minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', padding: 0, color: C.text, cursor: 'pointer', fontFamily: 'inherit' }}>
                    <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.skillId}</div>
                    <div style={{ fontSize: 12, color: C.t3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.source} · {fmtInstalls(s.installs)}
                      {other?.scope === 'platform' ? ' · já na plataforma' : ''}
                    </div>
                  </button>
                  <button
                    onClick={() => setPick(s)}
                    disabled={other?.scope === 'platform'}
                    style={{ height: phone ? 44 : 36, padding: '0 14px', borderRadius: 10, border: 'none', background: 'rgba(166,140,247,.2)', color: C.lav, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: other?.scope === 'platform' ? 0.4 : 1 }}
                  >
                    + Adicionar
                  </button>
                </div>
              )
            })
          ) : (
            <span style={{ fontSize: 13, color: C.t3 }}>Nada encontrado.</span>
          )}
        </div>
        <span style={{ fontSize: 12, color: C.t2 }}>Clique no nome para ver o SKILL.md e as auditorias antes de adicionar.</span>
      </div>

      {pick && (() => {
        const ins = has(pick)
        // já instalada só em outros agentes: abre com este agente somado à seleção
        const preset = ins?.scope === 'agents' ? [...new Set([...ins.agents, agentId])] : [agentId]
        return (
          <SkillDrawer
            source={pick.source}
            skillId={pick.skillId}
            installed={ins}
            presetAgents={preset}
            onClose={() => setPick(null)}
            onChanged={() => inst.reload()}
          />
        )
      })()}
    </section>
  )
}
