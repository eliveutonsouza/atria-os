import { useYui } from '../../store/yui'
import { WorkflowsView } from '../../views/WorkflowsView'
import { WorkflowView } from '../../views/WorkflowView'
import { useViewParams } from './common'

// Workflows: lista (WorkflowsView) ou editor de fluxograma ⇄ markdown (WorkflowView) em página cheia.
export function WorkflowsPage() {
  const id = useYui((s) => s.appParams.id)
  const run = useYui((s) => s.viewParams.workflowRunId)
  useViewParams(id && id !== 'new' ? { workflowId: id, ...(run ? { workflowRunId: run } : {}) } : {})
  if (!id) return <WorkflowsView />
  return (
    <div style={{ flex: 1, minHeight: 560, display: 'flex', flexDirection: 'column' }}>
      <WorkflowView />
    </div>
  )
}
