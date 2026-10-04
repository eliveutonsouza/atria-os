import { useMemo, useState } from 'react'
import type { Overview, RepoInfo } from '@shared/protocol'
import { useApi } from '../../api/useApi'
import { C, toneColor } from '../../lib/colors'
import { useYui } from '../../store/yui'
import { input } from '../../views/kit'
import { ProjectView } from '../../views/ProjectView'
import { Empty, useHeader } from '../../views/ui'
import { Dot, openApp, relTime, useViewParams } from './common'

// Projetos: catálogo do GitHub (clonados ou não) com saúde; o escolhido abre com ações (terminal, Claude, logs, preview).

export function ProjectsPage() {
  const id = useYui((s) => s.appParams.id)
  const repos = useApi<RepoInfo[]>('/api/repos', [], 60000)
  const ov = useApi<Overview>('/api/overview', [], 60000)
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)
  useViewParams(id ? { project: id } : {})
  useHeader('Projetos', 'Seus repositórios', [{ label: all ? 'Só clonados' : 'Todos do GitHub', fn: () => setAll(!all) }], [all])

  const health = new Map((ov.data?.projects ?? []).map((p) => [p.slug, p]))
  const list = useMemo(() => {
    const n = q.trim().toLowerCase()
    const base: { slug: string; name: string; desc: string | null; pushedAt: string | null; cloned: boolean; lang: string | null }[] = (repos.data ?? [])
      .filter((r) => !r.archived)
      .map((r) => ({ slug: r.slug, name: r.nameWithOwner, desc: r.description, pushedAt: r.pushedAt, cloned: r.cloned, lang: r.language }))
    // pastas do workspace que não vêm do GitHub
    for (const p of ov.data?.projects ?? []) if (!base.some((b) => b.slug === p.slug)) base.push({ slug: p.slug, name: p.name, desc: p.note, pushedAt: null, cloned: true, lang: null })
    return base
      .filter((r) => (all || r.cloned) && (!n || `${r.slug} ${r.name} ${r.desc ?? ''}`.toLowerCase().includes(n)))
      .sort((a, b) => Number(b.cloned) - Number(a.cloned) || (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''))
  }, [repos.data, ov.data, q, all])

  const show = useYui.getState().show
  return (
    <div className="app-split" style={{ alignItems: 'flex-start' }}>
      <section style={{ width: id ? 360 : '100%', maxWidth: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input aria-label="Buscar projeto" placeholder={`Buscar entre ${repos.data?.length ?? '…'} repositórios…`} value={q} onChange={(e) => setQ(e.target.value)} style={{ ...input, height: 36 }} />
        {list.length === 0 && <Empty text={repos.data?.length === 0 ? 'Conecte o GitHub em Configurações para ver seus repositórios.' : 'Nenhum projeto encontrado.'} />}
        <div style={{ display: id ? 'flex' : 'grid', flexDirection: 'column', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 8 }}>
          {list.map((r) => {
            const h = health.get(r.slug)
            const on = r.slug === id
            return (
              <button
                key={r.slug}
                onClick={() => openApp('projects', r.slug)}
                className={on ? undefined : 'app-row'}
                style={{
                  display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, textAlign: 'left', cursor: 'pointer', color: C.text,
                  background: on ? 'rgba(103,216,242,.07)' : 'rgba(255,255,255,.025)', border: `1px solid ${on ? 'rgba(103,216,242,.25)' : 'rgba(255,255,255,.06)'}`,
                }}
              >
                {h ? <Dot c={toneColor(h.tone)} /> : <Dot c={C.t3} hollow />}
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.slug}</span>
                  <span style={{ fontSize: 12, color: C.t2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {h?.note ?? r.desc ?? r.name}
                  </span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                  <span style={{ fontSize: 12, color: h ? toneColor(h.tone) : C.t3 }}>{h ? (h.health === null ? h.status : `${h.health}%`) : r.cloned ? 'clonado' : 'no GitHub'}</span>
                  <span className="app-mono" style={{ fontSize: 10.5, color: C.t3 }}>{r.lang ?? ''}{r.pushedAt ? ` · ${relTime(r.pushedAt)}` : ''}</span>
                </span>
              </button>
            )
          })}
        </div>
      </section>
      {id && (
        <section style={{ flex: 1, minWidth: 0, width: '100%', padding: '18px 20px', borderRadius: 18, background: 'linear-gradient(180deg, rgba(20,24,50,.62), rgba(12,14,32,.62))', border: '1px solid rgba(160,170,255,.11)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="app-btn small" onClick={() => show('terminal', { kind: 'claude', project: id })}>Claude no projeto</button>
            <button className="app-btn small" onClick={() => show('terminal', { kind: 'shell', project: id })}>Terminal</button>
            <button className="app-btn small" onClick={() => openApp('infra', id)}>Logs</button>
            <button className="app-btn small" onClick={() => openApp('claude')}>Comandos do Claude</button>
            <button className="app-btn small" onClick={() => show('website', { project: id })}>Preview</button>
          </div>
          <ProjectView />
        </section>
      )}
    </div>
  )
}
