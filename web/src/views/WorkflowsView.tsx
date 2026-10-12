import { useState } from 'react'
import '../workflow/workflow.css'
import type { WorkflowDef, WorkflowRunInfo } from '@shared/protocol'
import { useApi } from '../api/useApi'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { describeCron, send } from '../workflow/http'
import { DeleteWorkflowModal } from '../workflow/DeleteWorkflow'
import { TYPE_META } from '../workflow/StepNode'
import { Empty, ErrorNote, Skeleton, useHeader } from './ui'

// Lista de workflows: gatilho, time, última execução; abrir/rodar/agendar/criar (inclusive pedindo à Yui).

type Row = WorkflowDef & { lastRun: WorkflowRunInfo | null; routines: { id: string; name: string; cron: string; enabled: boolean }[] }

const PLURAL = { task: 'tarefas', decision: 'decisões', approval: 'aprovações' } as const

const RUN_C: Record<string, string> = { running: C.cyan, waiting_approval: C.warn, waiting_input: C.cyan, done: C.ok, failed: C.crit, cancelled: C.t3 }
const RUN_T: Record<string, string> = { running: 'rodando', waiting_approval: 'aguardando aprovação', waiting_input: 'esperando sua resposta', done: 'concluído', failed: 'falhou', cancelled: 'cancelado' }

export function WorkflowsView() {
  const { data, loading, error, reload } = useApi<Row[]>('/api/workflows', [], 8000)
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState<Row | null>(null)
  const show = useYui.getState().show
  const say = useYui.getState().say
  const phone = useYui((s) => s.device === 'phone')

  useHeader('Automações', 'Workflows', [
    { label: '+ Novo workflow', fn: () => show('workflow'), primary: true },
    { label: 'Rotinas agendadas', fn: () => show('routines') },
  ])

  const generate = async () => {
    if (!ask.trim()) return
    setBusy(true)
    say('Desenhando o workflow com os agentes certos…')
    try {
      const w = await send<WorkflowDef>('POST', '/api/workflows/generate', { descricao: ask.trim() })
      setAsk('')
      show('workflow', { workflowId: w.slug })
    } catch (e) {
      say(`Não consegui criar: ${(e as Error).message}.`)
    } finally {
      setBusy(false)
    }
  }

  const [starting, setStarting] = useState<string | null>(null)
  const run = async (w: Row) => {
    if (starting) return
    setStarting(w.slug)
    try {
      const r = await send<WorkflowRunInfo>('POST', `/api/workflows/${encodeURIComponent(w.slug)}/run`, {})
      useYui.getState().set({ workflowRuns: { ...useYui.getState().workflowRuns, [r.id]: r } })
      show('workflow', { workflowId: w.slug, workflowRunId: r.id })
    } catch (e) {
      say(`Não consegui rodar "${w.name}": ${(e as Error).message}.`)
      reload()
    } finally {
      setStarting(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <textarea
          className="wf-input"
          rows={2}
          aria-label="Descreva o workflow para a Yui criar"
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generate()
          }}
          placeholder="Descreva uma rotina de trabalho e a Yui desenha o workflow. Ex.: “toda segunda, pesquisar tendências, escrever post pro Instagram, pedir minha aprovação e publicar”."
          style={{ flex: '1 1 420px' }}
        />
        <button className="wf-btn primary" disabled={busy || !ask.trim()} onClick={() => void generate()} style={{ height: 'auto', minHeight: 44, padding: '0 18px' }}>
          {busy ? 'Criando…' : 'Criar com a Yui'}
        </button>
      </div>

      {loading && !data ? (
        <Skeleton kpis={0} rows={4} />
      ) : error || !data ? (
        <ErrorNote text="Não consegui listar os workflows." />
      ) : !data.length ? (
        <Empty text="Ainda não há workflows." hint="Descreva uma rotina acima ou crie um do zero." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(300px,100%),1fr))', gap: 14 }}>
          {data.map((w) => {
            const last = w.lastRun
            const counts = w.nodes.reduce<Record<string, number>>((acc, n) => ({ ...acc, [n.type]: (acc[n.type] ?? 0) + 1 }), {})
            return (
              <div key={w.slug} style={{ padding: '18px 20px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <button onClick={() => show('workflow', { workflowId: w.slug })} style={{ border: 'none', background: 'transparent', color: C.text, padding: 0, textAlign: 'left', cursor: 'pointer' }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{w.name}</div>
                    <div style={{ fontSize: 12, color: C.t3, marginTop: 2 }} className="mono">{w.slug}</div>
                  </button>
                  <span style={{ fontSize: 12, color: w.trigger.type === 'cron' ? C.cyan : C.t3, whiteSpace: 'nowrap' }}>{describeCron(w.trigger.type === 'cron' ? w.trigger.cron : null)}</span>
                </div>
                {w.description && <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.5 }}>{w.description}</div>}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: C.t2 }}>
                  {(['task', 'decision', 'approval'] as const).map((t) =>
                    counts[t] ? (
                      <span key={t}>
                        <span style={{ color: TYPE_META[t].color }}>{TYPE_META[t].icon}</span> {counts[t]} {counts[t] > 1 ? PLURAL[t] : TYPE_META[t].label.toLowerCase()}
                      </span>
                    ) : null,
                  )}
                </div>
                {w.team.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {w.team.map((a) => (
                      <span key={a} style={{ fontSize: 11.5, padding: '3px 9px', borderRadius: 8, background: 'rgba(103,216,242,.08)', border: '1px solid rgba(103,216,242,.18)', color: C.cyanSoft }}>
                        {a}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 12, color: C.t3 }}>
                  Última execução:{' '}
                  {last ? (
                    <span style={{ color: RUN_C[last.status] }}>
                      {RUN_T[last.status]} · {new Date(last.startedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  ) : (
                    'nunca'
                  )}
                </div>
                {phone ? (
                  // celular: grade de alvos de 44px, lixeira como ícone
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr)) 44px', gap: 6, marginTop: 'auto' }}>
                    <button className="wf-btn" onClick={() => show('workflow', { workflowId: w.slug })}>Abrir</button>
                    <button className="wf-btn" disabled={starting === w.slug} onClick={() => void run(w)}>{starting === w.slug ? 'Iniciando…' : 'Rodar'}</button>
                    <button className="wf-btn ghost" onClick={() => show('workflow', { workflowId: w.slug })}>Agendar</button>
                    <button className="wf-btn ghost" onClick={() => setDel(w)} aria-label={`Remover workflow ${w.name}`} style={{ color: C.critSoft, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                    <button className="wf-btn" onClick={() => show('workflow', { workflowId: w.slug })}>Abrir</button>
                    <button className="wf-btn" disabled={starting === w.slug} onClick={() => void run(w)}>{starting === w.slug ? 'Iniciando…' : 'Rodar'}</button>
                    <button className="wf-btn ghost" onClick={() => show('workflow', { workflowId: w.slug })} title="Abra e use Agendar">
                      Agendar
                    </button>
                    <button className="wf-btn ghost" onClick={() => setDel(w)} aria-label={`Remover workflow ${w.name}`} style={{ color: C.critSoft, marginLeft: 'auto' }}>
                      Remover
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {del && (
        <DeleteWorkflowModal
          slug={del.slug}
          name={del.name}
          rows={[
            { label: 'Passos', value: String(del.nodes.length) },
            { label: 'Rotinas agendadas', value: del.routines.length ? del.routines.map((r) => r.cron).join(', ') : 'nenhuma' },
            ...(del.lastRun && (del.lastRun.status === 'running' || del.lastRun.status === 'waiting_approval' || del.lastRun.status === 'waiting_input') ? [{ label: 'Em execução agora', value: 'será interrompida' }] : []),
          ]}
          onClose={() => setDel(null)}
          onDeleted={() => {
            setDel(null)
            reload()
          }}
        />
      )}
    </div>
  )
}
