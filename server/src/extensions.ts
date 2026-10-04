import type OpenAI from 'openai';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

// Pontos de extensão: cada módulo (missões, telas, workflows, ferramentas, agentes) registra aqui
// suas tools do cérebro, contexto e ajustes de execução, sem editar brain.ts/runs.ts.

export interface ToolCtx {
  dryRun: boolean;
  calls?: { name: string; args: Record<string, unknown> }[];
}

export interface BrainExtension {
  name: string;
  tools: OpenAI.Responses.FunctionTool[];
  // Devolve `undefined` quando a tool não é desta extensão.
  run(tool: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<unknown> | undefined;
  snapshot?(): string;
  instructions?: string;
}

const brainExts: BrainExtension[] = [];
export function registerBrain(ext: BrainExtension) {
  brainExts.push(ext);
}
export const brainExtensions = () => brainExts;

export interface RunContext {
  runId: string;
  agentId: string;
  project: string | null;
  display: 'blocks' | 'html' | null;
}

// Linhas extras no system prompt do agente para um run.
type PromptHook = (ctx: RunContext) => string | null;
const promptHooks: PromptHook[] = [];
export function registerRunPrompt(fn: PromptHook) {
  promptHooks.push(fn);
}
export const runPromptExtras = (ctx: RunContext) => promptHooks.map((h) => h(ctx)).filter(Boolean).join('\n');

// Opções do SDK por agente (allowlist de MCP, plugins, modelo…).
type OptionsHook = (agentId: string) => Partial<Options>;
const optionHooks: OptionsHook[] = [];
export function registerAgentOptions(fn: OptionsHook) {
  optionHooks.push(fn);
}
export function agentOptions(agentId: string): Partial<Options> {
  return optionHooks.reduce<Partial<Options>>((acc, h) => {
    const o = h(agentId);
    return {
      ...acc,
      ...o,
      disallowedTools: [...(acc.disallowedTools ?? []), ...(o.disallowedTools ?? [])],
      mcpServers: { ...(acc.mcpServers ?? {}), ...(o.mcpServers ?? {}) },
      plugins: [...(acc.plugins ?? []), ...(o.plugins ?? [])],
    };
  }, {});
}
