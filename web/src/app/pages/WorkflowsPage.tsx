import { useEffect, useState } from 'react'
import { useYui } from '../../store/yui'
import { WorkflowsView } from '../../views/WorkflowsView'
import { WorkflowView } from '../../views/WorkflowView'
import { ErrorNote, Skeleton } from '../../views/ui'
import { fetchInput, openInputRequest } from '../../workflow/inputs'
import { useViewParams } from './common'

// Workflows: lista (WorkflowsView) ou editor de fluxograma ⇄ markdown (WorkflowView) em página cheia.
// /app/workflows/pedido/<id> (link dos avisos): abre a execução do pedido com o formulário por cima.
export function WorkflowsPage() {
  const id = useYui((s) => s.appParams.id)
  const sub = useYui((s) => s.appParams.sub)
  if (id === 'pedido' && sub) return <RequestRoute requestId={sub} />
  return <WorkflowsBody id={id} />
}

function WorkflowsBody({ id }: { id: string | undefined }) {
  const run = useYui((s) => s.viewParams.workflowRunId)
  const device = useYui((s) => s.device)
  useViewParams(id && id !== 'new' ? { workflowId: id, ...(run ? { workflowRunId: run } : {}) } : {})
  if (!id) return <WorkflowsView />
  return (
    <div style={{ flex: 1, minHeight: device === 'phone' ? undefined : device === 'tablet' ? 480 : 560, display: 'flex', flexDirection: 'column' }}>
      <WorkflowView />
    </div>
  )
}

function RequestRoute({ requestId }: { requestId: string }) {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let alive = true
    void fetchInput(requestId).then((r) => {
      if (!alive) return
      if (!r) return setMissing(true)
      // a página vira a execução do workflow; o formulário abre por cima e, ao fechar, fica a execução
      useYui.getState().set({ appParams: { id: r.workflow }, viewParams: { workflowId: r.workflow, workflowRunId: r.runId } })
      if (r.status === 'pending' || r.status === 'processing') openInputRequest(r.id)
      else useYui.getState().say(r.status === 'done' ? 'Esse pedido já foi respondido — abri a execução.' : 'Esse pedido não está mais aberto — abri a execução.')
    })
    return () => {
      alive = false
    }
  }, [requestId])
  if (missing) return <ErrorNote text="Não encontrei esse pedido — talvez a execução tenha sido apagada." />
  return <Skeleton kpis={0} rows={5} />
}
