// Contrato da telemetria Yui → Yui Monitor (versão 1). Só métricas: nada de texto do cliente
// (conversas, tarefas, resultados, documentos). Mesmo JSON no pulso (POST {monitor}/api/ingest)
// e na URL de saúde (GET {yui}/api/telemetry), ambos com Authorization: Bearer <chave ymk_…>.

export interface TelemetryEvent {
  at: string; // ISO
  kind: 'run_failed' | 'run_done' | 'approval_requested' | 'approval_resolved' | 'container_restart' | 'version_changed' | 'voice_on' | 'voice_off' | 'error' | 'boot';
  level: 'info' | 'warn' | 'crit';
  text: string; // curto e sem conteúdo do cliente: "Execução falhou · agente backend", "yui-docling reiniciou"
  agent?: string; // id do agente, quando houver
}

export interface TelemetrySnapshot {
  schema: 1;
  at: string; // ISO do momento da coleta
  instance: { id: string; domain: string; name: string | null; version: string; startedAt: string; uptimeSec: number; hostUptimeSec: number | null; tz: string };
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
