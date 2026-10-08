import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentInfo, HubSkillDetail, InstalledSkill, SkillAudit } from '@shared/protocol'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { renderNote } from '../vault/markdown'
import { BottomSheet } from './Sheet'
import { ConfirmDeleteModal } from './ui'
import '../help/help.css'

// Ficha da skill (Detail.dc.html / PhoneSheet.dc.html): descrição, auditorias do skills.sh (só selo),
// onde instalar (plataforma toda ou só agentes escolhidos) e o SKILL.md que o Claude vai aprender.

export const AUDIT_COLOR: Record<SkillAudit['result'], { fg: string; bg: string }> = {
  pass: { fg: C.ok, bg: 'rgba(79,224,176,.08)' },
  warn: { fg: C.warn, bg: 'rgba(245,181,74,.10)' },
  fail: { fg: C.crit, bg: 'rgba(240,98,114,.10)' },
  unknown: { fg: C.t2, bg: 'rgba(255,255,255,.05)' },
}

export function fmtInstalls(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} mi`
  if (n >= 1e3) return `${Math.round(n / 1e3)} mil`
  return String(n)
}

export function AuditBadges({ audits, short }: { audits: SkillAudit[]; short?: boolean }) {
  if (!audits.length) return <span style={{ fontSize: 12, color: C.t3 }}>Sem auditoria publicada.</span>
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {audits.map((a) => (
        <span key={a.name} style={{ padding: '5px 10px', borderRadius: 10, fontSize: 12, color: AUDIT_COLOR[a.result].fg, background: AUDIT_COLOR[a.result].bg }}>
          {short ? a.name.replace('Gen Agent ', '') : a.name} · {a.result === 'unknown' ? '?' : a.result[0].toUpperCase() + a.result.slice(1)}
        </span>
      ))}
    </div>
  )
}

export function scopeLabel(s: InstalledSkill, agents: AgentInfo[]) {
  if (s.scope === 'platform') return 'Plataforma'
  if (s.agents.length > 2) return `${s.agents.length} agentes`
  return s.agents.map((id) => agents.find((a) => a.id === id)?.name ?? id).join(', ')
}

export function SkillDrawer({ source, skillId, installed, presetAgents, onClose, onChanged }: {
  source: string
  skillId: string
  installed: InstalledSkill | null
  presetAgents?: string[]
  onClose: () => void
  onChanged: () => void
}) {
  const phone = useYui((s) => s.device === 'phone')
  const d = useApi<HubSkillDetail>(`/api/skills/detail?source=${encodeURIComponent(source)}&skill=${encodeURIComponent(skillId)}`, [source, skillId])
  const team = useApi<AgentInfo[]>('/api/agents')
  const agents = team.data ?? []
  // vindo da ficha de um agente (presetAgents), a seleção já inclui ele; na plataforma, mantém a plataforma
  const [scope, setScope] = useState<'platform' | 'agents'>(installed?.scope === 'platform' ? 'platform' : presetAgents?.length ? 'agents' : installed?.scope ?? 'platform')
  const [picked, setPicked] = useState<string[]>(presetAgents ?? installed?.agents ?? [])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [showAll, setShowAll] = useState(!phone)

  useEffect(() => {
    if (phone) return
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmDel) onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose, phone, confirmDel])

  const skillMd = d.data?.skillMd ?? ''
  const html = useMemo(() => (skillMd ? renderNote(skillMd.replace(/^---\n[\s\S]*?\n---\n?/, '')) : ''), [skillMd])
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const sameScope = installed && installed.scope === scope && (scope === 'platform' || JSON.stringify([...installed.agents].sort()) === JSON.stringify([...picked].sort()))
  const canInstall = !!d.data?.installable && (scope === 'platform' || picked.length > 0)
  const say = (t: string, state: 'success' | 'warning' = 'success') => useYui.getState().say(t, { state })

  const run = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      say(done)
      onChanged()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const where = scope === 'platform' ? 'na plataforma' : picked.length === 1 ? `em ${agents.find((a) => a.id === picked[0])?.name ?? picked[0]}` : `em ${picked.length} agentes`
  const install = () => run('install', () => api.post('/api/skills/install', { source, skillId, scope, agents: picked }), `Skill ${skillId} instalada ${where}.`)
  const saveScope = () => installed && run('scope', () => api.put(`/api/skills/${encodeURIComponent(installed.name)}/scope`, { scope, agents: picked }), `Alcance de ${installed.name} atualizado.`)
  const update = () => installed && run('update', () => api.post(`/api/skills/${encodeURIComponent(installed.name)}/update`), `${installed.name} atualizada.`)
  const remove = () => installed && run('remove', () => api.del(`/api/skills/${encodeURIComponent(installed.name)}`), `${installed.name} removida.`)

  const detail = d.data
  const visibleAgents = showAll ? agents : agents.filter((a) => picked.includes(a.id)).concat(agents.filter((a) => !picked.includes(a.id)).slice(0, 3))

  const primaryLabel = busy === 'install' ? 'Instalando…' : busy === 'scope' ? 'Salvando…' : installed ? (sameScope ? 'Instalada' : 'Salvar alcance') : scope === 'platform' ? 'Instalar na plataforma' : picked.length ? `Instalar em ${picked.length === 1 ? agents.find((a) => a.id === picked[0])?.name ?? '1 agente' : `${picked.length} agentes`}` : 'Escolha os agentes'
  const primaryDisabled = !!busy || (installed ? !!sameScope || (scope === 'agents' && !picked.length) : !canInstall)

  const radio = (value: 'platform' | 'agents', title: string, hint: string) => {
    const on = scope === value
    return (
      <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12, minHeight: 44, borderRadius: 12, cursor: 'pointer', border: `1px solid ${on ? 'rgba(166,140,247,.5)' : 'rgba(255,255,255,.08)'}`, background: on ? 'rgba(166,140,247,.06)' : 'transparent' }}>
        <input type="radio" name="skill-scope" checked={on} onChange={() => setScope(value)} style={{ marginTop: 3, accentColor: C.violet }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{title}</span>
          <span style={{ fontSize: 12, color: C.t2 }}>{hint}</span>
        </span>
      </label>
    )
  }

  const body = (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ overflowWrap: 'anywhere' }}>Skill · {source}</div>
            <h2 style={{ margin: '6px 0 0', fontSize: phone ? 22 : 26, fontWeight: 500, overflowWrap: 'anywhere' }}>{skillId}</h2>
          </div>
          {!phone && (
            <button aria-label="Fechar" onClick={onClose} style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', background: 'transparent', color: C.t2, fontSize: 20, cursor: 'pointer' }}>
              ×
            </button>
          )}
        </div>
        {d.loading && !detail ? (
          <div className="skel" style={{ height: 40 }} />
        ) : (
          <>
            {detail?.description && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#c9cde0' }}>{detail.description}</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: C.t2 }}>
              {detail && detail.files > 0 && <span style={pill}>{detail.files} arquivos · {Math.max(1, Math.round(detail.bytes / 1024))} KB</span>}
              {installed && <span style={{ ...pill, color: C.ok, background: 'rgba(79,224,176,.08)' }}>✓ instalada · {scopeLabel(installed, agents)}</span>}
              {installed?.updateAvailable && <span style={{ ...pill, color: C.warn, background: 'rgba(245,181,74,.10)' }}>atualização disponível</span>}
              <a href={`https://skills.sh/${source}/${encodeURIComponent(skillId)}`} target="_blank" rel="noopener noreferrer" style={pill}>skills.sh ↗</a>
              {source.includes('/') && <a href={`https://github.com/${source}`} target="_blank" rel="noopener noreferrer" style={pill}>GitHub ↗</a>}
            </div>
          </>
        )}
      </div>

      <section aria-label="Auditorias de segurança" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="eyebrow">Auditorias (skills.sh)</div>
        {detail ? <AuditBadges audits={detail.audits} short={phone} /> : <div className="skel" style={{ height: 28 }} />}
      </section>

      {detail && !detail.installable && !installed && (
        <div style={{ padding: 12, borderRadius: 12, background: 'rgba(245,181,74,.08)', color: '#f5c97a', fontSize: 13 }}>{detail.reason ?? 'Não dá para instalar esta skill automaticamente.'}</div>
      )}

      <section aria-label="Onde instalar" style={{ padding: phone ? 0 : 16, borderRadius: 16, background: phone ? 'transparent' : 'rgba(255,255,255,.03)', border: phone ? 'none' : '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="eyebrow">Onde instalar</div>
        {radio('platform', 'Plataforma toda', 'A Yui e todos os agentes podem usar.')}
        {radio('agents', 'Só estes agentes', 'Os outros agentes não enxergam esta skill.')}
        {scope === 'agents' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {visibleAgents.map((a) => {
              const on = picked.includes(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(a.id)}
                  style={{ minHeight: phone ? 40 : 32, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${on ? 'rgba(166,140,247,.6)' : 'rgba(255,255,255,.1)'}`, background: on ? 'rgba(166,140,247,.18)' : 'transparent', color: on ? C.text : C.t2 }}
                >
                  {on ? '✓ ' : ''}
                  {a.name}
                </button>
              )
            })}
            {!showAll && agents.length > visibleAgents.length && (
              <button type="button" onClick={() => setShowAll(true)} style={{ minHeight: 40, padding: '0 12px', borderRadius: 999, border: '1px solid rgba(255,255,255,.1)', background: 'transparent', color: C.t2, fontSize: 13, cursor: 'pointer' }}>
                +{agents.length - visibleAgents.length}
              </button>
            )}
          </div>
        )}
      </section>

      <section aria-label="Conteúdo" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div className="eyebrow">SKILL.md · o que o Claude vai aprender</div>
        </div>
        {d.loading && !detail ? (
          <div className="skel" style={{ height: 160 }} />
        ) : html ? (
          <div className="hp-md" style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(0,0,0,.25)', border: '1px solid rgba(255,255,255,.05)', fontSize: 13.5, maxHeight: phone ? 260 : undefined, overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span style={{ fontSize: 13, color: C.t3 }}>Conteúdo indisponível.</span>
        )}
      </section>
      {error && <div role="alert" style={{ fontSize: 13, color: '#f39aa4' }}>{error}</div>}
    </>
  )

  const footer = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', flexDirection: phone ? 'column-reverse' : 'row' }}>
      {!phone && <span style={{ fontSize: 12, color: C.t3, marginRight: 'auto' }}>Baixa do GitHub do autor e vale na próxima execução.</span>}
      {installed && (
        <button onClick={() => setConfirmDel(true)} disabled={!!busy} style={{ ...btn, width: phone ? '100%' : undefined, color: '#f39aa4', borderColor: 'rgba(240,98,114,.35)' }}>
          Remover
        </button>
      )}
      {installed?.updateAvailable && (
        <button onClick={() => void update()} disabled={!!busy} style={{ ...btn, width: phone ? '100%' : undefined }}>
          {busy === 'update' ? 'Atualizando…' : 'Atualizar'}
        </button>
      )}
      {!phone && (
        <button onClick={onClose} style={btn}>
          {installed ? 'Fechar' : 'Cancelar'}
        </button>
      )}
      <button
        onClick={() => void (installed ? saveScope() : install())}
        disabled={primaryDisabled}
        style={{ ...btn, width: phone ? '100%' : undefined, height: phone ? 52 : 44, border: 'none', background: primaryDisabled ? 'rgba(255,255,255,.08)' : 'linear-gradient(135deg,#67d8f2,#a68cf7)', color: primaryDisabled ? C.t2 : '#06070d', fontWeight: 700 }}
      >
        {primaryLabel}
      </button>
    </div>
  )

  const confirm = confirmDel && installed && (
    <ConfirmDeleteModal
      title={`Remover a skill ${installed.name}?`}
      text="Apaga a cópia baixada e tira a skill da plataforma e de todos os agentes. Dá para instalar de novo depois."
      rows={[{ label: 'Onde está', value: scopeLabel(installed, agents) }]}
      busy={busy === 'remove'}
      onCancel={() => setConfirmDel(false)}
      onConfirm={() => void remove()}
    />
  )

  if (phone)
    return (
      <>
        <BottomSheet label={`Skill ${skillId}`} onClose={onClose}>
          {body}
          {footer}
        </BottomSheet>
        {confirm}
      </>
    )
  // modal de remoção fica fora do overlay: eventos de portal sobem pela árvore React e fechariam a ficha
  return (
    <>
      {createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 66, background: 'rgba(4,5,12,.55)', backdropFilter: 'blur(2px)' }}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Skill ${skillId}`}
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(600px, 100%)', boxSizing: 'border-box', background: 'rgba(14,17,38,.98)', borderLeft: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', color: C.text, animation: 'atria-sheet-in .2s var(--ease)' }}
      >
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>{body}</div>
        <div style={{ padding: '16px 28px', borderTop: '1px solid rgba(255,255,255,.06)' }}>{footer}</div>
      </aside>
    </div>,
    document.body,
      )}
      {confirm}
    </>
  )
}

const pill = { padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,.05)', color: C.t2, fontSize: 12 } as const
const btn = { height: 44, padding: '0 18px', borderRadius: 12, border: '1px solid rgba(255,255,255,.1)', background: 'transparent', color: C.text, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' } as const
