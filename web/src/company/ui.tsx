import type { CompanyCategory, CompanyDoc } from '@shared/protocol'
import { CAT_COLORS, goTab, Icon, pipeSegments, statusOf, typeColors, type CompanyTab } from './api'

// Componentes visuais compartilhados das abas da Empresa.

export function Svg({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

export function Tabs({ active, docs }: { active: CompanyTab; docs: number | null }) {
  const t = (id: CompanyTab, label: string, badge?: number | null) => (
    <button key={id} role="tab" aria-selected={active === id} className={`co-tab${active === id ? ' on' : ''}`} onClick={() => goTab(id)}>
      {label}
      {badge != null && (
        <span style={{ height: 18, padding: '0 6px', borderRadius: 9, background: 'rgba(166,140,247,0.18)', color: '#cbbcff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center' }}>{badge}</span>
      )}
    </button>
  )
  return (
    <nav role="tablist" aria-label="Seções da empresa" className="co-tabs" data-own-scroll style={{ overflowX: 'auto' }}>
      {t('perfil', 'Perfil')}
      {t('documentos', 'Documentos', docs)}
      {t('busca', 'Pipeline & busca')}
    </nav>
  )
}

export function TypeBadge({ ext, size = 1 }: { ext: string; size?: number }) {
  const [bg, fg] = typeColors(ext)
  return (
    <span
      aria-hidden
      style={{ width: 34 * size, height: 40 * size, borderRadius: 7, flexShrink: 0, background: bg, color: fg, fontSize: 9.5 * size, fontWeight: 800, letterSpacing: '.04em', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 6 * size, fontFamily: 'var(--mono)' }}
    >
      {ext.toUpperCase().slice(0, 4)}
    </span>
  )
}

export function CategoryChip({ cat }: { cat: CompanyCategory }) {
  const [bg, fg] = CAT_COLORS[cat] ?? CAT_COLORS.Outros
  return <span style={{ height: 24, padding: '0 9px', borderRadius: 12, background: bg, color: fg, fontSize: 11.5, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{cat}</span>
}

export function PipeBar({ doc, showText = true }: { doc: CompanyDoc; showText?: boolean }) {
  const st = statusOf(doc)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {pipeSegments(doc).map((s) => (
          <span key={s.label} title={s.label} style={{ flex: 1, height: 5, borderRadius: 3, background: s.bg, animation: s.active ? 'co-bar .8s linear infinite' : 'none' }} />
        ))}
      </div>
      {showText && (
        <span title={st.text} style={{ fontSize: 11.5, color: st.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {st.text}
        </span>
      )}
    </div>
  )
}

export function DeleteModal({ docs, onCancel, onConfirm, busy }: { docs: { name: string }[]; onCancel: () => void; onConfirm: () => void; busy?: boolean }) {
  return (
    <div className="co-modal-bg" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label="Excluir documentos" className="co-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(240,98,114,0.14)', color: '#f39aa4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Svg d={Icon.trash} size={18} />
          </span>
          <span style={{ fontSize: 17, fontWeight: 700 }}>{docs.length === 1 ? 'Excluir 1 documento?' : `Excluir ${docs.length} documentos?`}</span>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: '#c9cde0' }}>
          Some de tudo: o arquivo original, o texto extraído e os dados no PostgreSQL, os vetores no Qdrant e a nota no vault. A Yui e os agentes deixam de encontrar esse conteúdo na hora. Não dá para desfazer.
        </p>
        <div style={{ fontSize: 12.5, color: '#9aa0bb', padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', maxHeight: 120, overflowY: 'auto', overflowWrap: 'anywhere' }}>{docs.map((d) => d.name).join(' · ')}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button className="app-btn" style={{ height: 42 }} onClick={onCancel}>
            Cancelar
          </button>
          <button
            autoFocus
            disabled={busy}
            onClick={onConfirm}
            style={{ height: 42, padding: '0 16px', borderRadius: 10, border: 'none', background: '#e2566a', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Excluindo…' : 'Excluir definitivamente'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function HealthDot({ ok, label }: { ok: boolean | undefined; label: string }) {
  const c = ok === undefined ? '#6f7590' : ok ? '#4fe0b0' : '#f06272'
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c, boxShadow: `0 0 6px ${c}` }} />
      {label}
    </span>
  )
}
