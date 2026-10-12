import type { CompanyCategory, CompanyDoc } from '@shared/protocol'
import { ConfirmDeleteModal } from '../views/ui'
import { CAT_COLORS, goTab, pipeSegments, statusOf, typeColors, type CompanyTab } from './api'

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
      {t('busca', 'Como funciona a busca')}
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
  const names = docs.map((d) => d.name)
  return (
    <ConfirmDeleteModal
      title={docs.length === 1 ? 'Excluir 1 documento?' : `Excluir ${docs.length} documentos?`}
      text={`Apaga o arquivo, o texto lido e a busca da Yui, junto com a nota no vault. A Yui e os agentes deixam de encontrar esse conteúdo na hora. Documentos: ${names.slice(0, 8).join(' · ')}${names.length > 8 ? ` · e mais ${names.length - 8}` : ''}`}
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
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
