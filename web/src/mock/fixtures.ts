// Dados do design (Yui Console.dc.html) para validar paridade visual sem backend (VITE_MOCK=1).
import { greeting } from '../lib/format'
import type {
  AgentInfo, ArtifactInfo, Bootstrap, Brief, InfraPayload, LogsPayload, Overview, ProjectDetail, ReportPayload, RunInfo,
} from '@shared/protocol'

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString()

export const brief: Brief = {
  since: iso(600),
  kpis: [
    { value: '14', label: 'automações concluídas', tone: 'cyan' },
    { value: '8', label: 'leads qualificados', tone: 'lav' },
    { value: '3', label: 'deploys', tone: 'ok' },
    { value: '1', label: 'alerta', tone: 'warn' },
  ],
  lines: [
    { n: '14', text: 'rotinas foram executadas.', tone: 'cyan' },
    { n: '8', text: 'novos leads foram qualificados.', tone: 'lav' },
    { n: '3', text: 'deploys foram concluídos.', tone: 'ok' },
    { n: '1', text: 'projeto precisa da sua atenção.', tone: 'warn' },
  ],
  timeline: [
    { t: '02:00', label: 'Infra check', result: '✓', tone: 'ok' },
    { t: '03:30', label: 'Backup Postgres', result: '✓', tone: 'ok' },
    { t: '04:00', label: 'Repository review', result: '✓', tone: 'ok' },
    { t: '06:00', label: 'Security scan', result: '✓', tone: 'ok' },
    { t: '07:00', label: 'Lead research — 8 qualificados', result: '✓', tone: 'ok' },
    { t: '14:20', label: 'Deploy AutoComissão falhou', result: 'atenção', tone: 'warn' },
  ],
}

const projects = [
  { slug: 'autocomissao', name: 'AutoComissão', note: 'Deploy falhando desde 14:20', status: 'Atenção', tone: 'warn' as const, health: 71 },
  { slug: 'stoqmate', name: 'Stoqmate', note: '2 agentes trabalhando · deploy há 2h', status: 'Saudável', tone: 'ok' as const, health: 94 },
  { slug: 'clinica-sorriso', name: 'Clínica Sorriso', note: 'Site v1 em preview', status: 'Preview', tone: 'cyan' as const, health: 98 },
]

export const bootstrap: Bootstrap = {
  user: { name: 'Eliveuton' },
  activeProject: 'autocomissao',
  projects,
  agentsWorking: 4,
  inbox: [
    { id: 'i1', tag: 'Aprovação', label: 'Deploy de produção — AutoComissão', tone: 'warn', action: { type: 'approval', approvalId: 'ap1' } },
    { id: 'i2', tag: 'Segurança', label: 'Dependência com severidade alta — Stoqmate', tone: 'crit', action: { type: 'view', view: 'runs', params: { runId: 'r1' } } },
    { id: 'i3', tag: 'Artefato', label: 'Relatório “Status executivo” pronto', tone: 'ok', action: { type: 'view', view: 'report' } },
  ],
  history: [],
  greeting: { msg: `${greeting()} Enquanto você esteve fora:`, showBrief: true, brief },
  status: { claude: true, openai: true, live: false },
}

export const overview: Overview = {
  agentsTotal: 52,
  agentsActive: 4,
  runsToday: 186,
  successRate: 96,
  bars24h: [12, 8, 5, 4, 3, 6, 14, 22, 30, 41, 38, 35, 44, 52, 47, 39, 33, 28, 24, 30, 26, 18, 14, 10],
  success30d: [92, 94, 93, 95, 96, 94, 97, 96, 95, 93, 94, 96, 97, 98, 96, 95, 97, 96, 94, 89, 92, 95, 96, 97, 96, 98, 97, 96, 95, 96],
  projects,
}

const A = (id: string, name: string, group: string, status: AgentInfo['status'], task: string | null, last: number | null, next: string): AgentInfo => ({
  id, name, group, status, task, lastActivity: last == null ? null : iso(last), nextWake: next,
})
export const agents: AgentInfo[] = [
  A('backend', 'Backend', 'Engineering', 'sleeping', null, 180, 'sob demanda'),
  A('frontend', 'Frontend', 'Engineering', 'sleeping', null, 60, 'sob demanda'),
  A('security', 'Security', 'Engineering', 'running', 'Revisando PR #482', 0, '—'),
  A('qa', 'QA', 'Engineering', 'waiting', 'Aguardando Backend', 20, 'em espera'),
  A('devops', 'DevOps', 'Operações', 'running', 'Deployment watch', 0, '02:13'),
  A('infra', 'Infra', 'Operações', 'sleeping', null, 240, '18:00'),
  A('backup', 'Backup', 'Operações', 'sleeping', null, 700, '03:30'),
  A('research', 'Research', 'Growth', 'running', 'Qualificando leads', 0, '—'),
  A('copy', 'Copy', 'Growth', 'sleeping', null, 1500, 'sob demanda'),
  A('report', 'Report', 'Growth', 'sleeping', null, 400, 'seg 08:00'),
]

const R = (p: Partial<RunInfo> & Pick<RunInfo, 'id' | 'agent' | 'task' | 'state'>): RunInfo => ({
  agentId: p.agent.toLowerCase().split(' ')[0], project: null, progress: 0, currentOp: null, tools: [], steps: [], startedAt: null, finishedAt: null,
  result: null, sessionId: '7f3a-91c2', tokensIn: 48200, tokensOut: 6100, costUsd: 0, ...p,
})
export const runs: RunInfo[] = [
  R({ id: 'r1', agent: 'Security Agent', task: 'Revisando alterações do PR #482 — Stoqmate', state: 'running', progress: 62, startedAt: iso(1.2), currentOp: 'Analisando src/auth/session.ts', tools: ['GitHub MCP', 'Read', 'Semgrep'], steps: [{ label: 'Diff carregado', status: 'done' }, { label: 'Dependências verificadas', status: 'done' }, { label: 'Revisando autenticação', status: 'active' }, { label: 'Relatório', status: 'pending' }] }),
  R({ id: 'r2', agent: 'Research Agent', task: 'Qualificando leads — clínicas odontológicas', state: 'running', progress: 38, startedAt: iso(4.5), currentOp: 'Pesquisando 26 empresas', tools: ['Web search', 'Browser', 'CRM MCP'], steps: [{ label: 'Fontes coletadas', status: 'done' }, { label: 'Qualificando', status: 'active' }, { label: 'Scoring', status: 'pending' }] }),
  R({ id: 'r3', agent: 'DevOps Agent', task: 'Deployment watch — produção', state: 'running', progress: 80, startedAt: iso(2.2), currentOp: 'Próxima verificação em 02:13', tools: ['Docker', 'Bash'], steps: [{ label: 'Containers: 21 saudáveis', status: 'done' }, { label: 'Aguardando próximo ciclo', status: 'active' }] }),
  R({ id: 'r4', agent: 'QA Agent', task: 'Aguardando Backend Agent', state: 'queued', currentOp: 'Suite de regressão AutoComissão', tools: ['Playwright', 'Bash'], steps: [{ label: 'Depende de Backend Agent', status: 'pending' }] }),
]

export const projectDetails: Record<string, ProjectDetail> = {
  autocomissao: {
    ...projects[0], issue: 'Deploy falhando durante a migration 0042 — 3 tentativas desde 14:20.', hasPreview: false, hasLogs: true,
    kpis: [{ label: 'Saúde', value: '71%', tone: 'warn' }, { label: 'Produção', value: 'Deploy falhando', tone: 'warn' }, { label: 'Agentes', value: '1 monitorando' }, { label: 'Último deploy', value: 'falhou 14:20' }],
    activity: [
      { t: '14:31', label: 'Deploy falhou — tentativa 3', tone: 'warn' }, { t: '14:24', label: 'Deploy falhou — tentativa 2', tone: 'warn' },
      { t: '14:20', label: 'Deploy iniciado por DevOps Agent', tone: 'muted' }, { t: '13:55', label: 'PR #88 mesclado — novo cálculo de comissões', tone: 'muted' },
    ],
  },
  stoqmate: {
    ...projects[1], issue: null, hasPreview: true, hasLogs: true,
    kpis: [{ label: 'Saúde', value: '94%', tone: 'ok' }, { label: 'Produção', value: 'Saudável' }, { label: 'Agentes', value: '2 trabalhando' }, { label: 'Último deploy', value: 'há 2h' }],
    activity: [
      { t: '13:02', label: 'Deploy v2.14.0 concluído', tone: 'ok' }, { t: '11:40', label: 'Security Agent revisou PR #219', tone: 'cyan' },
      { t: '09:00', label: 'Repository review — 0 problemas', tone: 'ok' }, { t: '06:00', label: 'Backup diário concluído', tone: 'ok' },
    ],
  },
  'clinica-sorriso': {
    ...projects[2], issue: null, hasPreview: true, hasLogs: false, previewUrl: 'mock:clinic',
    kpis: [{ label: 'Saúde', value: '98%', tone: 'ok' }, { label: 'Produção', value: 'Preview' }, { label: 'Agentes', value: '0 trabalhando' }, { label: 'Último deploy', value: '—' }],
    activity: [{ t: '10:12', label: 'Frontend Agent publicou v1 em preview', tone: 'cyan' }],
  },
}

export const logs: LogsPayload = {
  project: 'autocomissao',
  source: 'autocomissao-api',
  summary: 'A migration 0042 cria uma coluna NOT NULL sem valor padrão. Produção continua servindo a v1.8.2 — sem impacto para usuários.',
  lines: [
    { t: '14:31:02', level: 'INFO', msg: 'deploy autocomissao-api@a41f9c started' },
    { t: '14:31:09', level: 'INFO', msg: 'running migrations (3 pending)' },
    { t: '14:31:10', level: 'INFO', msg: '0041_add_index_vendas … ok' },
    { t: '14:31:11', level: 'ERROR', msg: '0042_comissoes: column "regra_id" contains null values' },
    { t: '14:31:11', level: 'ERROR', msg: 'ALTER TABLE comissoes ADD COLUMN regra_id INT NOT NULL' },
    { t: '14:31:11', level: 'WARN', msg: 'transaction rolled back' },
    { t: '14:31:12', level: 'ERROR', msg: 'deploy failed (attempt 3/3)' },
    { t: '14:31:12', level: 'INFO', msg: 'previous release v1.8.2 still serving traffic' },
  ],
}

export const report: ReportPayload = {
  id: 'rep1',
  generatedBy: 'Report Agent',
  generatedAt: iso(300),
  title: 'Status executivo — Semana 40',
  lead: 'Semana estável, com 96% de sucesso nas execuções. Um incidente de deploy no AutoComissão concentrou o risco operacional; a prospecção superou a meta em 30%.',
  kpis: [{ value: '412', label: 'execuções' }, { value: '96%', label: 'sucesso' }, { value: '63h', label: 'trabalho de agentes' }, { value: '17', label: 'falhas' }],
  sections: [
    { heading: 'Destaques', tone: 'cyan', items: ['Prospecção: 26 empresas pesquisadas, 9 qualificadas com score acima de 80.', 'Stoqmate: três deploys sem incidentes; cobertura de testes subiu para 84%.'] },
    { heading: 'Riscos', tone: 'warn', items: ['AutoComissão: migration 0042 bloqueou o deploy por mais de duas horas.', 'Dependência com severidade alta no Stoqmate aguarda revisão.'] },
    { heading: 'Próximas ações', tone: 'ok', items: ['Adicionar validação de migrations no pipeline de CI.', 'Gerar demonstrações para os 3 leads de maior oportunidade.'] },
  ],
}

export const infra: InfraPayload = {
  cpu: 32, ram: 54, disk: 41, load: [1.21, 1.05, 0.98],
  containers: [
    { name: 'yui-console', state: 'running', health: 'healthy', tone: 'ok' },
    { name: 'traefik', state: 'running', health: null, tone: 'ok' },
    { name: 'autocomissao-api', state: 'restarting', health: 'unhealthy', tone: 'warn' },
    { name: 'stoqmate-web', state: 'running', health: 'healthy', tone: 'ok' },
  ],
}

export const artifacts: ArtifactInfo[] = [
  { id: 'site1', kind: 'website', title: 'Clínica Sorriso — v1', project: 'clinica-sorriso', createdAt: iso(200), url: 'mock:clinic' },
  { id: 'rep1', kind: 'report', title: 'Status executivo — Semana 40', project: null, createdAt: iso(300), url: null },
]
