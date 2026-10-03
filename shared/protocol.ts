// Contrato server <-> web. Mantido sem dependências para ser importado pelos dois lados.

export type YuiState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'delegating'
  | 'working'
  | 'speaking'
  | 'showing'
  | 'warning'
  | 'success';

export type ViewName =
  | 'brief'
  | 'dashboard'
  | 'agents'
  | 'runs'
  | 'project'
  | 'logs'
  | 'report'
  | 'website'
  | 'infra'
  | 'artifact'
  | 'terminal'
  | 'mission'
  | 'custom'
  | 'tools'
  | 'agent'
  | 'workflow'
  | 'workflows'
  | 'routines'
  | 'claude';

export const VIEW_NAMES: ViewName[] = [
  'brief',
  'dashboard',
  'agents',
  'runs',
  'project',
  'logs',
  'report',
  'website',
  'infra',
  'artifact',
  'terminal',
  'mission',
  'custom',
  'tools',
  'agent',
  'workflow',
  'workflows',
  'routines',
  'claude',
];

export interface ViewParams {
  project?: string; // slug
  runId?: string;
  artifactId?: string;
  kind?: 'claude' | 'shell'; // view terminal
  missionId?: string;
  customId?: string;
  agentId?: string;
  workflowId?: string; // slug
  workflowRunId?: string;
  tab?: string; // aba interna (tools: connectors|mcp|skills|plugins|apps)
}

export type Tone = 'ok' | 'warn' | 'crit' | 'cyan' | 'lav' | 'muted';

// ---------- entidades ----------

export interface ProjectSummary {
  slug: string;
  name: string;
  note: string; // linha secundária ("2 agentes trabalhando · deploy há 2h")
  status: string; // "Saudável" | "Atenção" | "Preview" ...
  tone: Tone;
  health: number | null; // 0-100
}

export interface ProjectDetail extends ProjectSummary {
  issue: string | null;
  kpis: { label: string; value: string; tone?: Tone }[];
  activity: { t: string; label: string; tone: Tone }[];
  hasPreview: boolean;
  previewUrl?: string | null; // /sandbox/<token>/<slug>/ quando hasPreview
  hasLogs: boolean;
}

export type AgentStatus = 'running' | 'waiting' | 'sleeping';

export interface AgentInfo {
  id: string; // slug do arquivo .md
  name: string;
  group: string; // Engineering | Operações | Growth ...
  status: AgentStatus;
  task: string | null;
  lastActivity: string | null; // ISO
  nextWake: string | null; // texto livre ("sob demanda", "18:00")
}

export type RunState = 'queued' | 'running' | 'waiting_approval' | 'done' | 'failed' | 'cancelled';

export interface RunStep {
  label: string;
  status: 'done' | 'active' | 'pending';
}

export interface RunInfo {
  id: string;
  agent: string; // nome do agente
  agentId: string;
  project: string | null; // slug
  task: string; // instrução resumida
  state: RunState;
  progress: number; // 0-100
  currentOp: string | null;
  tools: string[];
  steps: RunStep[];
  startedAt: string | null;
  finishedAt: string | null;
  result: string | null;
  sessionId: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface RunEventLine {
  t: string; // ISO
  kind: 'text' | 'tool' | 'result' | 'error' | 'system';
  text: string;
}

export interface ApprovalInfo {
  id: string;
  runId: string;
  title: string; // "DevOps quer publicar o AutoComissão em produção."
  rows: { label: string; value: string; tone?: Tone }[];
  createdAt: string;
}

export interface InboxItem {
  id: string;
  tag: string;
  label: string;
  tone: Tone;
  action: { type: 'approval'; approvalId: string } | { type: 'view'; view: ViewName; params?: ViewParams };
}

export interface ChatMessage {
  id: string;
  who: 'user' | 'yui';
  text: string;
  at: string;
}

export interface Overview {
  agentsTotal: number;
  agentsActive: number;
  runsToday: number;
  successRate: number | null; // 0-100
  bars24h: number[]; // 24 posições, execuções por hora (índice 23 = hora atual)
  success30d: (number | null)[]; // 30 posições, % sucesso por dia
  projects: ProjectSummary[];
}

export interface Brief {
  since: string | null;
  kpis: { value: string; label: string; tone: Tone }[];
  lines: { n: string; text: string; tone: Tone }[];
  timeline: { t: string; label: string; result: string; tone: Tone }[];
}

export interface LogsPayload {
  project: string;
  source: string; // nome do container
  summary: string | null;
  lines: { t: string; level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'; msg: string }[];
}

export interface ReportPayload {
  id: string;
  generatedBy: string;
  generatedAt: string;
  title: string;
  lead: string;
  kpis: { value: string; label: string }[];
  sections: { heading: string; tone: Tone; items: string[] }[];
}

export interface InfraPayload {
  cpu: number | null; // %
  ram: number | null; // %
  disk: number | null; // %
  load: number[];
  containers: { name: string; state: string; health: string | null; tone: Tone }[];
}

export interface ArtifactInfo {
  id: string;
  kind: 'website' | 'report' | 'chart' | 'table' | 'html' | 'image' | 'other';
  title: string;
  project: string | null;
  createdAt: string;
  url: string | null; // /sandbox/<id>/ para html/website
}

export interface Bootstrap {
  user: { name: string };
  activeProject: string | null;
  projects: ProjectSummary[];
  agentsWorking: number;
  inbox: InboxItem[];
  history: ChatMessage[];
  greeting: { msg: string; showBrief: boolean; brief: Brief | null };
  status: { claude: boolean; openai: boolean; live: boolean; claudeAuth?: 'claude.ai' | 'token' | 'none'; github?: boolean; repos?: number };
}

// ---------- eventos SSE (/api/events) ----------

export type UiAction =
  | { type: 'show_view'; view: ViewName; params?: ViewParams }
  | { type: 'close_canvas' }
  | { type: 'set_focus'; on: boolean }
  | { type: 'suggest_view'; view: ViewName; params?: ViewParams; label?: string }
  | { type: 'switch_project'; project: string; name: string }
  | { type: 'open_approval'; approvalId: string };

export type ServerEvent =
  | { type: 'yui.state'; state: YuiState }
  | { type: 'yui.say'; text: string; final: boolean } // texto da Yui (msg central + histórico quando final)
  | { type: 'user.said'; text: string; final: boolean } // transcrição da voz do usuário
  | { type: 'ui.action'; action: UiAction }
  | { type: 'run.updated'; run: RunInfo }
  | { type: 'agents.updated'; agentsWorking: number }
  | { type: 'approval.requested'; approval: ApprovalInfo }
  | { type: 'approval.resolved'; approvalId: string; approved: boolean }
  | { type: 'inbox.updated'; inbox: InboxItem[] }
  | { type: 'artifact.created'; artifact: ArtifactInfo }
  | { type: 'live.status'; active: boolean; muted: boolean }
  | { type: 'mission.updated'; mission: MissionInfo }
  | { type: 'workflow.run.updated'; run: WorkflowRunInfo }
  | { type: 'custom.created'; view: CustomViewInfo }
  | { type: 'ping' };

// ---------- REST ----------
// POST /api/auth/login {password}          -> 204 (cookie)
// POST /api/auth/logout                    -> 204
// GET  /api/bootstrap                      -> Bootstrap
// POST /api/chat {text, context}           -> 202 (respostas chegam por SSE)
// POST /api/context {view, params, selectedElement} -> 204 (UI context p/ Yui)
// POST /api/live/session {sdp}             -> {sdp, sessionId}
// POST /api/live/end                       -> 204
// GET  /api/overview                       -> Overview
// GET  /api/brief                          -> Brief
// GET  /api/agents                         -> AgentInfo[]
// GET  /api/runs                           -> {running, queued, background, runs: RunInfo[]}
// GET  /api/runs/:id/events                -> RunEventLine[]
// GET  /api/projects/:slug                 -> ProjectDetail
// GET  /api/projects/:slug/logs            -> LogsPayload
// GET  /api/reports/latest                 -> ReportPayload | 404
// GET  /api/infra                          -> InfraPayload
// GET  /api/repos                          -> RepoInfo[]
// GET  /api/capabilities                   -> {mcp, plugins} do último run
// GET  /api/artifacts                      -> ArtifactInfo[]
// POST /api/approvals/:id {approve:boolean}-> 204
// POST /api/runs {agentId, project, instruction} -> RunInfo  (ação manual "Pedir correção")

export interface ChatContext {
  view: ViewName | null;
  params?: ViewParams;
  selectedElement?: string | null;
  mode: 'center' | 'canvas' | 'focus';
}

export interface RepoInfo {
  slug: string;
  nameWithOwner: string;
  description: string | null;
  language: string | null;
  pushedAt: string | null;
  archived: boolean;
  cloned: boolean;
}

// ---------- missões (plano de execução multi-agente) ----------
export type StepStatus = 'pending' | 'waiting_approval' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';
export interface MissionStep {
  id: string;
  title: string;
  agentId: string;
  agent: string;
  instruction: string;
  dependsOn: string[];
  risky: boolean;
  display: 'blocks' | 'html' | null;
  status: StepStatus;
  runId: string | null;
  result: string | null;
}
export interface MissionInfo {
  id: string;
  title: string;
  goal: string;
  project: string | null;
  status: 'running' | 'paused' | 'blocked' | 'done' | 'failed' | 'cancelled';
  steps: MissionStep[];
  createdAt: string;
  finishedAt: string | null;
}

// ---------- telas sob medida ----------
export type Block =
  | { type: 'kpis'; items: { label: string; value: string; tone?: Tone }[] }
  | { type: 'chart'; chart: 'bar' | 'line' | 'area' | 'pie'; title?: string; labels: string[]; series: { name: string; values: number[] }[] }
  | { type: 'table'; title?: string; columns: string[]; rows: (string | number | null)[][] }
  | { type: 'list'; title?: string; items: { title: string; subtitle?: string; meta?: string; tone?: Tone; href?: string }[] }
  | { type: 'markdown'; text: string }
  | { type: 'timeline'; title?: string; items: { t: string; label: string; tone?: Tone }[] }
  | { type: 'image'; src: string; alt?: string }
  | { type: 'html'; url: string; height?: number }
  | { type: 'link'; label: string; href: string };
export interface CustomViewSpec {
  title: string;
  eyebrow?: string;
  blocks: Block[];
}
export interface CustomViewInfo {
  id: string;
  title: string;
  spec: CustomViewSpec;
  source: string; // 'yui' | runId
  createdAt: string;
}

// ---------- caixa de ferramentas / capacidades ----------
export type ToolStatus = 'ok' | 'warn' | 'needs-auth' | 'down' | 'unknown';
export interface ToolboxItem {
  id: string;
  name: string;
  category: string; // Comunicação, Agenda, Código, Design, Deploy, Dados, CRM, Conteúdo, Pesquisa, Infra…
  purpose: string;
  access: { type: 'mcp' | 'cli' | 'url' | 'stack' | 'repo' | 'skill' | 'plugin' | 'browser'; ref: string };
  agent: string | null; // agente padrão
  examples: string[];
  status: ToolStatus;
  note?: string;
}
export interface ClaudeInitInfo {
  at: string;
  model: string;
  tools: string[];
  mcp: { name: string; status: string; source?: string }[];
  skills: string[];
  slashCommands: string[];
  plugins: { name: string; path: string; version?: string }[];
  agents: string[];
}

// ---------- agentes configuráveis ----------
export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  group: string;
  prompt: string;
  model: string | null;
  maxTurns: number | null;
  skills: string[]; // vazio = todas
  mcp: string[]; // allowlist de servidores MCP; vazio = todos
  plugins: string[];
  color: string | null;
  archived: boolean;
}

// ---------- workflows de decisão ----------
export type WorkflowNodeType = 'start' | 'task' | 'decision' | 'approval' | 'parallel' | 'end';
export interface WorkflowNode {
  id: string; // "1", "2"… (número do passo no markdown)
  type: WorkflowNodeType;
  title: string;
  agent?: string; // id do agente (task)
  instruction?: string;
  skills?: string[];
  mcp?: string[];
  output?: string; // nome da saída para passos seguintes
  condition?: string; // decision
  branches?: { label: string; to: string }[]; // decision
  next?: string[]; // task/approval/parallel/start
  position?: { x: number; y: number };
}
export interface WorkflowDef {
  slug: string;
  name: string;
  description: string;
  trigger: { type: 'manual' | 'cron'; cron?: string };
  project: string | null;
  team: string[];
  nodes: WorkflowNode[];
  markdown: string;
  updatedAt: string;
}
export interface WorkflowRunInfo {
  id: string;
  workflow: string; // slug
  status: 'running' | 'waiting_approval' | 'done' | 'failed' | 'cancelled';
  current: string | null;
  nodes: Record<string, { status: StepStatus; runId?: string | null; result?: string | null; decision?: string | null }>;
  startedAt: string;
  finishedAt: string | null;
}
export interface RoutineInfo {
  id: string;
  name: string;
  cron: string;
  nextRun: string | null;
  lastRun: string | null;
  lastStatus: string | null;
  workflow: string | null;
  agentId: string | null;
  project: string | null;
  instruction: string | null;
  enabled: boolean;
}
