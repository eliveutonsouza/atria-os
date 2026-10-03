import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from './config.ts';
import { kvGet, kvSet, now } from './db.ts';
import { claudeEnv } from './runs.ts';

// Captura o `init` real do Claude Code (tools, MCP, skills, slash commands, plugins, subagentes)
// sem gastar turno: aborta logo após o init. Fonte do painel Ferramentas, do mapa do Claude e do cérebro.

export interface ClaudeInit {
  at: string;
  model: string;
  tools: string[];
  mcp: { name: string; status: string; source?: string }[];
  skills: string[];
  slashCommands: string[];
  plugins: { name: string; path: string; version?: string }[];
  agents: string[];
}

let capturing: Promise<ClaudeInit | null> | null = null;

export function captureInit(): Promise<ClaudeInit | null> {
  capturing ??= (async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90_000);
    try {
      const q = query({
        prompt: 'ok',
        options: {
          cwd: config.workspaceDir,
          abortController: ac,
          settingSources: ['user', 'project', 'local'],
          mcpServers: { playwright: { type: 'http', url: config.browserMcpUrl } },
          extraArgs: { chrome: null },
          env: claudeEnv(),
          maxTurns: 1,
        },
      });
      for await (const m of q) {
        if (m.type === 'system' && m.subtype === 'init') {
          const init: ClaudeInit = {
            at: now(),
            model: m.model,
            tools: m.tools,
            mcp: m.mcp_servers,
            skills: m.skills,
            slashCommands: m.slash_commands,
            plugins: m.plugins,
            agents: (m as { agents?: string[] }).agents ?? [],
          };
          kvSet('claude_init', JSON.stringify(init));
          kvSet('claude_capabilities', JSON.stringify({ at: init.at, mcp: init.mcp, plugins: init.plugins.map((p) => p.name) }));
          ac.abort();
          return init;
        }
      }
      return null;
    } catch (e) {
      if (!ac.signal.aborted) console.error('capabilities', (e as Error).message);
      return getInit();
    } finally {
      clearTimeout(timer);
      capturing = null;
    }
  })();
  return capturing;
}

export function getInit(): ClaudeInit | null {
  const raw = kvGet('claude_init');
  return raw ? (JSON.parse(raw) as ClaudeInit) : null;
}

export function startCapabilities() {
  setTimeout(() => void captureInit(), 20_000).unref();
  setInterval(() => void captureInit(), 6 * 3600_000).unref();
}
