// Backend simulado para VITE_MOCK=1: responde endpoints com fixtures e roteia o chat como o design.
import type { ServerEvent, ViewName, ViewParams } from '@shared/protocol'
import { applyEvent } from '../api/events'
import * as F from './fixtures'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const emit = (ev: ServerEvent) => applyEvent(ev)

function sayThen(text: string, view?: ViewName, params?: ViewParams, pend?: ViewName) {
  emit({ type: 'yui.state', state: 'thinking' })
  setTimeout(() => {
    emit({ type: 'yui.state', state: 'speaking' })
    emit({ type: 'yui.say', text, final: true })
    if (pend) emit({ type: 'ui.action', action: { type: 'suggest_view', view: pend } })
    setTimeout(() => {
      if (view) emit({ type: 'ui.action', action: { type: 'show_view', view, params } })
      else emit({ type: 'yui.state', state: 'idle' })
    }, 1100)
  }, 600)
}

function route(raw: string) {
  const t = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (/\b(volta|voltar|fecha|fechar|sair)\b/.test(t)) return sayThen('Pronto. O que vamos fazer agora?')
  if (/meus projetos|como estao/.test(t)) return sayThen('Stoqmate e Clínica Sorriso estão saudáveis. O AutoComissão está com o deploy falhando desde 14:20.', undefined, undefined, 'dashboard')
  if (/o que aconteceu|por que|porque/.test(t)) return sayThen('A migration 0042 cria uma coluna NOT NULL sem valor padrão na tabela comissoes. O deploy falhou nas três tentativas.', undefined, undefined, 'logs')
  if (/problema|autocomiss/.test(t)) return sayThen('Abrindo o AutoComissão. O deploy está falhando durante a migration.', 'project', { project: 'autocomissao' })
  if (/stoqmate/.test(t)) return sayThen('Abrindo o Stoqmate.', 'project', { project: 'stoqmate' })
  if (/dashboard|painel|visao geral/.test(t)) return sayThen('Aqui está a visão geral.', 'dashboard')
  if (/agente|quem esta trabalhando/.test(t)) return sayThen('4 agentes estão trabalhando agora.', 'agents')
  if (/execu|acontecendo|agora|runs/.test(t)) return sayThen('Estas são as operações em andamento.', 'runs')
  if (/erro|log/.test(t)) return sayThen('Estes são os logs do autocomissao-api.', 'logs', { project: 'autocomissao' })
  if (/relat|report/.test(t)) return sayThen('O relatório semanal está pronto.', 'report')
  if (/site|preview|clinica/.test(t)) return sayThen('A primeira versão do site está em preview. Clique em qualquer seção para me dar contexto.', 'website', { project: 'clinica-sorriso' })
  if (/vps|infra|servidor/.test(t)) return sayThen('Sua VPS está estável.', 'infra')
  if (/brief|noite|resumo/.test(t)) return sayThen('Aqui está o que aconteceu enquanto você esteve fora.', 'brief')
  if (/aprov|deploy/.test(t)) {
    emit({ type: 'approval.requested', approval: approval() })
    sayThen('O DevOps quer publicar o AutoComissão. Revise antes de aprovar.')
    setTimeout(() => emit({ type: 'ui.action', action: { type: 'open_approval', approvalId: 'ap1' } }), 1800)
    return
  }
  sayThen('Entendi. Vou estruturar isso e acionar os agentes certos — te aviso quando houver algo para ver.')
}

const approval = () => ({
  id: 'ap1', runId: 'r3', title: 'DevOps quer publicar o AutoComissão em produção.', createdAt: new Date().toISOString(),
  rows: [{ label: 'Arquivos alterados', value: '16' }, { label: 'Testes', value: '118/124 passando', tone: 'warn' as const }, { label: 'Segurança', value: 'Aprovado', tone: 'ok' as const }],
})

let seeded = false
export async function mockRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  await wait(120)
  if (!seeded) {
    seeded = true
    setTimeout(() => emit({ type: 'approval.requested', approval: approval() }), 50)
  }
  const p = path.replace(/\?.*$/, '')
  if (method === 'POST') {
    if (p === '/api/chat') route((body as { text: string }).text)
    if (p.startsWith('/api/approvals/')) {
      const ok = (body as { approve: boolean }).approve
      emit({ type: 'approval.resolved', approvalId: 'ap1', approved: ok })
      sayThen(ok ? 'Deploy aprovado, mas os testes ainda falham — pedi ao DevOps para aguardar a correção.' : 'Deploy rejeitado. As alterações ficam na branch.')
    }
    if (p === '/api/runs') {
      const run = { ...F.runs[0], id: `m${Date.now()}`, agent: 'Backend Agent', task: (body as { instruction: string }).instruction, startedAt: new Date().toISOString(), progress: 5, steps: [{ label: 'Repositório carregado', status: 'active' as const }] }
      return run as T
    }
    return undefined as T
  }
  const seg = p.split('/').filter(Boolean)
  switch (true) {
    case p === '/api/bootstrap': return F.bootstrap as T
    case p === '/api/overview': return F.overview as T
    case p === '/api/brief': return F.brief as T
    case p === '/api/agents': return F.agents as T
    case p === '/api/runs': return { running: 3, queued: 1, background: 14, runs: F.runs } as T
    case seg[1] === 'runs' && seg[3] === 'events':
      return [
        { t: '', kind: 'system', text: '$ git checkout -b fix/migration-0042' },
        { t: '', kind: 'tool', text: 'Read migrations/0042_comissoes.sql' },
        { t: '', kind: 'tool', text: 'Edit +3 −1 migrations/0042_comissoes.sql' },
        { t: '', kind: 'tool', text: '$ npm test -- --filter comissoes' },
      ] as T
    case seg[1] === 'projects' && seg[3] === 'logs': return F.logs as T
    case seg[1] === 'projects' && !!seg[2]: {
      const d = F.projectDetails[seg[2]]
      if (!d) throw new Error('not found')
      return d as T
    }
    case p === '/api/reports/latest': return F.report as T
    case p === '/api/infra': return F.infra as T
    case p === '/api/artifacts': return F.artifacts as T
  }
  throw new Error(`mock: ${method} ${path}`)
}
