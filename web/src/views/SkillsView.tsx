import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentInfo, HubSkill, InstalledSkill } from '@shared/protocol'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { C } from '../lib/colors'
import { ago } from '../lib/format'
import { useYui } from '../store/yui'
import { card, Empty, ErrorNote, Skeleton, useHeader } from './ui'
import { input, SearchBox, Tabs } from './kit'
import { fmtInstalls, scopeLabel, SkillDrawer } from './SkillDrawer'

// Loja de skills (Main.dc.html / Phone.dc.html): ranking do skills.sh (populares, em alta, hot),
// busca e as já instaladas. Clicar abre a ficha (SkillDrawer) para escolher onde instalar.

type Tab = 'all' | 'trending' | 'hot' | 'installed'
const TABS: Tab[] = ['all', 'trending', 'hot', 'installed']
const LABEL: Record<Tab, string> = { all: 'Populares', trending: 'Em alta 24h', hot: 'Hot', installed: 'Instaladas' }

interface Catalog { skills: HubSkill[]; total: number | null }
interface Installed { skills: InstalledSkill[]; checkedAt: string | null }
type Pick = { source: string; skillId: string; presetAgents?: string[] }

export function useInstalledSkills() {
  return useApi<Installed>('/api/skills/installed')
}

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v)
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms)
    return () => clearTimeout(t)
  }, [v, ms])
  return d
}

function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return null
  const mx = Math.max(...data), mn = Math.min(...data)
  const pts = data.map((v, i) => `${((i * 72) / (data.length - 1)).toFixed(1)},${(22 - ((v - mn) / (mx - mn || 1)) * 20).toFixed(1)}`).join(' ')
  return (
    <svg width="72" height="24" viewBox="0 0 72 24" aria-hidden style={{ flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={C.violet} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

export function SkillsView({ tab: initialTab }: { tab?: string }) {
  const phone = useYui((s) => s.device === 'phone')
  const [tab, setTabState] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'all')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 300)
  const [pick, setPick] = useState<Pick | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (TABS.includes(initialTab as Tab)) setTabState(initialTab as Tab)
  }, [initialTab])
  const setTab = (t: Tab) => {
    setTabState(t)
    const s = useYui.getState()
    if (s.shellMode === 'app' && s.appPage === 'skills') s.set({ appParams: t === 'all' ? {} : { id: t } })
  }

  const view = tab === 'installed' ? 'all' : tab
  const cat = useApi<Catalog>(`/api/skills/catalog?view=${view}`, [view])
  const search = useApi<{ skills: HubSkill[] }>(dq.length >= 2 ? `/api/skills/search?q=${encodeURIComponent(dq)}` : null, [dq])
  const inst = useInstalledSkills()
  const team = useApi<AgentInfo[]>('/api/agents')
  const agents = team.data ?? []
  const installed = useMemo(() => inst.data?.skills ?? [], [inst.data])
  const findInstalled = (s: { source: string; skillId: string }) => installed.find((i) => i.source === s.source && i.skillId === s.skillId) ?? null

  const checkUpdates = async () => {
    setChecking(true)
    await api.post('/api/skills/check-updates').catch(() => null)
    inst.reload()
    setChecking(false)
  }

  useHeader(
    'Ferramentas · skills.sh',
    'Skills',
    [
      { label: 'Instalar por link', fn: () => setLinkOpen(true) },
      { label: checking ? 'Verificando…' : 'Verificar atualizações', fn: () => void checkUpdates(), primary: true },
    ],
    [checking],
  )

  const searching = dq.length >= 2
  const list: HubSkill[] = useMemo(() => {
    if (searching) return search.data?.skills ?? []
    if (tab === 'installed') return installed.map((s) => ({ source: s.source, skillId: s.skillId, name: s.name, installs: 0 }))
    return (cat.data?.skills ?? []).slice(0, 120)
  }, [searching, search.data, tab, installed, cat.data])

  const loading = searching ? search.loading && !search.data : tab === 'installed' ? inst.loading && !inst.data : cat.loading && !cat.data
  const failed = searching ? search.error : tab === 'installed' ? inst.error : cat.error

  const kpis = [
    { l: 'Na plataforma', v: installed.filter((s) => s.scope === 'platform').length, c: C.lav },
    { l: 'Só em agentes', v: installed.filter((s) => s.scope === 'agents').length, c: C.cyan },
    { l: 'Atualização disponível', v: installed.filter((s) => s.updateAvailable).length, c: C.warn },
    { l: 'No skills.sh', v: cat.data?.total ? fmtInstalls(cat.data.total) : '—', c: C.text },
  ]

  const open = (s: HubSkill) => setPick({ source: s.source, skillId: s.skillId })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {!phone && (
        <p style={{ margin: '-6px 0 0', color: C.t2, fontSize: 14, maxWidth: 680 }}>
          Conhecimento pronto para o Claude. Instale na plataforma inteira (Yui e todos os agentes) ou só nos agentes que precisam.
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: phone ? 'repeat(4,minmax(0,1fr))' : 'repeat(auto-fit,minmax(150px,1fr))', gap: phone ? 8 : 14 }}>
        {kpis.map((k) => (
          <div key={k.l} style={phone ? { ...card, padding: '10px 8px', minWidth: 0 } : card}>
            <div style={{ fontSize: phone ? 11 : 12, color: C.t2, marginBottom: phone ? 6 : 8, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{k.l}</div>
            <div style={{ fontSize: phone ? 22 : 40, fontWeight: 300, lineHeight: 1, letterSpacing: '-.02em', color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div className={phone ? 'h-scroll' : undefined} style={phone ? { width: '100%', minWidth: 0 } : undefined}>
          <Tabs value={tab} onChange={(t) => { setQ(''); setTab(t) }} items={TABS.map((id) => ({ id, label: LABEL[id], ...(id === 'installed' ? { count: installed.length } : {}) }))} />
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="Buscar no skills.sh (ex.: react, seo, pdf)…" />
      </div>
      {searching && <div style={{ fontSize: 12, color: C.t3, marginTop: -10 }}>Resultados da busca por “{dq}” no skills.sh</div>}

      {loading ? (
        <Skeleton kpis={0} rows={6} />
      ) : failed ? (
        <ErrorNote text="Não consegui falar com o skills.sh agora." />
      ) : !list.length ? (
        tab === 'installed' && !searching ? (
          <Empty text="Nenhuma skill instalada ainda." hint="Abra “Populares” e clique em + Instalar." />
        ) : (
          <Empty text="Nada encontrado." hint="Tente outra palavra, em inglês costuma achar mais." />
        )
      ) : phone ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {list.map((s, i) => {
            const ins = findInstalled(s)
            return (
              <div key={`${s.source}/${s.skillId}`} style={{ display: 'grid', gridTemplateColumns: '24px minmax(0,1fr) auto', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                <span className="mono" style={{ fontSize: 12, color: C.t3 }}>{tab === 'installed' && !searching ? '' : i + 1}</span>
                <button onClick={() => open(s)} style={{ minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', color: C.text, padding: 0, cursor: 'pointer', fontFamily: 'inherit', minHeight: 44 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.skillId}</div>
                  <div style={{ fontSize: 12, color: C.t3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.source}
                    {s.installs ? ` · ${fmtInstalls(s.installs)}` : ''}
                  </div>
                </button>
                {ins ? (
                  <button onClick={() => open(s)} style={{ ...installedPill, border: 'none', cursor: 'pointer' }}>
                    {ins.updateAvailable ? '↻ ' : '✓ '}
                    {scopeLabel(ins, agents)}
                  </button>
                ) : (
                  <button aria-label={`Instalar ${s.skillId}`} onClick={() => open(s)} style={{ width: 44, height: 44, borderRadius: 12, border: 'none', background: 'rgba(166,140,247,.16)', color: C.lav, fontSize: 20, cursor: 'pointer' }}>
                    +
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px,100%), 1fr))', gap: 14 }}>
          {list.map((s, i) => {
            const ins = findInstalled(s)
            const desc = ins?.description
            return (
              <article key={`${s.source}/${s.skillId}`} style={{ ...card, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {!(tab === 'installed' && !searching) && <span className="mono" style={{ fontSize: 12, color: C.t3 }}>#{i + 1}</span>}
                      <button onClick={() => open(s)} className="hov-txt" style={{ background: 'transparent', border: 'none', padding: 0, color: C.text, fontSize: 16, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        {s.skillId}
                      </button>
                      {s.official && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999, background: 'rgba(103,216,242,.12)', color: C.cyan }}>oficial</span>}
                    </div>
                    <div className="mono" style={{ fontSize: 12, color: C.t2, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.source}</div>
                  </div>
                  {s.weekly && <Spark data={s.weekly} />}
                  {s.change !== undefined && <span style={{ fontSize: 12, color: C.ok, whiteSpace: 'nowrap' }}>+{fmtInstalls(s.change)} hoje</span>}
                </div>
                {desc && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: C.t2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{desc}</p>}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto' }}>
                  <span style={{ fontSize: 12, color: C.t3 }}>{s.installs ? `${fmtInstalls(s.installs)} instalações` : ins ? `instalada ${ago(ins.updatedAt ?? ins.installedAt)}` : ''}</span>
                  {ins ? (
                    <button onClick={() => open(s)} style={{ ...installedPill, border: 'none', cursor: 'pointer', ...(ins.updateAvailable ? { color: C.warn, background: 'rgba(245,181,74,.10)' } : {}) }}>
                      {ins.updateAvailable ? '↻ atualizar · ' : '✓ '}
                      {scopeLabel(ins, agents)}
                    </button>
                  ) : (
                    <button onClick={() => open(s)} style={{ height: 34, padding: '0 14px', borderRadius: 10, border: 'none', background: 'rgba(166,140,247,.16)', color: C.lav, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      + Instalar
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
      <p style={{ margin: 0, fontSize: 12, color: C.t3 }}>
        Dados do skills.sh · cada skill vem do repositório GitHub do autor.
        {inst.data?.checkedAt ? ` Atualizações verificadas ${ago(inst.data.checkedAt)}.` : ''}
      </p>

      {pick && (
        <SkillDrawer
          source={pick.source}
          skillId={pick.skillId}
          installed={findInstalled(pick)}
          presetAgents={pick.presetAgents}
          onClose={() => setPick(null)}
          onChanged={() => inst.reload()}
        />
      )}
      {linkOpen && <LinkModal onClose={() => setLinkOpen(false)} onPick={(p) => { setLinkOpen(false); setPick(p) }} />}
    </div>
  )
}

const installedPill = { fontSize: 12, padding: '6px 10px', borderRadius: 999, background: 'rgba(79,224,176,.10)', color: C.ok, fontFamily: 'inherit', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const

// Colar URL do skills.sh/GitHub ou o comando `npx skills add …` e abrir a ficha.
function LinkModal({ onClose, onPick }: { onClose: () => void; onPick: (p: Pick) => void }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const go = async () => {
    setErr(null)
    try {
      onPick(await api.post<Pick>('/api/skills/resolve', { text }))
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(4,5,10,.66)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Instalar por link"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void go()
        }}
        style={{ width: 'min(520px,100%)', padding: 22, borderRadius: 18, background: 'linear-gradient(180deg,#14173a,#0e1022)', border: '1px solid rgba(255,255,255,.1)', display: 'flex', flexDirection: 'column', gap: 12, color: C.text }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>Instalar por link</div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: C.t2 }}>Cole a URL do skills.sh ou o comando de instalação</span>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="https://skills.sh/mattpocock/skills/tdd" style={input} />
        </label>
        <span style={{ fontSize: 12, color: C.t3 }}>Também aceita “npx skills add https://github.com/dono/repo --skill nome”.</span>
        {err && <div role="alert" style={{ fontSize: 13, color: '#f39aa4' }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ height: 42, padding: '0 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: C.text, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancelar
          </button>
          <button type="submit" disabled={!text.trim()} style={{ height: 42, padding: '0 16px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#67d8f2,#a68cf7)', color: '#06070d', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: text.trim() ? 1 : 0.5 }}>
            Ver skill
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
