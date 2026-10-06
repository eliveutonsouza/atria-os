import { useEffect, useMemo, useRef, useState } from 'react'
import type { InboxItem, RepoInfo, ViewName } from '@shared/protocol'
import { api } from '../api/client'
import { enterApp } from '../app/nav'
import { applyUpdate, disablePush, enablePush, isIOS, isStandalone, promptInstall, testPush } from '../pwa/pwa'
import { resolveApproval } from '../lib/actions'
import { C, toneColor } from '../lib/colors'
import { dockInput } from '../shell/parts'
import { useYui } from '../store/yui'
import { BottomSheet } from '../views/Sheet'

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
      <div role="dialog" aria-label="Pendências" style={{ position: 'absolute', top: 'calc(60px + var(--sat))', right: 'calc(16px + var(--sar))', width: 'min(380px,calc(100% - 32px))', maxHeight: 'calc(var(--vvh) - 80px - var(--sat))', overflowY: 'auto', zIndex: 50, padding: 8, borderRadius: 16, background: 'rgba(16,20,42,.94)', border: '1px solid rgba(255,255,255,.1)', backdropFilter: 'blur(16px)', boxShadow: '0 24px 60px rgba(0,0,0,.5)' }}>
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
      style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 'min(360px,90dvw)', zIndex: 52, paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)', paddingLeft: 'var(--sal)', boxSizing: 'border-box', transform: open ? 'translateX(0)' : 'translateX(-105%)', transition: 'transform .4s cubic-bezier(.2,.8,.2,1)', background: 'rgba(12,14,30,.95)', borderRight: '1px solid rgba(255,255,255,.08)', backdropFilter: 'blur(18px)', display: 'flex', flexDirection: 'column', visibility: open ? 'visible' : 'hidden' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Conversa</span>
        <button onClick={() => useYui.getState().set({ histOpen: false })} style={{ minHeight: 44, padding: '0 8px', border: 'none', background: 'transparent', color: C.t2, cursor: 'pointer', fontSize: 14 }}>Fechar</button>
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
      { label: 'Abrir dashboard', hint: 'Ctrl J', fn: () => { close(); enterApp(s().appPage) } },
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
      ...(!isStandalone() ? [{ label: 'Instalar app (celular/desktop)', hint: 'PWA', fn: () => { close(); void install() } }] : []),
      { label: s().pushEnabled ? 'Notificações: desativar neste dispositivo' : 'Notificações: ativar neste dispositivo', hint: 'push', fn: () => { close(); void (s().pushEnabled ? disablePush() : enablePush()).then((m) => s().say(m)).catch(() => s().say('Não consegui mudar as notificações agora.')) } },
      { label: 'Notificações: enviar teste', hint: 'push', fn: () => { close(); void testPush().then((m) => s().say(m)).catch(() => s().say('Falhou o teste de notificação.')) } },
      { label: 'Ferramentas · conectores, MCP, skills, plugins', hint: 'view', fn: go('tools') },
      { label: 'Workflows', hint: 'view', fn: go('workflows') },
      { label: '+ Novo workflow', hint: 'ação', fn: go('workflow') },
      { label: 'Rotinas', hint: 'view', fn: go('routines') },
      { label: 'Claude Code · mapa', hint: 'view', fn: go('claude') },
      { label: 'Terminal · Claude Code', hint: 'Ctrl `', fn: go('terminal', { kind: 'claude' }) },
      { label: 'Terminal · Shell', hint: 'view', fn: go('terminal', { kind: 'shell' }) },
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
      <div role="dialog" aria-label="Comandos" style={{ position: 'absolute', top: 'calc(12dvh + var(--sat))', left: '50%', transform: 'translateX(-50%)', width: 'min(560px,calc(100% - 32px))', zIndex: 56, borderRadius: 18, background: 'rgba(16,20,42,.96)', border: '1px solid rgba(160,170,255,.16)', boxShadow: '0 30px 90px rgba(0,0,0,.6)', overflow: 'hidden' }}>
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
        <div role="listbox" style={{ maxHeight: 'min(52dvh, calc(var(--vvh) - 12dvh - 140px))', overflow: 'auto', padding: 8 }}>
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
  const device = useYui((s) => s.device)
  const yuiShell = useYui((s) => s.shellMode === 'yui')
  const btnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (ap) setTimeout(() => btnRef.current?.focus(), 50)
  }, [ap])
  if (!id || !ap) return null
  const phone = device === 'phone'
  // ao lado do Canvas só no modo Yui do desktop; no dashboard e no tablet fica centralizado
  const left = yuiShell && mode !== 'center' && device === 'desktop' ? '62%' : '50%'
  // Exclusão pedida pela Yui: visual vermelho, foco no "Cancelar" e rótulo explícito no botão destrutivo.
  const danger = ap.kind === 'destructive'
  const tall = phone ? 52 : 44
  const review = () => {
    // aprovação pode ser de um run, de uma etapa de missão, de um passo de workflow ou de uma exclusão pedida à Yui
    const st = useYui.getState()
    const [, what, target] = ap.runId.match(/^delete:(workflow|mission):(.+)$/) ?? []
    if (what === 'workflow') return st.show('workflow', { workflowId: target })
    if (what === 'mission') return st.show('mission', { missionId: target })
    const wf = st.workflowRuns[ap.runId]
    if (wf) return st.show('workflow', { workflowId: wf.workflow, workflowRunId: wf.id })
    const ms = Object.values(st.missions).find((m) => m.id === ap.runId || m.steps.some((x) => x.runId === ap.runId))
    if (ms) return st.show('mission', { missionId: ms.id })
    st.show('runs', { runId: ap.runId })
  }
  const content = (
    <>
      <div style={{ fontSize: 11, letterSpacing: '.24em', color: danger ? C.crit : C.warn, fontWeight: 700 }}>{danger ? 'AÇÃO DESTRUTIVA · NÃO DÁ PARA DESFAZER' : 'APROVAÇÃO NECESSÁRIA'}</div>
      <div id="ap-title" style={{ fontSize: phone ? 19 : 22, fontWeight: 400, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{ap.title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
        {ap.rows.map((r) => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <span style={{ color: C.t2, flexShrink: 0 }}>{r.label}</span>
            <span className={r.label.toLowerCase().includes('comando') ? 'mono' : undefined} style={{ color: toneColor(r.tone), textAlign: 'right', wordBreak: 'break-word', fontSize: r.label.toLowerCase().includes('comando') ? 12 : 14 }}>{r.value}</span>
          </div>
        ))}
      </div>
      <button ref={danger ? undefined : btnRef} onClick={review} style={{ height: tall - 4, flexShrink: 0, borderRadius: 12, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.03)', color: '#dfe3f3', fontSize: 14, cursor: 'pointer' }}>{danger ? 'Ver o que será excluído' : 'Revisar alterações'}</button>
      {/* botões de decisão sempre visíveis no pé (o resto rola se faltar altura) */}
      <div style={{ display: 'flex', gap: 10, position: 'sticky', bottom: 0, paddingTop: 4, background: phone ? '#0e1022' : 'rgba(14,16,34,.97)', flexShrink: 0 }}>
        {danger ? (
          <>
            <button ref={btnRef} onClick={() => resolveApproval(ap.id, false)} style={{ flex: 1, height: tall, borderRadius: 12, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.05)', color: '#dfe3f3', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
            <button onClick={() => resolveApproval(ap.id, true)} style={{ flex: 1, height: tall, borderRadius: 12, border: 'none', background: '#e2566a', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Excluir definitivamente</button>
          </>
        ) : (
          <>
            <button onClick={() => resolveApproval(ap.id, false)} style={{ flex: 1, height: tall, borderRadius: 12, border: '1px solid rgba(240,98,114,.35)', background: 'transparent', color: '#f39aa4', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Rejeitar</button>
            <button onClick={() => resolveApproval(ap.id, true)} style={{ flex: 1, height: tall, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#4fe0b0,#67d8f2)', color: '#06221c', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Aprovar</button>
          </>
        )}
      </div>
    </>
  )
  // celular: folha inferior (prancha Phone-Aprovacao); fechar só esconde, a aprovação continua pendente
  if (phone)
    return (
      <BottomSheet label={ap.title} role="alertdialog" tone={danger ? 'rgba(240,98,114,.5)' : 'rgba(245,181,74,.35)'} onClose={() => useYui.getState().set({ approvalOpen: null })} zIndex={59}>
        {content}
      </BottomSheet>
    )
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, zIndex: 58, background: 'rgba(4,5,12,.6)', backdropFilter: 'blur(6px)' }} />
      <div role="alertdialog" aria-modal="true" aria-labelledby="ap-title" style={{ position: 'absolute', top: '50%', left, transform: 'translate(-50%,-50%)', width: 'min(460px,calc(100% - 32px))', maxHeight: 'calc(var(--vvh) - var(--sat) - var(--sab) - 32px)', overflowY: 'auto', overscrollBehavior: 'contain', boxSizing: 'border-box', zIndex: 59, padding: 28, borderRadius: 22, background: 'linear-gradient(180deg,rgba(26,22,52,.97),rgba(14,16,34,.97))', border: `1px solid ${danger ? 'rgba(240,98,114,.5)' : 'rgba(245,181,74,.3)'}`, boxShadow: `0 0 60px ${danger ? 'rgba(240,98,114,.12)' : 'rgba(245,181,74,.08)'}, 0 30px 90px rgba(0,0,0,.6)`, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {content}
      </div>
    </>
  )
}

async function install() {
  const s = useYui.getState()
  const r = await promptInstall()
  if (r === 'ios') s.say('No iPhone: toque em Compartilhar e depois em “Adicionar à Tela de Início”.')
  else if (r === 'unavailable') s.say(isIOS() ? 'Abra no Safari para instalar.' : 'O navegador não ofereceu instalação agora — use o ícone de instalar na barra de endereço.')
  else if (r === 'accepted') s.say('App instalado. Pode abrir a Yui pela tela inicial.')
}

export function UpdateToast() {
  const ready = useYui((s) => s.updateReady)
  if (!ready) return null
  return (
    <div role="status" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(96px + var(--sab) + var(--kb))', zIndex: 57, display: 'flex', alignItems: 'center', gap: 12, maxWidth: 'calc(100% - 32px)', padding: '10px 10px 10px 16px', borderRadius: 14, background: 'rgba(16,20,42,.94)', border: '1px solid rgba(103,216,242,.3)', backdropFilter: 'blur(16px)', boxShadow: '0 18px 50px rgba(0,0,0,.45)', fontSize: 13, color: C.text }}>
      Nova versão da Yui disponível
      <button onClick={applyUpdate} style={{ height: 30, padding: '0 12px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#67d8f2,#a68cf7)', color: '#0a0c1d', fontWeight: 700, cursor: 'pointer' }}>Atualizar</button>
    </div>
  )
}
