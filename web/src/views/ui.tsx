import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { C, glow } from '../lib/colors'
import { useYui, type HeaderAction } from '../store/yui'
import { BottomSheet } from './Sheet'
import { dropToast, useFeedback } from '../lib/feedback'

export const card: CSSProperties = { padding: '18px 20px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }

/** Define eyebrow/título/ações do cabeçalho do Canvas para a view atual. */
export function useHeader(eyebrow: string, title: string, actions: HeaderAction[] = [], deps: unknown[] = []) {
  useEffect(() => {
    useYui.getState().setHeader({ eyebrow, title, actions })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eyebrow, title, ...deps])
}

export function Dot({ c, size = 8, hollow = false }: { c: string; size?: number; hollow?: boolean }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: hollow ? 'transparent' : c, border: hollow ? `1px solid ${C.t3}` : undefined, boxShadow: hollow ? undefined : glow(c) }}
    />
  )
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="eyebrow" style={style}>{children}</div>
}

export function Skeleton({ rows = 3, kpis = 4 }: { rows?: number; kpis?: number }) {
  return (
    <div aria-busy="true" aria-label="Carregando" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {kpis > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14 }}>
          {Array.from({ length: kpis }).map((_, i) => <div key={i} className="skel" style={{ height: 88 }} />)}
        </div>
      )}
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skel" style={{ height: 44, opacity: 1 - i * 0.15 }} />)}
    </div>
  )
}

/** Empty state "Yui-oriented" (§119). */
export function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div style={{ padding: '48px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
      <span aria-hidden style={{ width: 14, height: 14, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #fff, #67d8f2 45%, #a68cf7)', opacity: 0.8 }} />
      <div style={{ fontSize: 15, color: 'var(--text-soft)', maxWidth: 420 }}>{text}</div>
      {hint && <div style={{ fontSize: 13, color: C.t3 }}>{hint}</div>}
    </div>
  )
}

/** Falha ao carregar: mensagem + "Tentar de novo" (quando há `retry`). */
export function ErrorNote({ text, retry }: { text?: string; retry?: () => void }) {
  return (
    <div role="alert" style={{ padding: '40px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 15, color: 'var(--text-soft)', maxWidth: 420 }}>{text ?? 'Não consegui carregar isso agora.'}</div>
      {retry ? <button className="app-btn" onClick={retry}>Tentar de novo</button> : <div style={{ fontSize: 13, color: C.t3 }}>Tente de novo em instantes.</div>}
    </div>
  )
}

/**
 * Modal único do painel: Esc e toque fora fecham (menos durante `busy`), foco fica preso dentro e volta para
 * onde estava ao fechar; no celular vira folha inferior.
 */
export function Modal({ label, labelledBy, onClose, busy, tone, width = 460, role = 'dialog', zIndex = 70, children }: {
  label: string
  labelledBy?: string
  onClose: () => void
  busy?: boolean
  tone?: string
  width?: number
  role?: 'dialog' | 'alertdialog'
  zIndex?: number
  children: ReactNode
}) {
  const phone = useYui((s) => s.device === 'phone')
  const box = useRef<HTMLDivElement>(null)
  const close = useCallback(() => { if (!busy) onClose() }, [busy, onClose])
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const root = box.current
    if (root && !root.contains(document.activeElement)) {
      const first = root.querySelector<HTMLElement>('[autofocus],button:not([disabled]),input,textarea,select,[tabindex]:not([tabindex="-1"])')
      first?.focus()
    }
    return () => prev?.focus?.()
  }, [phone])
  useEffect(() => {
    if (phone) return // a folha inferior cuida do Esc
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      } else if (e.key === 'Tab' && box.current) {
        const f = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea,select,[tabindex]:not([tabindex="-1"])')]
        if (!f.length) return
        const [a, z] = [f[0], f[f.length - 1]]
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close, phone])
  if (phone)
    return (
      <BottomSheet label={label} role={role} tone={tone} zIndex={zIndex + 2} onClose={close}>
        <div ref={box} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
      </BottomSheet>
    )
  return createPortal(
    <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,10,.66)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex, padding: 16 }}>
      <div
        ref={box}
        role={role}
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
        style={{ width, maxWidth: '100%', maxHeight: 'calc(var(--vvh) - 32px)', overflowY: 'auto', boxSizing: 'border-box', padding: 22, borderRadius: 18, background: 'var(--panel)', border: `1px solid ${tone ?? 'rgba(255,255,255,.1)'}`, boxShadow: '0 30px 80px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Linha de botões do rodapé de um modal: no celular ocupa a largura em duas colunas. */
export function ModalButtons({ children }: { children: ReactNode }) {
  const phone = useYui((s) => s.device === 'phone')
  return <div style={{ display: 'grid', gridTemplateColumns: phone ? 'repeat(2, minmax(0, 1fr))' : 'auto auto', justifyContent: phone ? undefined : 'end', gap: 8 }}>{children}</div>
}

/** Confirmação genérica (Cancelar recebe o foco). `danger` pinta o botão de vermelho. */
export function ConfirmModal({ title, text, rows = [], busy, danger, undoable, confirmLabel = 'Confirmar', busyLabel, cancelLabel = 'Cancelar', onCancel, onConfirm }: {
  title: string
  text?: string
  rows?: { label: string; value: string }[]
  busy?: boolean
  danger?: boolean
  undoable?: boolean
  confirmLabel?: string
  busyLabel?: string
  cancelLabel?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const phone = useYui((s) => s.device === 'phone')
  const h = phone ? 50 : 44
  return (
    <Modal label={title} labelledBy="cm-title" role="alertdialog" busy={busy} tone={danger ? 'rgba(240,98,114,.35)' : undefined} onClose={onCancel}>
      {danger && !undoable && <div style={{ fontSize: 11, letterSpacing: '.2em', color: C.crit, fontWeight: 700 }}>AÇÃO DESTRUTIVA · NÃO DÁ PARA DESFAZER</div>}
      <div id="cm-title" style={{ fontSize: 18, fontWeight: 700, overflowWrap: 'anywhere' }}>{title}</div>
      {text && <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-soft)' }}>{text}</p>}
      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 13 }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
              <span style={{ color: C.t2 }}>{r.label}</span>
              <span style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
      <ModalButtons>
        <button autoFocus disabled={busy} onClick={onCancel} className="app-btn" style={{ height: h, padding: '0 16px', fontSize: 13.5 }}>
          {cancelLabel}
        </button>
        <button disabled={busy} onClick={onConfirm} className={`app-btn ${danger ? 'solid-danger' : 'primary'}`} style={{ height: h, padding: '0 16px', fontSize: 13.5 }}>
          {busy ? busyLabel ?? 'Aguarde…' : confirmLabel}
        </button>
      </ModalButtons>
    </Modal>
  )
}

/** Confirmação de exclusão (workflows, missões…). `undoable` = vai para a lixeira, sem o aviso de definitivo. */
export function ConfirmDeleteModal({ title, text, rows = [], busy, undoable, confirmLabel, onCancel, onConfirm }: {
  title: string
  text: string
  rows?: { label: string; value: string }[]
  busy?: boolean
  undoable?: boolean
  confirmLabel?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <ConfirmModal
      title={title}
      text={text}
      rows={rows}
      busy={busy}
      danger
      undoable={undoable}
      confirmLabel={confirmLabel ?? (undoable ? 'Mover para a lixeira' : 'Excluir definitivamente')}
      busyLabel="Excluindo…"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}

/** Avisos e confirmações globais (lib/feedback): montado uma vez no Shell. */
export function FeedbackHost() {
  const toasts = useFeedback((s) => s.toasts)
  const confirm = useFeedback((s) => s.confirm)
  const finish = (ok: boolean) => {
    confirm?.resolve(ok)
    useFeedback.setState({ confirm: null })
  }
  return (
    <>
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          text={confirm.text}
          rows={confirm.rows}
          danger={confirm.danger}
          undoable={confirm.undoable}
          confirmLabel={confirm.confirmLabel}
          cancelLabel={confirm.cancelLabel}
          onCancel={() => finish(false)}
          onConfirm={() => finish(true)}
        />
      )}
      {createPortal(
        <div aria-live="polite" role="status" style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(var(--toast-bottom, 24px) + var(--sab))', zIndex: 90, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none', padding: '0 16px' }}>
          {toasts.map((t) => {
            const c = t.tone === 'err' ? C.crit : t.tone === 'ok' ? C.ok : C.cyan
            return (
              <div key={t.id} role={t.tone === 'err' ? 'alert' : undefined} style={{ pointerEvents: 'auto', maxWidth: 520, width: 'fit-content', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px 10px 16px', borderRadius: 12, background: 'var(--panel)', border: `1px solid ${c}66`, boxShadow: '0 16px 40px rgba(0,0,0,.5)', fontSize: 13.5, color: C.text, animation: 'atria-pop .2s var(--ease)' }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{t.text}</span>
                {t.action && (
                  <button className="app-btn small" onClick={() => { dropToast(t.id); t.action!.fn() }}>{t.action.label}</button>
                )}
                <button aria-label="Fechar aviso" onClick={() => dropToast(t.id)} className="icon-btn" style={{ width: 32, height: 32 }}>×</button>
              </div>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
