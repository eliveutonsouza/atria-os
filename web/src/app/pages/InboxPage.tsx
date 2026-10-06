import { useState } from 'react'
import type { ApprovalInfo, InboxItem } from '@shared/protocol'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { resolveApproval } from '../../lib/actions'
import { C, toneColor } from '../../lib/colors'
import { useYui } from '../../store/yui'
import { Tabs } from '../../views/kit'
import { Empty, useHeader } from '../../views/ui'
import { relTime } from './common'

// Exclusões pedidas à Yui usam run_id "delete:workflow:<slug>" / "delete:mission:<id>".
function review(runId: string) {
  const s = useYui.getState()
  const [, what, target] = runId.match(/^delete:(workflow|mission):(.+)$/) ?? []
  if (what === 'workflow') return s.show('workflow', { workflowId: target })
  if (what === 'mission') return s.show('mission', { missionId: target })
  s.show('runs', { runId })
}

// GET /api/approvals/history (server/src/historyApi.ts)
interface ApprovalHistoryItem {
  id: string
  runId: string
  title: string
  status: 'approved' | 'rejected' | 'expired'
  kind: string | null
  createdAt: string
  resolvedAt: string | null
}

const RESOLVED: Record<ApprovalHistoryItem['status'], [string, string]> = {
  approved: ['aprovada', C.ok],
  rejected: ['rejeitada', C.crit],
  expired: ['expirou', C.t3],
}

async function dismiss(ib: InboxItem) {
  try {
    await api.post(`/api/inbox/${encodeURIComponent(ib.id)}/dismiss`)
  } catch (e) {
    useYui.getState().say(`Não consegui dispensar: ${(e as Error).message}.`)
  }
}

// Aprovações & inbox: decide direto daqui (Aprovar/Rejeitar), sem abrir o modal; aba Histórico com as já resolvidas.
export function InboxPage() {
  const [tab, setTab] = useState<'pending' | 'history'>('pending')
  const inbox = useYui((s) => s.inbox)
  const approvals = useApi<ApprovalInfo[]>('/api/approvals', [inbox.length], 10000)
  useHeader('Aprovações', inbox.length ? `${inbox.length} coisa${inbox.length > 1 ? 's' : ''} precisa${inbox.length > 1 ? 'm' : ''} de você` : 'Nada pendente')
  const list = approvals.data ?? []
  const others = inbox.filter((i) => i.action.type !== 'approval')
  const phone = useYui((s) => s.device === 'phone')

  const decide = async (id: string, ok: boolean) => {
    await resolveApproval(id, ok)
    approvals.reload()
  }
  const tabs = (
    <div className={phone ? 'h-scroll' : undefined} style={{ minWidth: 0 }}>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'pending', label: 'Pendentes', count: list.length + others.length }, { id: 'history', label: 'Histórico' }]} />
    </div>
  )
  if (tab === 'history')
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 920 }}>
        {tabs}
        <ApprovalHistory />
      </div>
    )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 920 }}>
      {tabs}
      {list.length === 0 && others.length === 0 && <Empty text="Nada precisa de você agora." hint="Aprovações de deploy, envio e publicação aparecem aqui." />}
      {list.map((a) => {
        const danger = a.kind === 'destructive'
        return (
        <section key={a.id} style={{ minWidth: 0, padding: phone ? '16px 14px' : '18px 20px', borderRadius: 18, background: 'linear-gradient(180deg,rgba(26,22,52,.6),rgba(14,16,34,.6))', border: `1px solid ${danger ? 'rgba(240,98,114,.45)' : 'rgba(245,181,74,.3)'}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, ...(phone ? { flexWrap: 'wrap', rowGap: 4 } : null) }}>
            <span style={{ fontSize: 11, letterSpacing: phone ? '.14em' : '.22em', color: danger ? C.crit : C.warn, fontWeight: 700 }}>{danger ? 'AÇÃO DESTRUTIVA · NÃO DÁ PARA DESFAZER' : 'APROVAÇÃO NECESSÁRIA'}</span>
            <span className="app-mono" style={{ fontSize: 11, color: C.t3 }}>{relTime(a.createdAt)}</span>
          </div>
          <div style={{ fontSize: 17, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{a.title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {a.rows.map((r) => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.06)', fontSize: 13 }}>
                <span style={{ color: C.t2, flexShrink: 0 }}>{r.label}</span>
                <span className="app-mono" style={{ color: toneColor(r.tone), fontSize: 12, textAlign: 'right', wordBreak: 'break-word', minWidth: 0 }}>{r.value}</span>
              </div>
            ))}
          </div>
          {/* celular: Revisar em cima; Rejeitar | Aprovar em grade de 2 colunas, 50px */}
          <div style={phone ? { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 } : { display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="app-btn" style={phone ? { gridColumn: '1 / -1', height: 44 } : undefined} onClick={() => review(a.runId)}>Revisar</button>
            {!phone && <span style={{ flex: 1 }} />}
            <button className={danger ? 'app-btn' : 'app-btn danger'} style={phone ? { height: 50, justifyContent: 'center' } : { minWidth: 120, height: 42 }} onClick={() => void decide(a.id, false)}>{danger ? 'Cancelar' : 'Rejeitar'}</button>
            <button style={{ ...(phone ? { height: 50, padding: '0 8px', lineHeight: 1.2 } : { minWidth: 140, height: 42 }), borderRadius: 12, border: 'none', background: danger ? '#e2566a' : 'linear-gradient(135deg,#4fe0b0,#67d8f2)', color: danger ? '#fff' : '#06221c', fontSize: 14, fontWeight: 700, cursor: 'pointer' }} onClick={() => void decide(a.id, true)}>
              {danger ? 'Excluir definitivamente' : 'Aprovar'}
            </button>
          </div>
        </section>
        )
      })}
      {others.map((ib) => (
        <div key={ib.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 14, border: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.025)', minWidth: 0 }}>
          <button
            onClick={() => ib.action.type === 'view' && useYui.getState().show(ib.action.view, ib.action.params ?? {})}
            className="app-row"
            style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px', borderRadius: 14, border: 'none', background: 'transparent', color: C.text, textAlign: 'left', cursor: 'pointer' }}
          >
            <span style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: toneColor(ib.tone), fontWeight: 600 }}>{ib.tag}</span>
            <span style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{ib.label}</span>
          </button>
          {ib.id.startsWith('failed:') && (
            <button className="app-btn small" style={{ marginRight: 10, flexShrink: 0, minHeight: phone ? 44 : undefined }} onClick={() => void dismiss(ib)} title="Tira do inbox; a execução continua no histórico">
              Dispensar
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function ApprovalHistory() {
  const { data, loading, error } = useApi<ApprovalHistoryItem[]>('/api/approvals/history?limit=50', [], 30000)
  const phone = useYui((s) => s.device === 'phone')
  if (loading && !data) return <Empty text="Carregando…" />
  if (error || !data) return <Empty text="Não consegui ler o histórico de aprovações." />
  if (!data.length) return <Empty text="Nenhuma aprovação resolvida ainda." hint="Aprovações aprovadas, rejeitadas ou expiradas aparecem aqui." />
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {data.map((a) => {
        const [label, color] = RESOLVED[a.status] ?? [a.status, C.t2]
        return (
          <button
            key={a.id}
            onClick={() => review(a.runId)}
            className="app-row"
            style={{ display: 'grid', gridTemplateColumns: phone ? 'minmax(0,1fr) auto' : 'minmax(0,1fr) 110px 90px', gap: 12, alignItems: 'center', minHeight: 44, padding: '12px 10px', border: 'none', borderBottom: '1px solid rgba(255,255,255,.05)', background: 'transparent', color: C.text, textAlign: 'left', cursor: 'pointer' }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: phone ? 'normal' : 'nowrap', overflowWrap: 'anywhere' }}>{a.title}</span>
              <span style={{ fontSize: 11.5, color: C.t3 }}>
                {a.kind === 'destructive' ? 'exclusão' : 'aprovação'}
                {phone ? ` · ${relTime(a.resolvedAt ?? a.createdAt)}` : ''}
              </span>
            </span>
            <span style={{ fontSize: 12, color, whiteSpace: 'nowrap' }}>{label}</span>
            {!phone && <span className="app-mono" style={{ fontSize: 11, color: C.t3, textAlign: 'right' }}>{relTime(a.resolvedAt ?? a.createdAt)}</span>}
          </button>
        )
      })}
    </div>
  )
}
