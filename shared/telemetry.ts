// Contrato da telemetria Atria OS → Atria Central (versão 1). Só métricas: nada de texto do cliente
// (conversas, tarefas, resultados, documentos). Mesmo JSON no pulso (POST {monitor}/api/ingest)
// e na URL de saúde (GET {atria-os}/api/telemetry), ambos com Authorization: Bearer <chave atk_… (ou ymk_… antiga)>.

export interface TelemetryEvent {
  at: string; // ISO
  kind:
    | 'run_failed' | 'run_done' | 'approval_requested' | 'approval_resolved' | 'container_restart' | 'version_changed' | 'voice_on' | 'voice_off' | 'error' | 'boot'
    | 'support_login' | 'support_end' | 'notice_read' | 'update_step';
  level: 'info' | 'warn' | 'crit';
  text: string; // curto e sem conteúdo do cliente: "Execução falhou · agente backend", "atria-docling reiniciou"
  agent?: string; // id do agente, quando houver
  ref?: string; // id ligado ao evento (aviso, job de atualização), quando houver
}

// O que a instância sabe fazer além de mandar pulso. Instância sem `capabilities` = só telemetria.
export type InstanceCapability = 'commands' | 'support' | 'notice' | 'update';

export interface UpdaterState {
  status: 'ready' | 'busy' | 'missing' | 'error';
  tag: string | null; // tag em uso segundo o atualizador (ex.: v1.4.0)
  step: string | null; // etapa atual quando busy
}

export interface TelemetrySnapshot {
  schema: 1;
  at: string; // ISO do momento da coleta
  instance: { id: string; domain: string; name: string | null; version: string; startedAt: string; uptimeSec: number; hostUptimeSec: number | null; tz: string; product?: 'atria-os'; capabilities?: InstanceCapability[]; supportAllowed?: boolean; updatesAllowed?: boolean; updater?: UpdaterState };
  host: { cpu: number | null; ram: number | null; disk: number | null; diskWorkspace: number | null; load: [number, number, number] | null; memTotalMb: number | null };
  containers: { name: string; state: string; health: string | null; restarts: number | null; startedAt: string | null }[];
  runs: { today: number; done24h: number; failed24h: number; queued: number; running: number; waitingApproval: number; maxConcurrent: number };
  byAgent: { id: string; name: string; runs24h: number; failed24h: number; cost24h: number }[];
  work: { approvalsPending: number; missionsActive: number; workflowsRunning: number; remindersPending: number; voiceActive: boolean; lastUserActivity: string | null };
  ai: {
    claude: { plan: string | null; session: number | null; sessionResetsAt: string | null; week: number | null; weekResetsAt: string | null; cost7d: number; tokens7d: number; limitsAt: string | null };
    openai: { today: number; d7: number; d30: number; unpriced: string[] };
  };
  services: { openai: boolean; claude: 'claude.ai' | 'token' | 'none'; github: boolean; browser: boolean; dockerProxy: boolean; company: boolean | null };
  errors: { lastHour: number; recent: { at: string; text: string }[] };
  events: TelemetryEvent[]; // desde o pulso anterior (no pulso) ou os últimos 50 (na URL de saúde)
}

// ---------- Central → instância: comandos entregues na resposta do pulso ----------
// POST {central}/api/ingest responde 204 (nada pendente / instância sem 'commands') ou 200 IngestResponse.
// A instância executa cada comando uma vez (dedupe por id) e informa o andamento em
// POST {central}/api/commands/:id/result com o mesmo Bearer e corpo CommandResult.

export type NoticeLevel = 'info' | 'warn' | 'crit';
export interface NoticePayload {
  noticeId: string;
  title: string; // até 120
  body: string; // até 1000
  level: NoticeLevel;
  expiresAt: string | null; // ISO
  push: boolean;
}

export type CentralCommand =
  | { id: string; kind: 'notice'; payload: NoticePayload }
  | { id: string; kind: 'notice_cancel'; payload: { noticeId: string } }
  | { id: string; kind: 'update'; payload: { jobId: string; tag: string } } // tag semver vX.Y.Z
  | { id: string; kind: 'support_end'; payload: Record<string, never> };

export interface IngestResponse {
  commands: CentralCommand[];
}

// Etapas de uma atualização (kind 'update'), na ordem.
export type UpdateStep = 'received' | 'draining' | 'pulling' | 'restarting' | 'healthy' | 'rolled_back' | 'failed' | 'refused';

export interface CommandResult {
  status: 'progress' | 'done' | 'failed';
  step?: UpdateStep | string;
  text?: string; // curto, sem conteúdo do cliente
  at: string; // ISO
}

// ---------- Suporte remoto ----------
// Link: {instância}/support?t=<token>. token = b64url(JSON SupportTokenPayload) + '.' + b64url(HMAC-SHA256(chave da instância, primeira parte)).
// Validade curta (60 s) e nonce de uso único; a instância recusa se `support.remoteAccess` estiver desligado.
export interface SupportTokenPayload {
  iid: string; // instance.id remoto (o mesmo do pulso)
  n: string; // nonce aleatório
  exp: number; // unix segundos
  by: string; // quem pediu ("Atria Central")
}
