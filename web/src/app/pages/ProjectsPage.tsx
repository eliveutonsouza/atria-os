import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Overview, ProjectSummary, RepoInfo } from '@shared/protocol'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { C, toneColor } from '../../lib/colors'
import { useYui } from '../../store/yui'
import { Field, input } from '../../views/kit'
import { ProjectView } from '../../views/ProjectView'
import { BottomSheet } from '../../views/Sheet'
import { Empty, ErrorNote, Skeleton } from '../../views/ui'
import { Dot, openApp, relTime, useViewParams } from './common'

// Projetos: catálogo do GitHub (clonados ou não) com saúde; o escolhido abre com ações (terminal, Claude, registros, prévia).

export function ProjectsPage() {
  const id = useYui((s) => s.appParams.id)
  const repos = useApi<RepoInfo[]>('/api/repos', [], 60000)
  const ov = useApi<Overview>('/api/overview', [], 60000)
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const device = useYui((s) => s.device)
  const phone = device === 'phone'
  useViewParams(id ? { project: id } : {})
  // no celular com projeto aberto o cabeçalho é do ProjectView (‹ Voltar + ações do projeto)
  useEffect(() => {
    if (id && phone) return
    useYui.getState().setHeader({
      eyebrow: 'Projetos',
      title: 'Seus repositórios',
      actions: [
        { label: '+ Adicionar projeto', fn: () => setAdding(true), primary: true },
        { label: all ? 'Só clonados' : 'Todos do GitHub', fn: () => setAll(!all) },
      ],
    })
  }, [all, id, phone])

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

  const addSheet = adding && (
    <AddProject
      repos={(repos.data ?? []).filter((r) => !r.archived && !r.cloned)}
      onClose={() => setAdding(false)}
      onAdded={(slug) => {
        setAdding(false)
        repos.reload()
        ov.reload()
        openApp('projects', slug)
      }}
    />
  )

  const show = useYui.getState().show
  const actions = id && (
    // celular: botões em grade de 2 colunas
    <div style={phone ? { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 } : { display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button className="app-btn small" onClick={() => show('terminal', { kind: 'claude', project: id })}>Claude no projeto</button>
      <button className="app-btn small" onClick={() => show('terminal', { kind: 'shell', project: id })}>Terminal</button>
      <button className="app-btn small" onClick={() => openApp('infra', id)}>Registros</button>
      <button className="app-btn small" onClick={() => openApp('claude')}>Comandos do Claude</button>
      <button className="app-btn small" onClick={() => show('website', { project: id })}>Prévia</button>
    </div>
  )

  // celular: projeto aberto ocupa a tela toda (sem a lista)
  if (phone && id)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {actions}
        <ProjectView />
      </div>
    )

  return (
    <div className="app-split" style={{ alignItems: 'flex-start' }}>
      {addSheet}
      <section style={{ width: id ? (device === 'tablet' ? 280 : 360) : '100%', maxWidth: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input aria-label="Buscar projeto" placeholder={`Buscar entre ${repos.data?.length ?? '…'} repositórios…`} value={q} onChange={(e) => setQ(e.target.value)} style={{ ...input, height: phone ? 44 : 36 }} />
        {list.length === 0 &&
          (!repos.data && !ov.data ? (
            repos.error && ov.error ? <ErrorNote text="Não consegui carregar os projetos." retry={() => { repos.reload(); ov.reload() }} /> : <Skeleton rows={4} kpis={0} />
          ) : (
            <Empty text={repos.data?.length === 0 ? 'Conecte o GitHub em Configurações para ver seus repositórios.' : 'Nenhum projeto encontrado.'} />
          ))}
        <div style={{ display: id || phone ? 'flex' : 'grid', flexDirection: 'column', gridTemplateColumns: `repeat(auto-fill,minmax(${device === 'tablet' ? 260 : 300}px,1fr))`, gap: 8 }}>
          {list.map((r) => {
            const h = health.get(r.slug)
            const on = r.slug === id
            return (
              <button
                key={r.slug}
                onClick={() => openApp('projects', r.slug)}
                className={on ? undefined : 'app-row'}
                style={{
                  display: 'grid', gridTemplateColumns: phone ? '14px minmax(0,1fr) auto 12px' : '14px minmax(0,1fr) auto', alignItems: 'center', gap: 12, padding: phone ? 14 : '12px 14px', minHeight: 44, borderRadius: phone ? 16 : 14, textAlign: 'left', cursor: 'pointer', color: C.text,
                  background: on ? 'rgba(103,216,242,.07)' : phone ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.025)', border: `1px solid ${on ? 'rgba(103,216,242,.25)' : phone ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.06)'}`,
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
                {phone && <span aria-hidden style={{ fontSize: 22, color: C.t3, lineHeight: 1 }}>›</span>}
              </button>
            )
          })}
        </div>
      </section>
      {id && (
        <section style={{ flex: 1, minWidth: 0, width: '100%', padding: '18px 20px', borderRadius: 18, background: 'linear-gradient(180deg, rgba(20,24,50,.62), rgba(12,14,32,.62))', border: '1px solid rgba(160,170,255,.11)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {actions}
          <ProjectView />
        </section>
      )}
    </div>
  )
}

// Folha (celular) ou diálogo central (tablet/desktop) para formulários curtos.
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
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: '100%', maxHeight: 'calc(var(--vvh) - 32px)', overflowY: 'auto', boxSizing: 'border-box', padding: 22, borderRadius: 18, background: '#10132a', border: '1px solid rgba(160,170,255,.16)', boxShadow: '0 30px 80px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 14, color: C.text }}>
        {head}
        {children}
      </div>
    </div>,
    document.body,
  )
}

// + Adicionar projeto: clona um repositório do catálogo do GitHub ou de uma URL git https.
function AddProject({ repos, onClose, onAdded }: { repos: RepoInfo[]; onClose: () => void; onAdded: (slug: string) => void }) {
  const phone = useYui((s) => s.device === 'phone')
  const [mode, setMode] = useState<'github' | 'url'>(repos.length ? 'github' : 'url')
  const [filter, setFilter] = useState('')
  const [repo, setRepo] = useState('')
  const [url, setUrl] = useState('')
  const [slug, setSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const n = filter.trim().toLowerCase()
  const options = repos.filter((r) => !n || `${r.nameWithOwner} ${r.description ?? ''}`.toLowerCase().includes(n)).slice(0, 200)
  const guess = (() => {
    try {
      return new URL(url.trim()).pathname.replace(/\/+$/, '').split('/').pop()?.replace(/\.git$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') ?? ''
    } catch {
      return ''
    }
  })()

  const submit = async () => {
    setErr(null)
    if (mode === 'github' && !repo) return setErr('Escolha um repositório.')
    if (mode === 'url' && !/^https:\/\//i.test(url.trim())) return setErr('A URL precisa começar com https://')
    if (mode === 'url' && slug && !/^[a-z0-9][a-z0-9-]*$/.test(slug)) return setErr('Nome da pasta: letras minúsculas, números e hífen.')
    setBusy(true)
    try {
      const r = await api.post<{ slug: string; name: string; projects: ProjectSummary[] }>('/api/projects', mode === 'github' ? { repo } : { url: url.trim(), ...(slug ? { slug } : {}) })
      useYui.getState().set({ projects: r.projects })
      useYui.getState().say(`Projeto ${r.name} adicionado.`)
      onAdded(r.slug)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  const seg = (id: 'github' | 'url', label: string) => (
    <button className="app-btn" aria-pressed={mode === id} onClick={() => setMode(id)} style={{ flex: 1, minHeight: phone ? 44 : undefined, ...(mode === id ? { borderColor: 'rgba(103,216,242,.45)', color: '#a9e9f8', background: 'rgba(103,216,242,.08)' } : null) }}>
      {label}
    </button>
  )
  return (
    <FormPanel title="Adicionar projeto" onClose={busy ? () => {} : onClose}>
      <div style={{ display: 'flex', gap: 8 }}>
        {seg('github', 'Do GitHub')}
        {seg('url', 'URL git')}
      </div>
      {mode === 'github' ? (
        <>
          <Field label="Buscar no catálogo">
            <input style={input} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`${repos.length} repositórios ainda não clonados…`} />
          </Field>
          <Field label="Repositório" hint={repos.length ? undefined : 'Todos os repositórios do catálogo já estão no Atria OS. Use “URL git” para outro.'}>
            <select style={{ ...input, height: phone ? 44 : 38 }} value={repo} onChange={(e) => setRepo(e.target.value)}>
              <option value="">Escolha…</option>
              {options.map((r) => (
                <option key={r.nameWithOwner} value={r.nameWithOwner}>{r.nameWithOwner}</option>
              ))}
            </select>
          </Field>
        </>
      ) : (
        <>
          <Field label="URL do repositório" hint="Só https. Repositórios privados do GitHub usam o login do gh do Atria OS.">
            <input style={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/dono/repo.git" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          </Field>
          <Field label="Nome da pasta (opcional)" hint={`Fica em /workspace/${slug || guess || '<nome>'}`}>
            <input style={input} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder={guess || 'meu-projeto'} autoCapitalize="off" spellCheck={false} />
          </Field>
        </>
      )}
      {err && <div role="alert" style={{ fontSize: 13, color: C.crit, overflowWrap: 'anywhere' }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: phone ? 'repeat(2,minmax(0,1fr))' : 'auto auto', justifyContent: phone ? undefined : 'end', gap: 8 }}>
        <button className="app-btn" style={phone ? { height: 50 } : undefined} disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="app-btn primary" style={phone ? { height: 50 } : undefined} disabled={busy} onClick={() => void submit()}>{busy ? 'Clonando…' : 'Clonar e adicionar'}</button>
      </div>
    </FormPanel>
  )
}
