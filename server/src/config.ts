import { randomBytes } from 'node:crypto';

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`variável de ambiente obrigatória ausente: ${name}`);
  }
  return v;
}

export const config = {
  port: Number(env('PORT', '8080')),
  host: env('HOST', '0.0.0.0'),
  dataDir: env('YUI_DATA_DIR', '/data'),
  workspaceDir: env('YUI_WORKSPACE_DIR', '/workspace'),
  seedDir: env('YUI_SEED_DIR', new URL('../../workspace-seed', import.meta.url).pathname),
  webDist: env('YUI_WEB_DIST', new URL('../../web/dist', import.meta.url).pathname),
  domain: env('YUI_DOMAIN', 'localhost'),
  userName: env('YUI_USER_NAME', 'Eliveuton'),
  passwordHash: env('YUI_PASSWORD_HASH', ''),
  sessionSecret: env('SESSION_SECRET', randomBytes(32).toString('hex')),
  openaiKey: env('OPENAI_API_KEY', ''),
  liveModel: env('YUI_LIVE_MODEL', 'gpt-live-1'),
  brainModel: env('YUI_BRAIN_MODEL', 'gpt-6-luna'),
  voice: env('YUI_VOICE', 'marin'),
  liveIdleMin: Number(env('YUI_LIVE_IDLE_MIN', '5')),
  claudeToken: env('CLAUDE_CODE_OAUTH_TOKEN', ''),
  claudeModel: env('YUI_CLAUDE_MODEL', ''),
  maxConcurrentRuns: Number(env('YUI_MAX_CONCURRENT_RUNS', '2')),
  dockerApi: env('YUI_DOCKER_API', 'http://yui-dockerproxy:2375'),
  hostProc: env('YUI_HOST_PROC', '/host/proc'),
  timezone: env('TZ', 'America/Sao_Paulo'),
  secureCookies: env('YUI_SECURE_COOKIES', '1') === '1',
};
