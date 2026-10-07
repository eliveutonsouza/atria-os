import { statfsSync } from 'node:fs';
import { config } from './config.ts';
import { db } from './db.ts';
import { claudeLoggedIn } from './runs.ts';
import { liveActive } from './live.ts';
import { getInit } from './capabilities.ts';
import { catalog, githubEnabled } from './github.ts';
import { healthy as companyHealthy } from './company/store.ts';

// Saúde detalhada: cada dependência com status, para o painel (/api/health/full), a auditoria e a telemetria.
// `light`: sem o initialize do MCP do navegador (abre sessão nova a cada chamada); só confere se o servidor responde.

const check = async (fn: () => Promise<unknown>) => fn().then(() => true).catch(() => false);
const okResp = (r: Response) => {
  if (!r.ok) throw new Error();
};

export async function healthFull(opts: { light?: boolean } = {}) {
  const [docker, browser, company] = await Promise.all([
    check(() => fetch(`${config.dockerApi}/_ping`, { signal: AbortSignal.timeout(3000) }).then(okResp)),
    opts.light
      ? check(() => fetch(config.browserMcpUrl, { method: 'GET', signal: AbortSignal.timeout(3000) }).then((r) => r.body?.cancel()))
      : check(() => fetch(config.browserMcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'health', version: '1' } } }), signal: AbortSignal.timeout(4000) }).then(okResp)),
    // Empresa (Postgres + Qdrant): null quando a instalação não tem a base
    // (o pool do pg não tem timeout de conexão: a corrida evita pendurar a saúde com o Postgres fora)
    config.pgUrl
      ? Promise.race([companyHealthy().then((h) => h.postgres && h.qdrant), new Promise<boolean>((r) => setTimeout(() => r(false), 4000).unref())]).catch(() => false)
      : Promise.resolve(null),
  ]);
  let disk: number | null = null;
  try {
    const st = statfsSync(config.workspaceDir);
    disk = Math.round((1 - st.bavail / st.blocks) * 100);
  } catch {
    /* ignora */
  }
  const init = getInit();
  return {
    openai: !!config.openaiKey,
    claudeAuth: (claudeLoggedIn() ? 'claude.ai' : config.claudeToken ? 'token' : 'none') as 'claude.ai' | 'token' | 'none',
    github: githubEnabled(),
    repos: catalog().length,
    dockerProxy: docker,
    browser,
    company,
    live: liveActive(),
    capabilitiesAt: init?.at ?? null,
    mcpConnected: init?.mcp.filter((m) => m.status === 'connected').length ?? null,
    workspaceDiskPct: disk,
    queue: db.prepare(`SELECT state, COUNT(*) AS n FROM runs WHERE state IN ('queued','running','waiting_approval') GROUP BY state`).all() as { state: string; n: number }[],
  };
}
