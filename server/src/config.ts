import { randomBytes } from 'node:crypto';

function env(name: string, fallback?: string): string {
  const v = process.env[name];
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
  dataDir: env('YUI_DATA_DIR', '/data'),
  workspaceDir: env('YUI_WORKSPACE_DIR', '/workspace'),
  seedDir: env('YUI_SEED_DIR', new URL('../../workspace-seed', import.meta.url).pathname),
  webDist: env('YUI_WEB_DIST', new URL('../../web/dist', import.meta.url).pathname),
  domain: env('YUI_DOMAIN', 'localhost'),
  get userName() {
    return dyn('user.name', 'YUI_USER_NAME', '');
  },
  get passwordHash() {
    return dyn('auth.passwordHash', 'YUI_PASSWORD_HASH', '');
  },
  sessionSecret: env('SESSION_SECRET', randomBytes(32).toString('hex')),
  get openaiKey() {
    return dyn('openai.key', 'OPENAI_API_KEY', '');
  },
  get liveModel() {
    return dyn('models.live', 'YUI_LIVE_MODEL', 'gpt-live-1');
  },
  get brainModel() {
    return dyn('models.brain', 'YUI_BRAIN_MODEL', 'gpt-6-luna');
  },
  get plannerModel() {
    return dyn('models.planner', 'YUI_PLANNER_MODEL', 'gpt-6-sol');
  },
  get voice() {
    return dyn('voice.name', 'YUI_VOICE', 'marin');
  },
  get liveIdleMin() {
    return Number(dyn('voice.idleMin', 'YUI_LIVE_IDLE_MIN', '5')) || 5;
  },
  claudeToken: env('CLAUDE_CODE_OAUTH_TOKEN', ''),
  get claudeModel() {
    return dyn('claude.model', 'YUI_CLAUDE_MODEL', '');
  },
  get maxConcurrentRuns() {
    return Math.max(1, Math.min(8, Number(dyn('runs.concurrency', 'YUI_MAX_CONCURRENT_RUNS', '2')) || 2));
  },
  browserMcpUrl: env('YUI_BROWSER_MCP', 'http://yui-browser:8931/mcp'),
  browserCdp: env('YUI_BROWSER_CDP', 'http://yui-browser:9223'),
  codeUrl: env('YUI_CODE_URL', 'http://yui-code:3000'),
  pgUrl: env('YUI_PG_URL', ''),
  qdrantUrl: env('YUI_QDRANT_URL', 'http://yui-qdrant:6333'),
  qdrantKey: env('YUI_QDRANT_KEY', ''),
  doclingUrl: env('YUI_DOCLING_URL', 'http://yui-docling:5001'),
  get embedModel() {
    return dyn('models.embed', 'YUI_EMBED_MODEL', 'text-embedding-3-small');
  },
  dockerApi: env('YUI_DOCKER_API', 'http://yui-dockerproxy:2375'),
  hostProc: env('YUI_HOST_PROC', '/host/proc'),
  timezone: env('TZ', 'America/Sao_Paulo'),
  secureCookies: env('YUI_SECURE_COOKIES', '1') === '1',
};
