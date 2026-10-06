import type { ApprovalInfo } from '@shared/protocol'
import { useApi } from '../../api/useApi'
import { resolveApproval } from '../../lib/actions'
import { C, toneColor } from '../../lib/colors'
import { useYui } from '../../store/yui'
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

// Aprovações & inbox: decide direto daqui (Aprovar/Rejeitar), sem abrir o modal.
export function InboxPage() {
  const inbox = useYui((s) => s.inbox)
  const approvals = useApi<ApprovalInfo[]>('/api/approvals', [inbox.length], 10000)
  useHeader('Aprovações', inbox.length ? `${inbox.length} coisa${inbox.length > 1 ? 's' : ''} precisa${inbox.length > 1 ? 'm' : ''} de você` : 'Nada pendente')
  const list = approvals.data ?? []
  const others = inbox.filter((i) => i.action.type !== 'approval')

  const decide = async (id: string, ok: boolean) => {
    await resolveApproval(id, ok)
    approvals.reload()
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 920 }}>
      {list.length === 0 && others.length === 0 && <Empty text="Nada precisa de você agora." hint="Aprovações de deploy, envio e publicação aparecem aqui." />}
      {list.map((a) => {
        const danger = a.kind === 'destructive'
        return (
        <section key={a.id} style={{ padding: '18px 20px', borderRadius: 18, background: 'linear-gradient(180deg,rgba(26,22,52,.6),rgba(14,16,34,.6))', border: `1px solid ${danger ? 'rgba(240,98,114,.45)' : 'rgba(245,181,74,.3)'}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 11, letterSpacing: '.22em', color: danger ? C.crit : C.warn, fontWeight: 700 }}>{danger ? 'AÇÃO DESTRUTIVA · NÃO DÁ PARA DESFAZER' : 'APROVAÇÃO NECESSÁRIA'}</span>
            <span className="app-mono" style={{ fontSize: 11, color: C.t3 }}>{relTime(a.createdAt)}</span>
          </div>
          <div style={{ fontSize: 17, lineHeight: 1.4 }}>{a.title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {a.rows.map((r) => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.06)', fontSize: 13 }}>
                <span style={{ color: C.t2 }}>{r.label}</span>
                <span className="app-mono" style={{ color: toneColor(r.tone), fontSize: 12, textAlign: 'right', wordBreak: 'break-word' }}>{r.value}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="app-btn" onClick={() => review(a.runId)}>Revisar</button>
            <span style={{ flex: 1 }} />
            <button className={danger ? 'app-btn' : 'app-btn danger'} style={{ minWidth: 120, height: 42 }} onClick={() => void decide(a.id, false)}>{danger ? 'Cancelar' : 'Rejeitar'}</button>
            <button style={{ minWidth: 140, height: 42, borderRadius: 12, border: 'none', background: danger ? '#e2566a' : 'linear-gradient(135deg,#4fe0b0,#67d8f2)', color: danger ? '#fff' : '#06221c', fontSize: 14, fontWeight: 700, cursor: 'pointer' }} onClick={() => void decide(a.id, true)}>
              {danger ? 'Excluir definitivamente' : 'Aprovar'}
            </button>
          </div>
        </section>
        )
      })}
      {others.map((ib) => (
        <button
          key={ib.id}
          onClick={() => ib.action.type === 'view' && useYui.getState().show(ib.action.view, ib.action.params ?? {})}
          className="app-row"
          style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px', borderRadius: 14, border: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.025)', color: C.text, textAlign: 'left', cursor: 'pointer' }}
        >
          <span style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: toneColor(ib.tone), fontWeight: 600 }}>{ib.tag}</span>
          <span style={{ fontSize: 14 }}>{ib.label}</span>
        </button>
      ))}
    </div>
  )
}
