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
  | 'artifact';

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
];

export interface ViewParams {
  project?: string; // slug
  runId?: string;
  artifactId?: string;
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
  status: { claude: boolean; openai: boolean; live: boolean };
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
// GET  /api/artifacts                      -> ArtifactInfo[]
// POST /api/approvals/:id {approve:boolean}-> 204
// POST /api/runs {agentId, project, instruction} -> RunInfo  (ação manual "Pedir correção")

export interface ChatContext {
  view: ViewName | null;
  params?: ViewParams;
  selectedElement?: string | null;
  mode: 'center' | 'canvas' | 'focus';
}
