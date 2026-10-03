import { useEffect, useMemo, useRef, useState } from 'react'
import type { InboxItem, RepoInfo, ViewName } from '@shared/protocol'
import { api } from '../api/client'
import { resolveApproval } from '../lib/actions'
import { C, toneColor } from '../lib/colors'
import { dockInput } from '../shell/parts'
import { useYui } from '../store/yui'

function openInboxItem(ib: InboxItem) {
  const s = useYui.getState()
  s.set({ inboxOpen: false })
  if (ib.action.type === 'approval') {
    if (s.approvals[ib.action.approvalId]) s.set({ approvalOpen: ib.action.approvalId, yst: 'warning' })
    else s.show('runs')
  } else s.show(ib.action.view, ib.action.params ?? {})
}

export function Inbox() {
  const open = useYui((s) => s.inboxOpen)
  const inbox = useYui((s) => s.inbox)
  if (!open) return null
  return (
    <>
      <div onClick={() => useYui.getState().set({ inboxOpen: false })} style={{ position: 'absolute', inset: 0, zIndex: 48 }} />
      <div role="dialog" aria-label="Pendências" style={{ position: 'absolute', top: 60, right: 20, width: 'min(380px,calc(100% - 40px))', zIndex: 50, padding: 8, borderRadius: 16, background: 'rgba(16,20,42,.94)', border: '1px solid rgba(255,255,255,.1)', backdropFilter: 'blur(16px)', boxShadow: '0 24px 60px rgba(0,0,0,.5)' }}>
        <div style={{ padding: '10px 12px 8px', fontSize: 12, color: C.t2 }}>{inbox.length ? `${inbox.length} coisas precisam de você` : 'Nada pendente agora.'}</div>
        {inbox.map((ib) => (
          <button key={ib.id} onClick={() => openInboxItem(ib)} className="hov-item" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3, padding: 12, border: 'none', borderRadius: 10, background: 'transparent', color: C.text, textAlign: 'left', cursor: 'pointer' }}>
            <span style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: toneColor(ib.tone), fontWeight: 600 }}>{ib.tag}</span>
            <span style={{ fontSize: 14 }}>{ib.label}</span>
          </button>
        ))}
      </div>
    </>
  )
}

export function HistoryDrawer() {
  const open = useYui((s) => s.histOpen)
  const hist = useYui((s) => s.hist)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' })
  }, [open, hist.length])
  return (
    <aside
      aria-label="Conversa"
      aria-hidden={!open}
      style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 'min(360px,90vw)', zIndex: 52, transform: open ? 'translateX(0)' : 'translateX(-105%)', transition: 'transform .4s cubic-bezier(.2,.8,.2,1)', background: 'rgba(12,14,30,.95)', borderRight: '1px solid rgba(255,255,255,.08)', backdropFilter: 'blur(18px)', display: 'flex', flexDirection: 'column', visibility: open ? 'visible' : 'hidden' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Conversa</span>
        <button onClick={() => useYui.getState().set({ histOpen: false })} style={{ border: 'none', background: 'transparent', color: C.t2, cursor: 'pointer', fontSize: 13 }}>Fechar</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!hist.length && <div style={{ fontSize: 14, color: C.t3 }}>Ainda não conversamos hoje.</div>}
        {hist.map((h) => (
          <div key={h.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: h.who === 'yui' ? C.cyan : C.t2, fontWeight: 600 }}>{h.who === 'yui' ? 'Yui' : 'Você'}</span>
            <span style={{ fontSize: 14, lineHeight: 1.55, color: '#d6d9e8', whiteSpace: 'pre-wrap' }}>{h.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </aside>
  )
}

interface PalItem { label: string; hint: string; fn: () => void }

export function CommandPalette() {
  const open = useYui((s) => s.palette)
  const projects = useYui((s) => s.projects)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [repos, setRepos] = useState<RepoInfo[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 30)
      api.get<RepoInfo[]>('/api/repos').then(setRepos).catch(() => {})
    }
  }, [open])
  const items = useMemo<PalItem[]>(() => {
    const s = () => useYui.getState()
    const close = () => s().set({ palette: false })
    const go = (v: ViewName, params = {}) => () => s().show(v, params)
    const all: PalItem[] = [
      { label: 'Falar com Yui', hint: 'Ctrl L', fn: () => { close(); setTimeout(() => dockInput.el?.focus(), 30) } },
      { label: 'Morning brief', hint: 'view', fn: go('brief') },
      { label: 'Dashboard', hint: 'view', fn: go('dashboard') },
      { label: 'Agentes', hint: 'view', fn: go('agents') },
      { label: 'Execuções', hint: 'view', fn: go('runs') },
      ...projects.map((p) => ({ label: `Projeto · ${p.name}`, hint: 'view', fn: go('project', { project: p.slug }) })),
      // demais repositórios do GitHub: abrir clona sob demanda
      ...repos
        .filter((r) => !r.archived && !projects.some((p) => p.slug === r.slug))
        .map((r) => ({ label: `Projeto · ${r.slug}`, hint: 'GitHub', fn: go('project', { project: r.slug }) })),
      { label: 'Logs', hint: 'view', fn: go('logs') },
      { label: 'Relatório', hint: 'artifact', fn: go('report') },
      { label: 'Preview do site', hint: 'artifact', fn: go('website') },
      { label: 'Infraestrutura', hint: 'view', fn: go('infra') },
      { label: 'Artefatos', hint: 'view', fn: go('artifact') },
      { label: 'Histórico da conversa', hint: '', fn: () => s().set({ palette: false, histOpen: true }) },
      { label: '+ Nova missão', hint: 'ação', fn: () => { close(); s().say('Qual é a missão? Descreva o objetivo e eu monto a equipe.'); setTimeout(() => dockInput.el?.focus(), 30) } },
      { label: 'Voltar para Yui', hint: 'Esc', fn: () => { close(); s().close() } },
    ]
    const n = q.toLowerCase()
    return all.filter((p) => !n || p.label.toLowerCase().includes(n))
  }, [q, projects, repos])
  if (!open) return null
  const pick = (i: number) => items[i]?.fn()
  return (
    <>
      <div onClick={() => useYui.getState().set({ palette: false })} style={{ position: 'absolute', inset: 0, zIndex: 55, background: 'rgba(4,5,12,.55)', backdropFilter: 'blur(4px)' }} />
      <div role="dialog" aria-label="Comandos" style={{ position: 'absolute', top: '16vh', left: '50%', transform: 'translateX(-50%)', width: 'min(560px,calc(100% - 32px))', zIndex: 56, borderRadius: 18, background: 'rgba(16,20,42,.96)', border: '1px solid rgba(160,170,255,.16)', boxShadow: '0 30px 90px rgba(0,0,0,.6)', overflow: 'hidden' }}>
        <input
          ref={inputRef}
          value={q}
          aria-label="Buscar comando ou view"
          onChange={(e) => { setQ(e.target.value); setSel(0) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') pick(sel)
            else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(items.length - 1, x + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)) }
          }}
          placeholder="Buscar comando ou view…"
          style={{ width: '100%', height: 56, padding: '0 20px', border: 'none', outline: 'none', borderBottom: '1px solid rgba(255,255,255,.07)', background: 'transparent', color: C.text, fontSize: 16, fontFamily: 'var(--sans)' }}
        />
        <div role="listbox" style={{ maxHeight: '52vh', overflow: 'auto', padding: 8 }}>
          {items.map((pi, i) => (
            <button key={pi.label} role="option" aria-selected={i === sel} onClick={pi.fn} onMouseEnter={() => setSel(i)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 12px', border: 'none', borderRadius: 10, background: i === sel ? 'rgba(255,255,255,.06)' : 'transparent', color: C.text, fontSize: 14, textAlign: 'left', cursor: 'pointer' }}>
              <span>{pi.label}</span>
              <span style={{ fontSize: 12, color: C.t3 }}>{pi.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

export function ApprovalModal() {
  const id = useYui((s) => s.approvalOpen)
  const ap = useYui((s) => (s.approvalOpen ? s.approvals[s.approvalOpen] : null))
  const mode = useYui((s) => s.mode)
  const narrow = useYui((s) => s.narrow)
  const btnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (ap) setTimeout(() => btnRef.current?.focus(), 50)
  }, [ap])
  if (!id || !ap) return null
  const left = mode === 'center' || narrow ? '50%' : '62%'
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, zIndex: 58, background: 'rgba(4,5,12,.6)', backdropFilter: 'blur(6px)' }} />
      <div role="alertdialog" aria-modal="true" aria-labelledby="ap-title" style={{ position: 'absolute', top: '50%', left, transform: 'translate(-50%,-50%)', width: 'min(460px,calc(100% - 32px))', zIndex: 59, padding: 28, borderRadius: 22, background: 'linear-gradient(180deg,rgba(26,22,52,.97),rgba(14,16,34,.97))', border: '1px solid rgba(245,181,74,.3)', boxShadow: '0 0 60px rgba(245,181,74,.08), 0 30px 90px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ fontSize: 11, letterSpacing: '.24em', color: C.warn, fontWeight: 700 }}>APROVAÇÃO NECESSÁRIA</div>
        <div id="ap-title" style={{ fontSize: 22, fontWeight: 400, lineHeight: 1.35 }}>{ap.title}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
          {ap.rows.map((r) => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
              <span style={{ color: C.t2 }}>{r.label}</span>
              <span className={r.label.toLowerCase().includes('comando') ? 'mono' : undefined} style={{ color: toneColor(r.tone), textAlign: 'right', wordBreak: 'break-word', fontSize: r.label.toLowerCase().includes('comando') ? 12 : 14 }}>{r.value}</span>
            </div>
          ))}
        </div>
        <button ref={btnRef} onClick={() => useYui.getState().show('runs', { runId: ap.runId })} style={{ height: 40, borderRadius: 12, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.03)', color: '#dfe3f3', fontSize: 14, cursor: 'pointer' }}>Revisar alterações</button>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => resolveApproval(ap.id, false)} style={{ flex: 1, height: 44, borderRadius: 12, border: '1px solid rgba(240,98,114,.35)', background: 'transparent', color: '#f39aa4', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Rejeitar</button>
          <button onClick={() => resolveApproval(ap.id, true)} style={{ flex: 1, height: 44, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#4fe0b0,#67d8f2)', color: '#06221c', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Aprovar</button>
        </div>
      </div>
    </>
  )
}
