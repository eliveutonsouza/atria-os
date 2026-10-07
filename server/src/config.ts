import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

/** Lê a variável; para ATRIA_X vazia, usa a reserva YUI_X (instalações de antes do nome Atria OS). */
export function readEnv(name: string): string | undefined {
  const v = process.env[name];
  if ((v === undefined || v === '') && name.startsWith('ATRIA_')) {
    const old = process.env[`YUI_${name.slice(6)}`];
    if (old !== undefined && old !== '') return old;
  }
  return v;
}

function env(name: string, fallback?: string): string {
  const v = readEnv(name);
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`variável de ambiente obrigatória ausente: ${name}`);
  }
  return v;
}

// Configurações editáveis pelo painel (tabela settings) têm precedência sobre o .env.
// settings.ts registra o resolvedor no boot; antes disso (ou sem valor salvo) vale o .env.
type Resolver = (key: string) => string | null;
let resolver: Resolver = () => null;
export function setSettingsResolver(fn: Resolver) {
  resolver = fn;
}
const dyn = (key: string, envName: string, fallback: string) => {
  const v = resolver(key);
  return v !== null && v !== '' ? v : env(envName, fallback);
};

export const config = {
  port: Number(env('PORT', '8080')),
  host: env('HOST', '0.0.0.0'),
  dataDir: env('ATRIA_DATA_DIR', '/data'),
  workspaceDir: env('ATRIA_WORKSPACE_DIR', '/workspace'),
  /** Pasta oculta do Atria OS no workspace (vault, workflows, relatórios, telas…). Antes: .yui */
  get metaDir() {
    return join(this.workspaceDir, '.atria');
  },
  seedDir: env('ATRIA_SEED_DIR', new URL('../../workspace-seed', import.meta.url).pathname),
  webDist: env('ATRIA_WEB_DIST', new URL('../../web/dist', import.meta.url).pathname),
  domain: env('ATRIA_DOMAIN', 'localhost'),
  get userName() {
    return dyn('user.name', 'ATRIA_USER_NAME', '');
  },
  get passwordHash() {
    return dyn('auth.passwordHash', 'ATRIA_PASSWORD_HASH', '');
  },
  sessionSecret: env('SESSION_SECRET', randomBytes(32).toString('hex')),
  get openaiKey() {
    return dyn('openai.key', 'OPENAI_API_KEY', '');
  },
  get liveModel() {
    return dyn('models.live', 'ATRIA_LIVE_MODEL', 'gpt-live-1');
  },
  get brainModel() {
    return dyn('models.brain', 'ATRIA_BRAIN_MODEL', 'gpt-6-luna');
  },
  get plannerModel() {
    return dyn('models.planner', 'ATRIA_PLANNER_MODEL', 'gpt-6-sol');
  },
  get voice() {
    return dyn('voice.name', 'ATRIA_VOICE', 'marin');
  },
  get liveIdleMin() {
    return Number(dyn('voice.idleMin', 'ATRIA_LIVE_IDLE_MIN', '5')) || 5;
  },
  claudeToken: env('CLAUDE_CODE_OAUTH_TOKEN', ''),
  get claudeModel() {
    return dyn('claude.model', 'ATRIA_CLAUDE_MODEL', '');
  },
  get maxConcurrentRuns() {
    return Math.max(1, Math.min(8, Number(dyn('runs.concurrency', 'ATRIA_MAX_CONCURRENT_RUNS', '2')) || 2));
  },
  browserMcpUrl: env('ATRIA_BROWSER_MCP', 'http://atria-browser:8931/mcp'),
  browserCdp: env('ATRIA_BROWSER_CDP', 'http://atria-browser:9223'),
  codeUrl: env('ATRIA_CODE_URL', 'http://atria-code:3000'),
  pgUrl: env('ATRIA_PG_URL', ''),
  qdrantUrl: env('ATRIA_QDRANT_URL', 'http://atria-qdrant:6333'),
  qdrantKey: env('ATRIA_QDRANT_KEY', ''),
  doclingUrl: env('ATRIA_DOCLING_URL', 'http://atria-docling:5001'),
  get embedModel() {
    return dyn('models.embed', 'ATRIA_EMBED_MODEL', 'text-embedding-3-small');
  },
  dockerApi: env('ATRIA_DOCKER_API', 'http://atria-dockerproxy:2375'),
  hostProc: env('ATRIA_HOST_PROC', '/host/proc'),
  timezone: env('TZ', 'America/Sao_Paulo'),
  secureCookies: env('ATRIA_SECURE_COOKIES', '1') === '1',
};
