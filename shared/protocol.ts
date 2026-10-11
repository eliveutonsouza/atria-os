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
  | 'claude'
  | 'vault'
  | 'brain'
  | 'company'
  | 'help'
  | 'skills'
  | 'browser';

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
  'vault',
  'brain',
  'company',
  'help',
  'skills',
  'browser',
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
  cmd?: string; // terminal: texto digitado ao conectar (sem Enter)
  note?: string; // vault/brain: caminho da nota no vault
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
  missionId?: string | null;
  workflowRunId?: string | null;
  display?: 'blocks' | 'html' | null;
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
  kind?: 'destructive'; // ação irreversível (ex.: excluir workflow/missão): modal em vermelho
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
  history: ChatMessage[]; // conversa do projeto ativo
  maxConcurrent?: number; // execuções ao mesmo tempo
  greeting: { msg: string; showBrief: boolean; brief: Brief | null };
  status: { claude: boolean; openai: boolean; live: boolean; claudeAuth?: 'claude.ai' | 'token' | 'none'; github?: boolean; repos?: number };
}

// ---------- eventos SSE (/api/events) ----------

export type UiAction =
  | { type: 'show_view'; view: ViewName; params?: ViewParams }
  | { type: 'close_canvas' }
  | { type: 'set_focus'; on: boolean }
  | { type: 'suggest_view'; view: ViewName; params?: ViewParams; label?: string }
  | { type: 'switch_project'; project: string | null; name: string } // null = Geral (sem projeto)
  | { type: 'open_approval'; approvalId: string };

export type ServerEvent =
  | { type: 'yui.state'; state: YuiState }
  | { type: 'yui.say'; text: string; final: boolean; project?: string | null } // texto da Yui (msg central + histórico quando final); project = conversa de origem
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
  | { type: 'mission.deleted'; missionId: string }
  | { type: 'workflow.deleted'; slug: string }
  | { type: 'workflow.run.updated'; run: WorkflowRunInfo }
  | { type: 'workflow.input.updated'; request: WorkflowInputRequest }
  | { type: 'custom.created'; view: CustomViewInfo }
  | { type: 'vault.changed'; paths: string[]; at: number }
  | { type: 'company.doc.updated'; doc: CompanyDoc }
  | { type: 'company.doc.deleted'; id: string }
  | { type: 'company.profile.updated'; profile: CompanyProfile }
  | ({ type: 'browser.challenge' } & BrowserChallengeState) // verificação humana no navegador dos agentes (browserChallenge.ts)
  | { type: 'support.updated' } // suporte remoto, avisos ou atualização mudaram: a faixa e Configurações releem
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
export type StepStatus = 'pending' | 'waiting_approval' | 'waiting_input' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';
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
  status: 'draft' | 'running' | 'paused' | 'blocked' | 'done' | 'failed' | 'cancelled';
  steps: MissionStep[];
  createdAt: string;
  finishedAt: string | null;
  details?: string | null; // detalhes e referências do pedido (entram no planejamento)
  approvalBefore?: string[]; // "deploy" | "enviar": pedir OK antes dessas ações
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

// ---------- skills.sh (loja de skills) ----------
export type SkillHubView = 'all' | 'trending' | 'hot';
export interface HubSkill {
  source: string; // owner/repo no GitHub (ou domínio, quando não é GitHub)
  skillId: string;
  name: string;
  installs: number;
  weekly?: number[]; // instalações das últimas 8 semanas (só no ranking "all")
  change?: number; // variação em 24 h (hot)
  official?: boolean;
}
export interface SkillAudit {
  name: string; // Gen Agent Trust Hub, Socket, Snyk…
  result: 'pass' | 'warn' | 'fail' | 'unknown';
}
export interface HubSkillDetail extends HubSkill {
  description: string;
  audits: SkillAudit[];
  skillMd: string;
  files: number;
  bytes: number;
  installable: boolean;
  reason?: string; // por que não dá para instalar
}
export interface InstalledSkill {
  name: string; // nome da pasta (o que o Claude enxerga)
  source: string;
  skillId: string;
  scope: 'platform' | 'agents';
  agents: string[]; // ids dos agentes quando scope = agents
  description: string;
  treeSha: string;
  audits: SkillAudit[];
  installedAt: string;
  updatedAt?: string;
  updateAvailable?: boolean;
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
export type WorkflowNodeType = 'start' | 'task' | 'decision' | 'approval' | 'parallel' | 'input' | 'notify' | 'end';

// Passo "Pedir informação" (input): o fluxo para e espera o usuário responder estes campos.
export type InputFieldKind = 'text' | 'longtext' | 'date' | 'time' | 'number' | 'boolean' | 'choice' | 'audio' | 'images' | 'files';
export interface InputField {
  key: string; // slug estável (data-da-reuniao)
  label: string;
  kind: InputFieldKind;
  required: boolean;
  options?: string[]; // choice
  default?: string | null; // 'hoje' (date/time) ou valor literal
}
export type NotifyChannel = 'telegram' | 'email' | 'push';
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
  ask?: boolean; // approval: sempre perguntar ao usuário (sem isso a Yui decide com base nas decisões anteriores)
  fields?: InputField[]; // input
  notifyVia?: NotifyChannel[]; // input (avisar quando parar) e notify
  message?: { mode: 'ai' | 'template'; text: string }; // notify: a Yui escreve seguindo `text` ou texto fixo com {{Título do passo}}
  attach?: boolean; // notify: anexar arquivos gerados no run
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
  status: 'running' | 'waiting_approval' | 'waiting_input' | 'done' | 'failed' | 'cancelled';
  current: string | null;
  nodes: Record<string, { status: StepStatus; runId?: string | null; result?: string | null; decision?: string | null; decidedBy?: 'yui' | 'user' | null; feedback?: 'agree' | 'disagree' | null }>;
  startedAt: string;
  finishedAt: string | null;
  dir?: string | null; // pasta própria desta execução, onde os agentes gravam o que geram
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

// ---------- v3: dashboard ----------
export type AppPage =
  | 'overview' | 'ops' | 'agents' | 'runs' | 'missions' | 'workflows' | 'schedule' | 'projects'
  | 'browser' | 'terminal' | 'claude' | 'tools' | 'inbox' | 'infra' | 'settings'
  | 'vault' | 'brain' | 'company' | 'help' | 'more' | 'usage' | 'reminders' | 'skills';

export interface StatsOverview {
  kpis: { runsToday: number; runsYesterday: number; success7d: number | null; failed7d: number; agentsActive: number; agentsTotal: number; approvals: number; cost7d: number; tokens7d: number };
  daily: { date: string; done: number; failed: number; routine: number }[]; // 30 dias, antigo → hoje
  byAgent: { agentId: string; agent: string; runs: number; success: number | null; avgMs: number | null; costUsd: number; tokens: number }[];
  topTools: { name: string; count: number }[];
}

export interface OpsCard {
  id: string; // runId ou approvalId
  kind: 'run' | 'approval';
  agent: string;
  agentId: string;
  task: string;
  origin: 'yui' | 'manual' | 'routine' | 'mission' | 'workflow';
  originLabel: string | null; // título da missão/workflow/rotina
  project: string | null;
  startedAt: string | null;
  progress: number;
}
export interface OpsBoard {
  pipeline: { inbound: number; brain: number; missions: number; workflows: number; running: number; queued: number; approvals: number; doneToday: number };
  columns: { queued: OpsCard[]; running: OpsCard[]; waiting: OpsCard[]; doneToday: OpsCard[]; failed: OpsCard[] };
  gantt: { agentId: string; agent: string; spans: { start: string; end: string | null; state: string; task: string }[] }[]; // últimas 24h
}

export interface ScheduleOccurrence {
  routineId: string;
  name: string;
  at: string; // ISO
  workflow: string | null;
  agentId: string | null;
  enabled: boolean;
}

export interface SettingsPayload {
  values: Record<string, string | number | boolean | null>; // não-secretos
  secrets: Record<string, boolean>; // segredo configurado?
}

export interface SetupStatus {
  needsPassword: boolean; // primeiro acesso: criar senha
  claude: 'claude.ai' | 'token' | 'none';
  github: boolean;
  openai: boolean;
  push: number; // dispositivos inscritos
  monitor?: boolean; // monitoramento remoto ligado (opcional, para quem administra várias instalações do Atria OS)
  completed: boolean;
}

// WebSocket /api/browser/live
export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  active: boolean;
}
export type BrowserChallengeKind = 'cloudflare' | 'turnstile' | 'recaptcha' | 'hcaptcha' | 'akamai' | 'perimeterx' | 'datadome' | 'generic';
// GET /api/browser/challenge e evento SSE browser.challenge
export interface BrowserChallengeState {
  active: boolean;
  site: string | null;
  kind: BrowserChallengeKind | null;
  since: string | null;
}

export type BrowserServerMsg =
  | { type: 'frame'; targetId: string; data: string; width: number; height: number } // JPEG base64
  | { type: 'tabs'; tabs: BrowserTab[] }
  | { type: 'activity'; runId: string; agent: string; action: string; at: string }
  | { type: 'status'; connected: boolean; controlling: boolean; error?: string };
export type BrowserClientMsg =
  | { type: 'select'; targetId: string }
  | { type: 'navigate'; url: string }
  | { type: 'nav'; action: 'back' | 'forward' | 'reload' }
  | { type: 'control'; on: boolean }
  | { type: 'mouse'; event: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel'; x: number; y: number; button?: 'left' | 'right' | 'none'; clickCount?: number; deltaX?: number; deltaY?: number }
  | { type: 'key'; event: 'keyDown' | 'keyUp' | 'char'; key: string; code?: string; text?: string; modifiers?: number } // modifiers CDP: Alt=1 Ctrl=2 Meta=4 Shift=8
  | { type: 'viewport'; width: number; height: number };

// ---------- Vault (Obsidian) + Cérebro ----------
// GET  /api/vault/tree                      -> VaultTreeEntry[]
// GET  /api/vault/file?path=                -> VaultFile
// PUT  /api/vault/file {path, text, baseMtime?} -> {mtime} (409 se mudou)
// POST /api/vault/file {path, text?}        -> {path} (cria; 409 se existe)
// DELETE /api/vault/file?path=              -> 204
// POST /api/vault/move {from, to}           -> {path}
// GET  /api/vault/graph                     -> VaultGraphPayload
// GET  /api/vault/backlinks?path=           -> VaultBacklink[]
// GET  /api/vault/rings?path=&depth=        -> VaultRing[]
// GET  /api/vault/path?from=&to=            -> {path: string[] | null}
// GET  /api/vault/suggest?path=             -> VaultSuggestion[]
// POST /api/vault/link {from, to}           -> 204 (acrescenta [[to]] em "## Relacionadas")
// GET  /api/vault/status                    -> VaultStatus
// GET  /api/vault/search?q=                 -> VaultSearchHit[]

export interface VaultTreeEntry {
  path: string; // relativo ao vault, "/" como separador
  name: string;
  dir: boolean;
  depth: number;
  size?: number;
  mtime?: number;
  count?: number; // notas dentro (pastas)
}

export interface VaultFile {
  path: string;
  text: string;
  mtime: number;
  title: string;
  tags: string[];
  props: Record<string, string>;
}

export interface VaultNode {
  id: string; // path (ou "ghost:<nome>" para link para nota inexistente)
  title: string;
  folder: string;
  tags: string[];
  mtime: number;
  words: number;
  ghost?: boolean;
}

export interface VaultLink {
  s: string;
  t: string;
  kind: 'link' | 'embed' | 'tag';
}

export interface VaultGraphPayload {
  nodes: VaultNode[];
  links: VaultLink[];
  folders: { name: string; count: number }[];
  at: number;
}

export interface VaultBacklink {
  path: string;
  title: string;
  line: number;
  snippet: string;
}

export interface VaultRing {
  id: string;
  ring: number;
  via: string | null;
  dir: 'out' | 'in' | 'both' | null;
}

export interface VaultSuggestion {
  id: string;
  title: string;
  score: number;
  reason: string;
}

export interface VaultSearchHit {
  path: string;
  title: string;
  line: number;
  snippet: string;
}

export interface VaultStatus {
  notes: number;
  links: number;
  pending: number; // arquivos alterados ainda sem commit
  lastCommitAt: string | null;
  lastCommitMsg: string | null;
  editor: boolean; // sidecar VS Code respondendo
}

// POST /api/vault/open {path, line?}        -> 204 (VS Code abre a nota)
// GET  /api/vault/editor-state              -> VaultEditorState (arquivo ativo no VS Code)
export interface VaultEditorState {
  path: string | null; // relativo ao vault (null = fora do vault)
  abs: string | null;
  at: number;
}

// ---------- Empresa: perfil + base de conhecimento (OCR → extração → Postgres + Qdrant → RAG) ----------
// GET  /api/company/profile                 -> CompanyProfile
// PUT  /api/company/profile (CompanyProfileInput) -> CompanyProfile
// POST /api/company/logo (multipart "file") -> 204 ; GET /api/company/logo -> imagem ; DELETE /api/company/logo -> 204
// GET  /api/company/documents?q=&category=  -> CompanyDoc[]
// POST /api/company/documents (multipart, vários "files"; campo opcional "category") -> {created: CompanyDoc[], duplicates: string[], rejected: {name, reason}[]}
// GET  /api/company/documents/:id           -> CompanyDoc
// PATCH /api/company/documents/:id {category?, fields?, summary?, tags?} -> CompanyDoc
// DELETE /api/company/documents/:id         -> 204 (arquivo + Postgres + Qdrant + nota do vault)
// POST /api/company/documents/bulk-delete {ids} -> {deleted: number}
// POST /api/company/documents/:id/reprocess -> CompanyDoc ; POST /api/company/documents/bulk-reprocess {ids}
// GET  /api/company/documents/:id/file      -> original (inline)
// GET  /api/company/documents/:id/text      -> {markdown: string}
// GET  /api/company/documents/:id/pages     -> CompanyDocPage[]
// GET  /api/company/documents/:id/chunks    -> CompanyChunk[]
// GET  /api/company/documents/:id/uses      -> CompanyUse[]
// POST /api/company/search {query, category?, answer?: boolean} -> CompanySearchResult
// GET  /api/company/stats                   -> CompanyStats

export const COMPANY_CATEGORIES = ['Comercial', 'Contratos', 'Marca', 'Processos', 'Financeiro', 'Clientes', 'Outros'] as const;
export type CompanyCategory = (typeof COMPANY_CATEGORIES)[number];

export interface CompanyService {
  name: string;
  price: string;
}

export interface CompanyProfileInput {
  name: string;
  legalName: string;
  cnpj: string;
  segment: string;
  site: string;
  city: string;
  about: string; // o que a empresa faz
  audience: string; // para quem
  tone: string;
  services: CompanyService[];
}

export interface CompanyProfile extends CompanyProfileInput {
  hasLogo: boolean;
  logoVersion: number; // para cache-busting da imagem
  updatedAt: string | null;
  agentPreview: string; // texto exato que entra no prompt dos agentes e da Yui
}

export type CompanyDocState = 'queued' | 'processing' | 'ready' | 'error';
// 0 recebido · 1 lendo/OCR (Docling) · 2 extraindo dados · 3 embeddings · 4 indexando no Qdrant · 5 pronto
export type CompanyDocStage = 0 | 1 | 2 | 3 | 4 | 5;

export interface CompanyDoc {
  id: string;
  name: string;
  ext: string; // PDF, DOCX, PPTX, XLSX, PNG, JPG, MD, TXT…
  mime: string;
  size: number;
  category: CompanyCategory;
  state: CompanyDocState;
  stage: CompanyDocStage;
  error: string | null;
  pages: number;
  ocrPages: number;
  chunks: number;
  docType: string | null; // "Tabela de preços", "Contrato"…
  summary: string | null;
  fields: { key: string; value: string }[];
  entities: { type: string; value: string }[];
  tags: string[];
  timings: { stage: CompanyDocStage; label: string; ms: number; detail?: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface CompanyDocBox {
  kind: 'text' | 'title' | 'table' | 'picture' | 'list';
  // fração da página (0–1), origem no canto superior esquerdo
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CompanyDocPage {
  page: number;
  ocr: boolean;
  width: number;
  height: number;
  text: string;
  boxes: CompanyDocBox[];
}

export interface CompanyChunk {
  id: string;
  ord: number;
  page: number | null;
  tokens: number;
  kind: 'texto' | 'tabela' | 'título';
  text: string;
}

export interface CompanySearchHit {
  n: number; // [n] usado na citação
  chunkId: string;
  docId: string;
  docName: string;
  category: CompanyCategory;
  page: number | null;
  text: string;
  vector: number | null; // similaridade cosseno (0–1)
  keyword: number | null; // rank do texto (Postgres), normalizado 0–1
  score: number; // fusão RRF normalizada 0–1
}

export interface CompanySearchResult {
  query: string;
  answer: string | null;
  hits: CompanySearchHit[];
  ms: number;
  noAnswer: boolean;
}

export interface CompanyUse {
  at: string;
  who: string; // "Yui", nome do agente, "Painel"
  query: string;
  score: number | null;
}

export interface CompanyStats {
  docs: number;
  ready: number;
  processing: number;
  errors: number;
  pages: number;
  ocrPages: number;
  chunks: number;
  vectors: number;
  queries7d: number;
  unanswered7d: number;
  unansweredRecent: string[];
  services: { docling: boolean; postgres: boolean; qdrant: boolean; openai: boolean };
}

// ---------- Ajuda: guias operacionais, receitas, FAQ, "Pergunte" e Resultados ----------
// GET  /api/help                            -> HelpIndex
// GET  /api/help/doc/:kind/:id              -> HelpDoc (kind: guia | receita)
// POST /api/help/ask {pergunta}             -> HelpAnswer
// POST /api/help/feedback {kind, id, util}  -> 204
// GET  /api/help/unanswered                 -> {pergunta, at}[]
// GET  /api/help/results?period=week|month|90d -> HelpResults
// PUT  /api/help/results/minutes {[tipo]: minutos} -> HelpResults (período mês)

export interface HelpGuideMeta {
  id: string;
  titulo: string;
  grupo: string; // Começar | Acompanhar | Organizar | Conhecimento | Ferramentas | Sistema
  pagina: AppPage | null; // tela que o botão "Abrir" leva
  ordem: number;
  resumo: string;
}

export interface HelpRecipeMeta {
  id: string;
  titulo: string;
  categoria: string;
  ferramentas: string;
  tempo: string;
}

export interface HelpIndex {
  guias: HelpGuideMeta[];
  receitas: HelpRecipeMeta[];
  faq: { categoria: string; pergunta: string; resposta: string }[];
  dia: { hora: string; titulo: string; texto: string; frase: string | null }[];
  version: string;
}

export interface HelpDoc {
  kind: 'guia' | 'receita';
  id: string;
  titulo: string;
  meta: Record<string, string | string[]>; // frontmatter (resumo, usar_quando, frases, dicas, erros, relacionados, antes, resultado, frase…)
  markdown: string; // corpo, sem o frontmatter nem o "# título"
  pagina: AppPage | null;
}

export interface HelpSource {
  kind: 'guia' | 'receita' | 'faq';
  id: string;
  titulo: string;
  pagina: AppPage | null;
}

export interface HelpAnswer {
  pergunta: string;
  resposta: string | null;
  semResposta: boolean;
  fontes: HelpSource[];
  abrir: AppPage | null;
}

export type HelpTaskType = 'codigo' | 'pesquisa' | 'textos' | 'assistente' | 'workflow' | 'rotina' | 'consulta' | 'documento';

export interface HelpResults {
  period: 'week' | 'month' | '90d';
  from: string;
  to: string;
  hours: number; // estimadas
  kpis: {
    runsDone: number;
    successRate: number | null; // 0–1 (concluídas / (concluídas + falhas))
    workflowsDone: number;
    approvals: number;
    approvalAvgMin: number | null;
    docsReady: number;
    queries: number;
    costUsd: number;
  };
  rows: { tipo: HelpTaskType; label: string; count: number; minutes: number; hours: number }[];
  weeks: { label: string; from: string; hours: number; byTipo: Partial<Record<HelpTaskType, number>> }[];
}

// ---------- consumo de IA ----------
export interface UsageLimit {
  kind: string; // five_hour | seven_day | seven_day_opus | …
  label: string; // "Sessão atual (5 h)"
  pct: number | null; // 0–100
  resetsAt: string | null; // ISO
  status?: string | null; // allowed | allowed_warning | rejected
}
export interface UsageDay { date: string; claude: number; openai: number }
export interface UsageReport {
  days: number;
  claude: {
    plan: string | null; // max | pro | api…
    model: string | null; // padrão da conta (init)
    limits: UsageLimit[];
    limitsAt: string | null; // quando os limites foram lidos
    lastContext: { agent: string; task: string; used: number; window: number; at: string } | null;
    runs: number;
    tokens: number;
    cost: number;
    byAgent: { agentId: string; agent: string; runs: number; tokens: number; cost: number }[];
  };
  openai: {
    today: number;
    d7: number;
    d30: number;
    tokens: number;
    voiceSeconds: number;
    byFeature: { feature: string; label: string; model: string; tokens: number; seconds: number; cost: number | null }[];
    byModel: { model: string; tokens: number; cost: number | null }[];
    unpriced: string[]; // modelos sem preço na tabela (custo desconhecido)
  };
  daily: UsageDay[];
}

// ---------- catálogo de modelos ----------
export interface ModelOption { value: string; label: string; hint?: string }
export interface ModelsCatalog {
  openai: { chat: ModelOption[]; live: ModelOption[]; embed: ModelOption[]; at: string | null; error?: string | null };
  claude: ModelOption[];
  defaults: { claudeAccount: string | null; claudeConsole: string | null; brain: string; planner: string; live: string; embed: string };
}

// ---------- lembretes ----------
export type ReminderRepeat = 'diario' | 'dias_uteis' | 'semanal' | 'mensal';
export interface ReminderInfo {
  id: string;
  text: string;
  dueAt: string;
  repeat: ReminderRepeat | null;
  status: 'pending' | 'done' | 'cancelled' | 'missed';
  createdAt: string;
  firedAt: string | null;
}

// ---------- agentes: onde um agente é usado (antes de demitir) ----------
export interface AgentUsageRef {
  kind: 'routine' | 'workflow' | 'mission' | 'toolbox';
  id: string;
  label: string; // "Revisão de acessibilidade · seg 09:00"
  detail?: string; // "passos 2 e 4"
}

// ---------- workflows: pedidos de informação (passo input) ----------
export interface WorkflowInputRequest {
  id: string;
  runId: string;
  nodeId: string;
  workflow: string; // slug
  workflowName: string;
  title: string;
  instruction: string;
  fields: InputField[];
  status: 'pending' | 'processing' | 'done' | 'cancelled' | 'failed';
  answers: Record<string, unknown>; // valores já recebidos (arquivos: [{name, path, size}])
  progress: string | null; // "Transcrevendo a gravação · parte 3 de 5"
  error: string | null;
  createdAt: string;
  remindedAt: string | null;
  nextReminderAt: string | null;
  answeredAt: string | null;
  notifiedVia: NotifyChannel[];
}

export interface NotifyStatus {
  telegram: { configured: boolean; linked: boolean; chatName: string | null; botName: string | null; linkCode: string | null; error: string | null };
  email: { configured: boolean; to: string | null; from: string | null };
  push: { devices: number };
  remindHours: number;
}
