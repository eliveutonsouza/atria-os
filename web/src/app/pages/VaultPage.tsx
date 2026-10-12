import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import type { VaultBacklink, VaultEditorState, VaultFile, VaultStatus, VaultSuggestion, VaultTreeEntry } from '@shared/protocol'
import { api } from '../../api/client'
import { onVaultChanged } from '../../api/events'
import { C } from '../../lib/colors'
import { toastErr, useAction, useUnsavedGuard } from '../../lib/feedback'
import { useYui } from '../../store/yui'
import { ActionSheet, type SheetAction } from '../../views/Sheet'
import { ConfirmDeleteModal, ErrorNote, useHeader } from '../../views/ui'
import { outgoing, renderNote, splitFrontmatter } from '../../vault/markdown'
import { ContextMenu, PathPrompt } from '../../vault/VaultDialogs'
import '../../vault/vault.css'

// Vault (Vault.dc.html): árvore de arquivos, VS Code (openvscode-server em /code) e leitura,
// com painel de conexões. No celular não há VS Code: leitura + edição simples.

type Mode = 'edit' | 'split' | 'read'

const GALAXY: Record<string, string> = {
  '00-Inbox': '#8c92ad',
  '01-Projeto': '#67d8f2',
  '02-Decisoes': '#f5b54a',
  '03-Agentes': '#a68cf7',
  '04-Execucoes': '#4fe0b0',
  '05-Projetos': '#cbbcff',
  '06-Ideias': '#f78cc8',
  Diario: '#dfe3f3',
  Empresa: '#7aa2ff',
}
const galaxyColor = (path: string) => GALAXY[path.split('/')[0]] ?? '#8c92ad'
const DEFAULT_NOTE = '00-Inbox/Bem-vindo ao vault.md'
// trecho sem a sintaxe de link ([[nota|alias]] → alias)
const plain = (s: string) => s.replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, a: string, al?: string) => al ?? a)
const noteName = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '')
const store = {
  get: (k: string) => {
    try {
      // reserva: chaves yui.* de antes do Atria OS
      return localStorage.getItem(k) ?? localStorage.getItem(k.replace(/^atria\./, 'yui.'))
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* ignora */
    }
  },
}

function useTree() {
  const [tree, setTree] = useState<VaultTreeEntry[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading')
  const load = useCallback(() => {
    api.get<VaultTreeEntry[]>('/api/vault/tree').then((t) => {
      setTree(t)
      setState('ok')
    }).catch(() => setState((s) => (s === 'ok' ? s : 'err'))) // falha num recarregamento mantém a árvore que já estava
  }, [])
  useEffect(() => {
    load()
    return onVaultChanged(() => load())
  }, [load])
  const retry = useCallback(() => {
    setState('loading')
    load()
  }, [load])
  return { tree, treeState: state, reload: load, retry }
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Resolve [[nome]] como o Obsidian: caminho exato → nome do arquivo (caminho mais curto ganha).
function makeResolver(tree: VaultTreeEntry[]) {
  const files = tree.filter((t) => !t.dir && t.path.endsWith('.md'))
  const byPath = new Map(files.map((f) => [f.path.toLowerCase(), f.path]))
  const byName = new Map<string, string[]>()
  for (const f of files) {
    const n = noteName(f.path).toLowerCase()
    byName.set(n, [...(byName.get(n) ?? []), f.path])
  }
  for (const l of byName.values()) l.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
  return (target: string): string | null => {
    const t = target.replace(/^\.?\//, '').toLowerCase()
    return byPath.get(t) ?? byPath.get(`${t}.md`) ?? byName.get(noteName(t))?.[0] ?? null
  }
}

const iconBtn: CSSProperties = { width: 'var(--vault-ib, 28px)', height: 'var(--vault-ib, 28px)', borderRadius: 8, border: '1px solid rgba(255,255,255,.08)', background: 'transparent', color: C.t2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }
const label: CSSProperties = { fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600 }

const within = (p: string, base: string) => p === base || p.startsWith(`${base}/`)

function Explorer({ tree, treeState, onRetry, selected, onPick, onCreate, onNewFolder, onMenu, narrow }: {
  tree: VaultTreeEntry[]
  treeState: 'loading' | 'ok' | 'err'
  onRetry: () => void
  selected: string
  onPick: (p: string) => void
  onCreate: (folder: string) => void
  onNewFolder: () => void
  onMenu: (t: VaultTreeEntry, x: number, y: number) => void
  narrow: boolean
}) {
  // menu de contexto: botão direito no mouse, toque longo no celular/tablet
  const press = useRef<{ timer?: number; fired: boolean }>({ fired: false })
  const endPress = () => window.clearTimeout(press.current.timer)
  const startPress = (e: RPointerEvent, t: VaultTreeEntry) => {
    press.current.fired = false
    if (e.pointerType !== 'touch') return
    const { clientX, clientY } = e
    press.current.timer = window.setTimeout(() => {
      press.current.fired = true
      onMenu(t, clientX, clientY)
    }, 550)
  }
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(store.get('atria.vault.open') ?? '["01-Projeto","00-Inbox"]') as string[])
    } catch {
      return new Set(['01-Projeto', '00-Inbox'])
    }
  })
  const [q, setQ] = useState('')
  const toggle = (p: string) => {
    const n = new Set(open)
    if (n.has(p)) n.delete(p)
    else n.add(p)
    setOpen(n)
    store.set('atria.vault.open', JSON.stringify([...n]))
  }
  // garante a pasta da nota selecionada aberta
  useEffect(() => {
    const parts = selected.split('/').slice(0, -1)
    if (!parts.length) return
    setOpen((cur) => {
      const n = new Set(cur)
      parts.forEach((_, i) => n.add(parts.slice(0, i + 1).join('/')))
      return n.size === cur.size ? cur : n
    })
  }, [selected])
  const needle = q.trim().toLowerCase()
  const rows = useMemo(() => {
    if (needle) return tree.filter((t) => !t.dir && t.path.toLowerCase().includes(needle))
    return tree.filter((t) => {
      const parts = t.path.split('/')
      for (let i = 1; i < parts.length; i++) if (!open.has(parts.slice(0, i).join('/'))) return false
      return true
    })
  }, [tree, open, needle])
  const notes = tree.filter((t) => !t.dir && t.path.endsWith('.md')).length
  return (
    <aside aria-label="Arquivos do vault" className="vault-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 12px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: 10, color: C.t2, display: 'flex' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          </span>
          <span className="sr-only">Buscar arquivos</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar notas…" className="vault-input" style={{ paddingLeft: 30 }} />
        </label>
        <div style={{ ...label, color: C.t2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>Arquivos</span>
          <button aria-label="Nova pasta" title="Nova pasta" style={{ ...iconBtn, marginRight: 6 }} onClick={onNewFolder}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h7l2 2h9v10H3zM12 12v5M9.5 14.5h5" /></svg>
          </button>
          <button aria-label="Nova nota" title="Nova nota" style={iconBtn} onClick={() => onCreate(selected.includes('/') ? selected.split('/').slice(0, -1).join('/') : '00-Inbox')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>
      </div>
      <div className="app-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {rows.map((t) => {
          const on = t.path === selected
          const hidden = t.path.startsWith('.') || t.path.startsWith('_')
          const color = galaxyColor(t.path)
          return (
            <button
              key={t.path}
              onClick={() => {
                if (press.current.fired) {
                  press.current.fired = false
                  return
                }
                if (t.dir) toggle(t.path)
                else onPick(t.path)
              }}
              onPointerDown={(e) => startPress(e, t)}
              onPointerUp={endPress}
              onPointerLeave={endPress}
              onPointerCancel={endPress}
              onContextMenu={(e) => {
                e.preventDefault()
                endPress()
                if (press.current.fired && (e.nativeEvent as PointerEvent).pointerType !== 'mouse') return // toque longo já abriu
                press.current.fired = true
                onMenu(t, e.clientX, e.clientY)
              }}
              className="vault-row"
              title={t.path}
              aria-expanded={t.dir ? open.has(t.path) : undefined}
              style={{
                paddingLeft: 6 + (needle ? 0 : t.depth) * 16,
                border: `1px solid ${on ? 'rgba(103,216,242,.25)' : 'transparent'}`,
                background: on ? 'rgba(103,216,242,.09)' : 'transparent',
                color: on ? '#fff' : hidden ? C.t3 : t.dir ? '#dfe3f3' : '#b4b9cf',
                minHeight: narrow ? 42 : 27,
                WebkitTouchCallout: 'none',
              }}
            >
              <span style={{ width: 12, display: 'flex', color: C.t2, transform: `rotate(${open.has(t.path) ? 90 : 0}deg)`, opacity: t.dir ? 1 : 0, transition: 'transform .15s' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
              </span>
              <span style={{ display: 'flex', color: t.dir ? (hidden ? C.t4 : color) : on ? C.cyan : C.t3 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={t.dir ? 'M3 7h7l2 2h9v10H3z' : 'M6 3h8l4 4v14H6zM14 3v4h4'} /></svg>
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{needle ? t.path.replace(/\.md$/, '') : t.dir ? t.name : t.name.replace(/\.md$/, '')}</span>
              {t.dir && !!t.count && <span className="app-mono" style={{ fontSize: 10, color: C.t3 }}>{t.count}</span>}
            </button>
          )
        })}
        {treeState === 'err' && !tree.length ? (
          <ErrorNote text="Não consegui carregar os arquivos do vault." retry={onRetry} />
        ) : treeState === 'loading' && !tree.length ? (
          <div style={{ padding: 12, fontSize: 12.5, color: C.t3 }}>Carregando…</div>
        ) : (
          !rows.length && <div style={{ padding: 12, fontSize: 12.5, color: C.t3 }}>{needle ? 'Nada encontrado.' : 'Vault vazio.'}</div>
        )}
      </div>
      <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,.06)', fontSize: 11.5, color: C.t2 }}>
        {notes} notas{narrow ? ' · toque longo para mais ações' : ''}
      </div>
    </aside>
  )
}

function Reader({ file, resolve, onOpen }: { file: VaultFile | null; resolve: (t: string) => string | null; onOpen: (p: string) => void }) {
  const { props, body } = useMemo(() => splitFrontmatter(file?.text ?? ''), [file?.text])
  const html = useMemo(() => renderNote(body), [body])
  const ref = useRef<HTMLDivElement>(null)
  // blocos ```mermaid viram diagrama
  useEffect(() => {
    const boxes = ref.current?.querySelectorAll<HTMLDivElement>('div.vmermaid') ?? []
    if (!boxes.length) return
    let alive = true
    void import('../../lib/mermaid').then(({ renderMermaid }) => {
      boxes.forEach((el) => {
        renderMermaid(el.dataset.code ?? '')
          .then((svg) => {
            if (alive) el.innerHTML = svg
          })
          .catch((e: Error) => {
            if (alive) el.textContent = `Diagrama inválido: ${e.message.split('\n')[0]}`
          })
      })
    })
    return () => {
      alive = false
    }
  }, [html])
  // links para notas que ainda não existem aparecem apagados
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLAnchorElement>('a.vlink').forEach((a) => {
      a.classList.toggle('missing', !resolve(a.dataset.note ?? ''))
    })
  }, [html, resolve])
  if (!file) return <div style={{ padding: 30, color: C.t3 }}>Escolha uma nota.</div>
  return (
    <article
      className="vault-read app-scroll"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (!a) return
        if (a.dataset.note !== undefined) {
          e.preventDefault()
          const p = resolve(a.dataset.note)
          if (p) onOpen(p)
          return
        }
        if (a.getAttribute('href')?.startsWith('http')) {
          e.preventDefault()
          window.open(a.href, '_blank', 'noopener')
        }
      }}
    >
      {!!props.length && (
        <div className="vault-props">
          {props.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <span style={{ color: C.t2 }}>{k}</span>
              <span style={{ color: k === 'tags' ? '#f9a8d6' : k === 'status' ? '#f5c97a' : '#dfe3f3', overflowWrap: 'anywhere' }}>
                {k === 'tags' ? v.split(/[,\s]+/).filter(Boolean).map((t) => `#${t.replace(/^#/, '')}`).join('  ') : v}
              </span>
            </div>
          ))}
        </div>
      )}
      <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  )
}

function MiniGraph({ center, links, backs }: { center: string; links: string[]; backs: string[] }) {
  const all = [...new Set([...links, ...backs])].slice(0, 12)
  const still = reducedMotion()
  const W = 254, H = 150, cx = W / 2, cy = H / 2
  return (
    <div aria-hidden className="vault-mini">
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="vault-core" cx="38%" cy="34%">
            <stop offset="0" stopColor="#fff" />
            <stop offset=".45" stopColor={galaxyColor(center)} />
            <stop offset="1" stopColor="#a68cf7" />
          </radialGradient>
        </defs>
        {all.map((p, i) => {
          const a = (i / Math.max(all.length, 1)) * Math.PI * 2 - Math.PI / 2
          const x = cx + Math.cos(a) * 96, y = cy + Math.sin(a) * 54
          const c = galaxyColor(p)
          const back = backs.includes(p) && !links.includes(p)
          return (
            <g key={p}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={back ? 'rgba(166,140,247,.6)' : 'rgba(103,216,242,.55)'} strokeWidth="1" />
              {!still && (
                <circle r="1.8" fill="#fff">
                  <animateMotion dur={`${2 + (i % 3) * 0.6}s`} repeatCount="indefinite" path={back ? `M${x},${y} L${cx},${cy}` : `M${cx},${cy} L${x},${y}`} />
                </circle>
              )}
              <circle cx={x} cy={y} r="4.5" fill={c} style={{ filter: `drop-shadow(0 0 5px ${c})` }} />
            </g>
          )
        })}
        <ellipse cx={cx} cy={cy} rx="22" ry="8" fill="none" stroke="rgba(103,216,242,.55)" transform={`rotate(-16 ${cx} ${cy})`} />
        <circle cx={cx} cy={cy} r="8" fill="url(#vault-core)" style={{ filter: 'drop-shadow(0 0 8px rgba(103,216,242,.8))' }} />
      </svg>
    </div>
  )
}

function Connections({ path, text, resolve, onOpen, status, onCommit, committing }: { path: string; text: string; resolve: (t: string) => string | null; onOpen: (p: string) => void; status: VaultStatus | null; onCommit: () => void; committing: boolean }) {
  const [backs, setBacks] = useState<VaultBacklink[]>([])
  const [sugs, setSugs] = useState<VaultSuggestion[]>([])
  const load = useCallback(() => {
    const q = encodeURIComponent(path)
    api.get<VaultBacklink[]>(`/api/vault/backlinks?path=${q}`).then(setBacks).catch(() => setBacks([]))
    api.get<VaultSuggestion[]>(`/api/vault/suggest?path=${q}`).then(setSugs).catch(() => setSugs([]))
  }, [path])
  useEffect(() => {
    load()
    return onVaultChanged(() => load())
  }, [load])
  const outs = outgoing(text).map((t) => ({ t, p: resolve(t) }))
  const tags = [...new Set([...text.matchAll(/(?:^|\s)#([A-Za-zÀ-ú][\wÀ-ú/-]*)/g)].map((m) => m[1]))].slice(0, 10)
  const link = (to: string) => api.post('/api/vault/link', { from: path, to }).then(load).catch((e: unknown) => toastErr(e, 'Não consegui ligar as notas'))
  return (
    <aside aria-label="Conexões da nota" className="vault-card app-scroll" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Conexões</span>
        <button className="vault-link-btn" onClick={() => useYui.getState().set({ appPage: 'brain', appParams: { id: path } })}>Ver no Cérebro →</button>
      </div>
      <MiniGraph center={path} links={outs.map((o) => o.p).filter((p): p is string => !!p)} backs={backs.map((b) => b.path)} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ ...label, color: C.violet }}>Citada por · {backs.length}</span>
        {backs.map((b) => (
          <button key={b.path} className="vault-conn" onClick={() => onOpen(b.path)}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#dfe3f3' }}>{b.title}</span>
            <span style={{ fontSize: 11.5, color: C.t2, lineHeight: 1.45 }}>{plain(b.snippet)}</span>
          </button>
        ))}
        {!backs.length && <span style={{ fontSize: 12, color: C.t3 }}>Nenhuma nota cita esta ainda.</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ ...label, color: C.cyan }}>Links · {outs.length}</span>
        {outs.map((o) => (
          <button key={o.t} className="vault-conn row" disabled={!o.p} onClick={() => o.p && onOpen(o.p)} title={o.p ? o.p : 'Nota ainda não existe'}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: o.p ? galaxyColor(o.p) : 'transparent', border: o.p ? 'none' : `1px dashed ${C.t3}`, flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: o.p ? '#dfe3f3' : C.t3, textAlign: 'left' }}>{o.t}</span>
          </button>
        ))}
      </div>
      {!!sugs.length && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...label, color: C.warn }}>Yui sugere ligar</span>
          {sugs.map((s) => (
            <div key={s.id} className="vault-sug" title={s.reason}>
              <button className="vault-sug-name" onClick={() => onOpen(s.id)}>{s.title}</button>
              <button className="vault-sug-btn" onClick={() => link(s.id)}>Ligar</button>
            </div>
          ))}
        </div>
      )}
      {!!tags.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tags.map((t) => (
            <span key={t} className="vtag">#{t}</span>
          ))}
        </div>
      )}
      {status && (
        <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, color: C.t2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 28 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: status.pending ? C.warn : C.ok, flexShrink: 0 }} />
            <span>{status.pending ? `Histórico de versões · ${status.pending} ${status.pending === 1 ? 'alteração' : 'alterações'} a salvar` : 'Histórico de versões · tudo salvo'}</span>
            {!!status.pending && (
              <button className="app-btn small" style={{ marginLeft: 'auto' }} disabled={committing} onClick={onCommit}>
                {committing ? 'Salvando…' : 'Salvar versão'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.cyan, flexShrink: 0 }} />
            {status.notes} notas · {status.links} links
          </div>
        </div>
      )}
    </aside>
  )
}

function MobileEditor({ file, onSaved, onDirty }: { file: VaultFile; onSaved: () => void; onDirty: (dirty: boolean) => void }) {
  const [text, setText] = useState(file.text)
  const dirty = text !== file.text
  useEffect(() => onDirty(dirty), [dirty, onDirty])
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const save = () => {
    setSaving(true)
    api
      .put<{ mtime: number }>('/api/vault/file', { path: file.path, text, baseMtime: file.mtime })
      .then(() => {
        setErr(null)
        onSaved()
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setSaving(false))
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="sr-only" htmlFor="vault-edit">Texto da nota</label>
      <textarea id="vault-edit" value={text} onChange={(e) => setText(e.target.value)} className="vault-textarea app-mono" spellCheck={false} />
      {err && <div style={{ color: C.crit, fontSize: 13 }}>{err}</div>}
      <button className="app-btn primary" style={{ height: 46 }} disabled={saving} onClick={save}>
        {saving ? 'Salvando…' : 'Salvar'}
      </button>
    </div>
  )
}

export function VaultPage() {
  const narrow = useYui((s) => s.narrow)
  const coarse = useYui((s) => s.coarse)
  const tablet = useYui((s) => s.device === 'tablet')
  const [ctxOpen, setCtxOpen] = useState(false)
  const [initial] = useState(() => useYui.getState().appParams.id)
  const [selected, setSelected] = useState<string>(() => initial || store.get('atria.vault.note') || DEFAULT_NOTE)
  const [mode, setMode] = useState<Mode>(() => (store.get('atria.vault.mode') as Mode) || 'edit')
  const [file, setFile] = useState<VaultFile | null>(null)
  const [fileErr, setFileErr] = useState<string | null>(null)
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'note'>(initial ? 'note' : 'list')
  const [mobileEdit, setMobileEdit] = useState(false)
  const [mobileDirty, setMobileDirty] = useState(false)
  const confirmLeave = useUnsavedGuard(mobileEdit && mobileDirty, 'as mudanças da nota')
  const leaveEditor = async (go: () => void) => {
    if (mobileEdit && !(await confirmLeave())) return
    setMobileDirty(false)
    go()
  }
  const [creating, setCreating] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [menu, setMenu] = useState<{ t: VaultTreeEntry; x: number; y: number } | null>(null)
  const [prompt, setPrompt] = useState<{ kind: 'move' | 'folder'; path: string; dir: boolean } | null>(null)
  const [del, setDel] = useState<{ path: string; dir: boolean; count: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const { tree, treeState, reload, retry } = useTree()
  const resolve = useMemo(() => makeResolver(tree), [tree])
  const lastEditorAt = useRef(Date.now())
  const showEditor = !narrow && mode !== 'read'

  // ações da nota aberta (no celular, só quando a nota está na tela; vão para o ⋯)
  const noteActions = file && (!narrow || mobileView === 'note')
  useHeader('Conhecimento · notas', 'Vault', [
    { label: 'Ver no Cérebro', fn: () => useYui.getState().set({ appPage: 'brain', appParams: {} }) },
    ...(noteActions
      ? [
          { label: 'Renomear ou mover', fn: () => setPrompt({ kind: 'move', path: selected, dir: false }) },
          { label: 'Excluir nota', danger: true, fn: () => setDel({ path: selected, dir: false, count: 1 }) },
        ]
      : []),
    { label: '+ Nova nota', primary: true, fn: () => setCreating((selected.includes('/') ? selected.split('/').slice(0, -1).join('/') : '') || '00-Inbox') },
  ], [selected, noteActions])

  const loadFile = useCallback(() => {
    api
      .get<VaultFile>(`/api/vault/file?path=${encodeURIComponent(selected)}`)
      .then((f) => {
        setFile(f)
        setFileErr(null)
      })
      .catch((e: Error) => {
        setFile(null)
        setFileErr(e.message === 'não encontrado' ? 'Essa nota não existe mais.' : e.message)
      })
  }, [selected])
  useEffect(() => {
    loadFile()
    store.set('atria.vault.note', selected)
    return onVaultChanged((paths) => {
      if (!paths.length || paths.includes(selected)) loadFile()
    })
  }, [loadFile, selected])

  const loadStatus = useCallback(() => {
    api.get<VaultStatus>('/api/vault/status').then(setStatus).catch(() => {})
  }, [])
  useEffect(() => {
    loadStatus()
    return onVaultChanged(() => loadStatus())
  }, [loadStatus])

  // escolher nota no Atria OS → VS Code abre a mesma nota
  const pick = useCallback(
    (p: string, line?: number) => {
      setSelected(p)
      setMobileView('note')
      setMobileEdit(false)
      setCtxOpen(false)
      if (!narrow) api.post('/api/vault/open', { path: p, line }).catch(() => {})
    },
    [narrow],
  )
  // ao abrir a página, o editor vai para a nota selecionada
  useEffect(() => {
    if (!narrow) api.post('/api/vault/open', { path: selected }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // VS Code → painel: segue o arquivo ativo do editor
  useEffect(() => {
    if (!showEditor) return
    const t = setInterval(() => {
      if (document.hidden) return
      api
        .get<VaultEditorState>('/api/vault/editor-state')
        .then((st) => {
          if (st.at > lastEditorAt.current && st.path && st.path.endsWith('.md')) {
            lastEditorAt.current = st.at
            const p = st.path
            setSelected((cur) => (cur === p ? cur : p))
          }
        })
        .catch(() => {})
    }, 2000)
    return () => clearInterval(t)
  }, [showEditor])

  useEffect(() => {
    if (!ctxOpen) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setCtxOpen(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [ctxOpen])

  const setM = (m: Mode) => {
    setMode(m)
    store.set('atria.vault.mode', m)
  }

  const create = () => {
    const name = newName.trim().replace(/[\\/:*?"<>|]+/g, ' ')
    if (!name || !creating || createBusy) return
    setCreateBusy(true)
    setCreateErr(null)
    api
      .post<{ path: string }>('/api/vault/file', { path: `${creating}/${name}`, text: `# ${name}\n\n` })
      .then((r) => {
        setCreating(null)
        setNewName('')
        reload()
        pick(r.path)
      })
      .catch((e: Error) => setCreateErr(e.message === 'já existe' ? 'Já existe uma nota com esse nome.' : e.message))
      .finally(() => setCreateBusy(false))
  }

  const { run: commit, busy: committing } = useAction(
    async () => setStatus(await api.post<VaultStatus>('/api/vault/commit')),
    { ok: 'Versão salva no histórico.', error: 'Não consegui salvar a versão' },
  )
  const folders = tree.filter((t) => t.dir && !t.path.startsWith('.'))

  // ---------- renomear/mover, pastas e exclusão ----------
  const say = (t: string) => useYui.getState().say(t)
  const move = async (from: string, dir: boolean, to: string) => {
    let dest = to
    if (!dir && /\.md$/i.test(from) && !/\.[a-z0-9]+$/i.test(dest)) dest += '.md'
    if (dest === from) return setPrompt(null)
    if (dir && within(dest, from)) throw new Error('Não dá para mover uma pasta para dentro dela mesma.')
    const r = await api.post<{ path: string }>('/api/vault/move', { from, to: dest })
    setPrompt(null)
    reload()
    if (within(selected, from)) setSelected(r.path + selected.slice(from.length))
  }
  const newFolder = async (path: string) => {
    await api.post('/api/vault/folder', { path })
    setPrompt(null)
    reload()
  }
  const remove = () => {
    if (!del) return
    setBusy(true)
    const q = encodeURIComponent(del.path)
    api
      .del(del.dir ? `/api/vault/folder?path=${q}` : `/api/vault/file?path=${q}`)
      .then(() => {
        if (within(selected, del.path)) {
          const next = tree.find((t) => !t.dir && t.path.endsWith('.md') && !within(t.path, del.path))?.path ?? DEFAULT_NOTE
          setSelected(next)
          setMobileView('list')
        }
        setDel(null)
        reload()
      })
      .catch((e: Error) => say(`Não consegui excluir: ${e.message}`))
      .finally(() => setBusy(false))
  }
  const entryActions = (t: VaultTreeEntry): SheetAction[] =>
    t.dir
      ? [
          { label: 'Nova nota aqui', fn: () => setCreating(t.path) },
          { label: 'Nova subpasta', fn: () => setPrompt({ kind: 'folder', path: `${t.path}/`, dir: true }) },
          { label: 'Renomear ou mover pasta', fn: () => setPrompt({ kind: 'move', path: t.path, dir: true }) },
          { label: 'Excluir pasta', danger: true, fn: () => setDel({ path: t.path, dir: true, count: t.count ?? 0 }) },
        ]
      : [
          { label: 'Abrir', fn: () => pick(t.path) },
          { label: 'Renomear ou mover', fn: () => setPrompt({ kind: 'move', path: t.path, dir: false }) },
          { label: 'Excluir nota', danger: true, fn: () => setDel({ path: t.path, dir: false, count: 1 }) },
        ]
  const openMenu = (t: VaultTreeEntry, x: number, y: number) => setMenu({ t, x, y })
  const openNewFolder = () => setPrompt({ kind: 'folder', path: '', dir: true })

  const overlays = (
    <>
      {menu &&
        (coarse || narrow ? (
          <ActionSheet title={menu.t.path} actions={entryActions(menu.t)} onClose={() => setMenu(null)} />
        ) : (
          <ContextMenu x={menu.x} y={menu.y} title={menu.t.path} actions={entryActions(menu.t)} onClose={() => setMenu(null)} />
        ))}
      {prompt?.kind === 'move' && (
        <PathPrompt
          title={prompt.dir ? 'Renomear ou mover pasta' : 'Renomear ou mover nota'}
          hint="Mude o nome ou o caminho (pasta/subpasta/nome). Links [[…]] de outras notas não são atualizados."
          label="Caminho no vault"
          initial={prompt.dir ? prompt.path : prompt.path.replace(/\.md$/i, '')}
          confirm="Salvar"
          onCancel={() => setPrompt(null)}
          onSubmit={(v) => move(prompt.path, prompt.dir, v)}
        />
      )}
      {prompt?.kind === 'folder' && (
        <PathPrompt
          title="Nova pasta"
          hint="Use / para criar dentro de outra pasta (ex.: 06-Ideias/Produtos)."
          label="Caminho da pasta"
          initial={prompt.path}
          confirm="Criar pasta"
          onCancel={() => setPrompt(null)}
          onSubmit={newFolder}
        />
      )}
      {del && (
        <ConfirmDeleteModal
          title={del.dir ? 'Excluir pasta?' : 'Excluir nota?'}
          text={
            del.dir
              ? 'A pasta e tudo dentro dela saem do vault e vão para a lixeira (.trash). Links para essas notas ficam quebrados.'
              : 'A nota sai do vault e vai para a lixeira (.trash). Links para ela ficam quebrados.'
          }
          rows={[
            { label: del.dir ? 'Pasta' : 'Nota', value: del.path.replace(/\.md$/i, '') },
            ...(del.dir ? [{ label: 'Notas dentro', value: String(del.count) }] : []),
          ]}
          busy={busy}
          undoable
          onCancel={() => setDel(null)}
          onConfirm={remove}
        />
      )}
    </>
  )

  const createBox = creating && (
    <div className="vault-card" style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12.5, color: C.t2 }}>Nova nota em</span>
      <select value={creating} onChange={(e) => setCreating(e.target.value)} className="vault-input" style={{ width: 'auto' }} aria-label="Pasta">
        {folders.map((t) => (
          <option key={t.path} value={t.path}>{t.path}</option>
        ))}
      </select>
      <input
        autoFocus
        value={newName}
        onChange={(e) => {
          setNewName(e.target.value)
          setCreateErr(null)
        }}
        onKeyDown={(e) => e.key === 'Enter' && create()}
        placeholder="Título da nota"
        className="vault-input"
        style={{ flex: 1, minWidth: 160 }}
        aria-label="Título da nota"
        aria-invalid={!!createErr}
        aria-describedby={createErr ? 'vault-create-err' : undefined}
      />
      <button className="app-btn primary" disabled={!newName.trim() || createBusy} onClick={create}>{createBusy ? 'Criando…' : 'Criar'}</button>
      <button
        className="app-btn"
        onClick={() => {
          setCreating(null)
          setCreateErr(null)
        }}
      >
        Cancelar
      </button>
      {createErr && <div id="vault-create-err" role="alert" style={{ flexBasis: '100%', color: C.critSoft, fontSize: 12.5 }}>{createErr}</div>}
    </div>
  )

  // ---------- celular: lista → leitura (com edição simples) ----------
  if (narrow) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {createBox}
        {overlays}
        {mobileView === 'list' ? (
          <div style={{ height: 'calc(var(--vvh) - var(--tabbar) - 190px)', minHeight: 280, display: 'flex' }}>
            <Explorer tree={tree} treeState={treeState} onRetry={retry} selected={selected} onPick={pick} onCreate={setCreating} onNewFolder={openNewFolder} onMenu={openMenu} narrow />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="app-btn" style={{ height: 44 }} onClick={() => leaveEditor(() => {
                setMobileEdit(false)
                setMobileView('list')
              })}>← Arquivos</button>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.t2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.split('/').slice(0, -1).join(' › ')}</span>
              <button className="app-btn" style={{ height: 44 }} onClick={() => (mobileEdit ? leaveEditor(() => setMobileEdit(false)) : setMobileEdit(true))} disabled={!file}>{mobileEdit ? 'Ler' : 'Editar'}</button>
            </div>
            {fileErr && <div style={{ color: C.crit, fontSize: 13 }}>{fileErr}</div>}
            {file &&
              (mobileEdit ? (
                <MobileEditor
                  key={file.mtime}
                  file={file}
                  onDirty={setMobileDirty}
                  onSaved={() => {
                    setMobileDirty(false)
                    setMobileEdit(false)
                    loadFile()
                  }}
                />
              ) : (
                <div className="vault-card" style={{ display: 'flex' }}>
                  <Reader file={file} resolve={resolve} onOpen={pick} />
                </div>
              ))}
            {file && <Connections path={selected} text={file.text} resolve={resolve} onOpen={pick} status={status} onCommit={() => void commit()} committing={committing} />}
          </div>
        )}
      </div>
    )
  }

  const connections = file ? <Connections path={selected} text={file.text} resolve={resolve} onOpen={pick} status={status} onCommit={() => void commit()} committing={committing} /> : <div className="vault-card" />

  // ---------- desktop (tablet: árvore estreita + conteúdo; conexões numa gaveta) ----------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {createBox}
      {overlays}
      {tablet && showEditor && (
        <div role="note" style={{ fontSize: 12.5, color: C.t2, padding: '8px 12px', borderRadius: 10, background: 'rgba(245,181,74,.06)', border: '1px solid rgba(245,181,74,.18)' }}>
          O editor VS Code funciona melhor no computador. No tablet, o modo Leitura é mais confortável.
        </div>
      )}
      <section className="vault-grid" style={tablet ? { height: 'calc(var(--vvh) - var(--sat) - 150px)', minHeight: 360 } : { height: 'calc(100dvh - 158px)', minHeight: 520 }}>
        <Explorer tree={tree} treeState={treeState} onRetry={retry} selected={selected} onPick={pick} onCreate={setCreating} onNewFolder={openNewFolder} onMenu={openMenu} narrow={false} />
        <div className="vault-center">
          <div className="vault-bar">
            <div role="group" aria-label="Modo de visualização" className="vault-seg">
              {(['edit', 'split', 'read'] as Mode[]).map((m) => (
                <button key={m} onClick={() => setM(m)} aria-pressed={mode === m} className={mode === m ? 'on' : ''}>
                  {m === 'edit' ? 'Editor' : m === 'split' ? 'Lado a lado' : 'Leitura'}
                </button>
              ))}
            </div>
            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: C.t2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              vault › {selected.split('/').join(' › ').replace(/\.md$/, '')}
            </span>
            <span className="app-mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: C.t2 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: status?.editor === false ? C.warn : C.ok, boxShadow: `0 0 6px ${status?.editor === false ? C.warn : C.ok}` }} />
              {status?.editor === false ? 'VS Code iniciando' : 'VS Code'}
            </span>
            <a className="vault-link-btn" href="/code/" target="_blank" rel="noopener">Abrir em aba ↗</a>
            {tablet && (
              <button className="app-btn small" aria-expanded={ctxOpen} onClick={() => setCtxOpen(true)}>
                Contexto
              </button>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: mode === 'split' ? 'minmax(0,1fr) minmax(0,1fr)' : 'minmax(0,1fr)' }}>
            {/* o iframe fica montado (escondido no modo Leitura) para não recarregar o VS Code */}
            <iframe title="VS Code" src="/code/" className="vault-iframe" style={{ display: showEditor ? 'block' : 'none' }} allow="clipboard-read; clipboard-write" />
            {mode !== 'edit' && (
              <div style={{ minWidth: 0, minHeight: 0, display: 'flex', borderLeft: mode === 'split' ? '1px solid rgba(255,255,255,.06)' : 'none' }}>
                {fileErr ? <div style={{ padding: 24, color: C.crit, fontSize: 13 }}>{fileErr}</div> : <Reader file={file} resolve={resolve} onOpen={pick} />}
              </div>
            )}
          </div>
        </div>
        {!tablet && connections}
      </section>
      {tablet && ctxOpen && (
        <div onClick={() => setCtxOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(4,5,12,.5)' }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Contexto da nota"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: 'calc(12px + var(--sat))', right: 'calc(12px + var(--sar))', bottom: 'calc(12px + var(--sab))', width: 320, display: 'flex', flexDirection: 'column', gap: 8, background: '#0e1022', borderRadius: 18, padding: 8, boxShadow: '0 24px 70px rgba(0,0,0,.6)', border: '1px solid rgba(255,255,255,.08)' }}
          >
            <button autoFocus className="app-btn small" style={{ alignSelf: 'flex-end' }} onClick={() => setCtxOpen(false)}>Fechar</button>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{connections}</div>
          </div>
        </div>
      )}
    </div>
  )
}
