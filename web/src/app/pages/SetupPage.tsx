import { useYui } from '../../store/yui'
import { SetupSteps, useSetupStatus } from './settings/sections'

// "Primeiros passos" reutilizável: card com o progresso da instalação (Claude, OpenAI, GitHub, app).
// `compact` esconde o card quando o essencial já está pronto — para usar em telas como a Visão geral.
export function SetupPage({ compact = false }: { compact?: boolean }) {
  const { st } = useSetupStatus()
  if (compact && (!st || st.completed)) return null
  return <SetupSteps onGo={(tab) => useYui.getState().set({ shellMode: 'app', appPage: 'settings', appParams: { id: tab } })} />
}
