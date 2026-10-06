import type { AgentInfo, MissionStep } from '@shared/protocol'
import { useYui } from '../store/yui'

// Etapa vazia nova (agente padrão = primeiro da lista).
export function blankStep(id: string, agents: AgentInfo[], dependsOn: string[] = []): MissionStep {
  const a = agents[0]
  return { id, title: 'Nova etapa', agentId: a?.id ?? '', agent: a?.name ?? '', instruction: '', dependsOn, risky: false, display: null, status: 'pending', runId: null, result: null }
}

export const say = (t: string) => useYui.getState().say(t)
