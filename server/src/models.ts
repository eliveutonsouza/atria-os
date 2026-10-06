import type { FastifyInstance } from 'fastify';
import type { ModelOption, ModelsCatalog } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { kvGet, kvSet, now } from './db.ts';
import { getInit } from './capabilities.ts';
import { claudeModels, probeClaudeUsage } from './claudeUsage.ts';

// Catálogo de modelos para os selects de Configurações e dos agentes: OpenAI pela lista da conta
// (/v1/models, cache de 1 h) e Claude pelos modelos que o Claude Code logado oferece.

interface OpenAICache { at: string; ids: string[] }

async function openaiIds(force = false): Promise<{ ids: string[]; at: string | null; error: string | null }> {
  const raw = kvGet('openai_models');
  const cached = raw ? (JSON.parse(raw) as OpenAICache) : null;
  if (!force && cached && Date.now() - Date.parse(cached.at) < 3600_000) return { ids: cached.ids, at: cached.at, error: null };
  if (!config.openaiKey) return { ids: cached?.ids ?? [], at: cached?.at ?? null, error: 'Chave da OpenAI não configurada.' };
  try {
    const res = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${config.openaiKey}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ids = ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id).sort();
    const c: OpenAICache = { at: now(), ids };
    kvSet('openai_models', JSON.stringify(c));
    return { ids, at: c.at, error: null };
  } catch (e) {
    return { ids: cached?.ids ?? [], at: cached?.at ?? null, error: `Não consegui listar os modelos: ${(e as Error).message}` };
  }
}

const opt = (value: string): ModelOption => ({ value, label: value });

export async function modelsCatalog(force = false): Promise<ModelsCatalog> {
  const { ids, at, error } = await openaiIds(force);
  const isVoice = (id: string) => /realtime|live/.test(id) && !/transcri|tts/.test(id);
  const isEmbed = (id: string) => id.includes('embedding');
  const isChat = (id: string) => /^(gpt-|o\d|chatgpt-)/.test(id) && !isVoice(id) && !isEmbed(id) && !/audio|tts|transcri|image|search|moderation|dall-e|whisper|codex-mini|instruct/.test(id);
  // valor configurado entra sempre (mesmo fora da lista) para o select não perder a escolha atual
  const withCurrent = (list: string[], cur: string) => (cur && !list.includes(cur) ? [cur, ...list] : list);
  const cm = claudeModels();
  return {
    openai: {
      chat: withCurrent(ids.filter(isChat), config.brainModel).concat(ids.includes(config.plannerModel) || !config.plannerModel ? [] : [config.plannerModel]).map(opt),
      live: withCurrent(ids.filter(isVoice), config.liveModel).map(opt),
      embed: withCurrent(ids.filter(isEmbed), config.embedModel).map(opt),
      at,
      error,
    },
    claude: cm.map((m) => ({ value: m.value, label: m.displayName || m.value, hint: m.resolvedModel ?? m.description })),
    defaults: {
      claudeAccount: getInit()?.model ?? null,
      claudeConsole: config.claudeModel || null,
      brain: config.brainModel,
      planner: config.plannerModel,
      live: config.liveModel,
      embed: config.embedModel,
    },
  };
}

export function register(app: FastifyInstance): void {
  app.get('/api/models', async (req) => {
    const force = (req.query as { refresh?: string }).refresh === '1';
    if (force) await probeClaudeUsage(true);
    else if (!claudeModels().length) void probeClaudeUsage();
    return modelsCatalog(force);
  });
}
