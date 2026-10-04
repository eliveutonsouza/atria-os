import { useYui } from '../../store/yui'
import { ToolsView } from '../../views/ToolsView'
import { useViewParams } from './common'

// Conectores, MCP, skills, plugins e apps (ToolsView) — aba vem de /app/tools/<aba>.
export function ToolsPage() {
  const tab = useYui((s) => s.appParams.id)
  useViewParams(tab ? { tab } : {})
  return <ToolsView />
}
