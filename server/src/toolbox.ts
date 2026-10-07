import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ToolboxItem, ToolStatus } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { getInit } from './capabilities.ts';
import { listContainers, type ContainerSummary } from './docker.ts';
import { catalog, githubEnabled } from './github.ts';
import { registerBrain } from './extensions.ts';

// Caixa de Ferramentas: o mapa das ferramentas do dia a dia do usuário (conectores, skills, stacks,
// repositórios, URLs) com status vivo e agente padrão. Dá visibilidade ao painel e ao cérebro da Yui.
// Arquivo editável: /workspace/.atria/toolbox.json (seed em workspace-seed/.atria/toolbox.json).

type ToolDef = Omit<ToolboxItem, 'status'> & { status?: ToolStatus };

const file = () => join(config.metaDir, 'toolbox.json');

function ensureFile() {
  const f = file();
  if (existsSync(f)) return;
  const seed = join(config.seedDir, '.atria', 'toolbox.json');
  if (!existsSync(seed)) return;
  mkdirSync(dirname(f), { recursive: true });
  cpSync(seed, f);
}

export function loadToolbox(): ToolDef[] {
  ensureFile();
  try {
    const list = JSON.parse(readFileSync(file(), 'utf8')) as ToolDef[];
    return Array.isArray(list) ? list.filter((t) => t && typeof t.id === 'string' && t.access?.type) : [];
  } catch (e) {
    console.error('toolbox.json inválido', (e as Error).message);
    return [];
  }
}

function saveToolbox(items: ToolDef[]) {
  const f = file();
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(`${f}.tmp`, `${JSON.stringify(items, null, 2)}\n`);
  renameSync(`${f}.tmp`, f);
  cache = null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

async function urlStatus(url: string): Promise<ToolStatus> {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(4000) });
    return r.status < 500 ? 'ok' : 'down';
  } catch {
    return 'down';
  }
}

function stackStatus(prefix: string, containers: ContainerSummary[] | null): { status: ToolStatus; note?: string } {
  if (!containers) return { status: 'unknown', note: 'docker-proxy indisponível' };
  const mine = containers.filter((c) => c.name.startsWith(prefix));
  if (!mine.length) return { status: 'down', note: 'nenhum container encontrado' };
  const running = mine.filter((c) => c.state === 'running');
  const unhealthy = mine.filter((c) => c.health === 'unhealthy');
  if (!running.length) return { status: 'down', note: `${mine.length} containers parados` };
  if (running.length < mine.length || unhealthy.length) return { status: 'warn', note: `${running.length}/${mine.length} rodando${unhealthy.length ? `, ${unhealthy.length} unhealthy` : ''}` };
  return { status: 'ok', note: `${running.length} containers rodando` };
}

function mcpStatus(ref: string): { status: ToolStatus; note?: string } {
  const init = getInit();
  if (!init) return { status: 'unknown', note: 'capacidades ainda não capturadas' };
  const m = init.mcp.find((x) => norm(x.name) === norm(ref)) ?? init.mcp.find((x) => norm(x.name).endsWith(norm(ref)));
  if (!m) return { status: 'unknown', note: 'conector não encontrado no login atual' };
  if (m.status === 'needs-auth') return { status: 'needs-auth', note: 'autorize em claude.ai → Configurações → Conectores' };
  if (m.status === 'failed') return { status: 'down', note: 'falha de conexão do conector' };
  return { status: 'ok' };
}

let cache: { at: number; items: ToolboxItem[] } | null = null;

export async function toolboxWithStatus(force = false): Promise<ToolboxItem[]> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.items;
  const defs = loadToolbox();
  const containers = await listContainers().catch(() => null);
  const init = getInit();
  const repos = catalog();
  const items = await Promise.all(
    defs.map(async (d): Promise<ToolboxItem> => {
      const { type, ref } = d.access;
      let r: { status: ToolStatus; note?: string } = { status: 'unknown' };
      if (type === 'mcp' || type === 'browser') r = mcpStatus(ref);
      else if (type === 'skill') r = init ? { status: init.skills.some((s) => s === ref || s.endsWith(`:${ref}`)) ? 'ok' : 'unknown' } : { status: 'unknown' };
      else if (type === 'plugin') r = init ? { status: init.plugins.some((p) => p.name === ref) ? 'ok' : 'unknown' } : { status: 'unknown' };
      else if (type === 'stack') r = stackStatus(ref, containers);
      else if (type === 'url') r = { status: await urlStatus(ref) };
      else if (type === 'repo') r = repos.some((x) => x.name_with_owner === ref) ? { status: 'ok' } : { status: githubEnabled() ? 'warn' : 'unknown', note: 'repositório fora do catálogo do GitHub' };
      else if (type === 'cli') r = ref === 'gh' ? { status: githubEnabled() ? 'ok' : 'needs-auth', note: githubEnabled() ? undefined : 'rode gh auth login no container' } : { status: 'ok' };
      if (d.id === 'chrome' && r.status === 'ok') r = { status: 'warn', note: d.note ? undefined : 'depende do seu Chrome aberto com a extensão conectada' };
      // nota do toolbox.json já explica autorização → não repete a nota calculada
      if (r.status === 'needs-auth' && d.note && /autoriz/i.test(d.note)) r.note = undefined;
      return { ...d, status: r.status, note: [d.note, r.note].filter(Boolean).join(' · ') || undefined };
    }),
  );
  cache = { at: Date.now(), items };
  return items;
}

function validItems(body: unknown): ToolDef[] | null {
  if (!Array.isArray(body)) return null;
  const out: ToolDef[] = [];
  for (const x of body as Partial<ToolDef>[]) {
    if (!x || typeof x.id !== 'string' || typeof x.name !== 'string' || !x.access || typeof x.access.ref !== 'string') return null;
    out.push({
      id: x.id.slice(0, 60),
      name: x.name.slice(0, 80),
      category: String(x.category ?? 'Outros').slice(0, 40),
      purpose: String(x.purpose ?? '').slice(0, 400),
      access: { type: x.access.type ?? 'url', ref: x.access.ref.slice(0, 200) },
      agent: typeof x.agent === 'string' ? x.agent : null,
      examples: Array.isArray(x.examples) ? x.examples.filter((e) => typeof e === 'string').slice(0, 10) : [],
      ...(x.note ? { note: String(x.note).slice(0, 300) } : {}),
    });
  }
  return out;
}

export function register(app: FastifyInstance): void {
  ensureFile();

  app.get('/api/toolbox', () => toolboxWithStatus());
  // Catálogo curado do mapa do Claude Code (shared/claude-guide.json).
  app.get('/api/claude-guide', () => JSON.parse(readFileSync(new URL('../../shared/claude-guide.json', import.meta.url), 'utf8')));
  app.get('/api/toolbox/status', async () => ({ at: new Date().toISOString(), items: await toolboxWithStatus(true) }));
  app.put('/api/toolbox', async (req, reply) => {
    const items = validItems(req.body);
    if (!items) return reply.code(400).send({ error: 'lista inválida' });
    saveToolbox(items);
    return toolboxWithStatus(true);
  });

  registerBrain({
    name: 'toolbox',
    tools: [
      {
        type: 'function',
        name: 'list_tools',
        strict: true,
        description: 'Consulta a Caixa de Ferramentas do usuário (conectores, skills, stacks, apps, repositórios): para que serve, status e agente padrão.',
        parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: ['string', 'null'], description: 'nome/categoria/assunto; null lista tudo' } } },
      },
      {
        type: 'function',
        name: 'open_tools',
        strict: true,
        description: 'Abre o painel Ferramentas (conectores, MCP, skills, plugins, apps) no Canvas.',
        parameters: { type: 'object', additionalProperties: false, required: ['tab'], properties: { tab: { type: 'string', enum: ['connectors', 'mcp', 'skills', 'plugins', 'apps'] } } },
      },
    ],
    run(tool, args, ctx) {
      if (tool === 'list_tools') {
        if (ctx.dryRun) return Promise.resolve({ ok: true, itens: [] });
        const q = String(args.query ?? '').toLowerCase();
        return toolboxWithStatus().then((items) =>
          items
            .filter((t) => !q || `${t.name} ${t.category} ${t.purpose} ${t.examples.join(' ')}`.toLowerCase().includes(q))
            .slice(0, 20)
            .map((t) => ({ nome: t.name, categoria: t.category, serve: t.purpose, agente: t.agent, status: t.status, nota: t.note, exemplos: t.examples.slice(0, 2) })),
        );
      }
      if (tool === 'open_tools') {
        if (ctx.dryRun) return Promise.resolve({ ok: true });
        return import('./bus.ts').then(({ emit }) => {
          emit({ type: 'ui.action', action: { type: 'show_view', view: 'tools', params: { tab: String(args.tab) } } });
          return { ok: true };
        });
      }
      return undefined;
    },
    snapshot() {
      const items = cache?.items ?? loadToolbox().map((d) => ({ ...d, status: 'unknown' as ToolStatus }));
      if (!items.length) return '';
      const line = items
        .map((t) => `${t.name}${t.agent ? `→${t.agent}` : ''}${t.status === 'needs-auth' ? ' (pede autorização)' : t.status === 'down' ? ' (fora do ar)' : ''}`)
        .join('; ');
      return `Caixa de ferramentas (ferramenta→agente padrão): ${line}.`;
    },
    instructions: [
      '- Caixa de ferramentas: para pedidos que envolvem uma ferramenta listada, delegue ao agente padrão dela. Se estiver "pede autorização" ou "fora do ar", diga isso e como resolver em vez de tentar.',
      '- "Quais ferramentas/conectores/skills eu tenho?", "mostra os MCP" => open_tools (aba certa). Dúvida sobre como fazer algo com uma ferramenta => list_tools.',
      '- Design visual, protótipos, decks/slides e Claude Design => agente Designer.',
    ].join('\n'),
  });

  // aquece o cache de status para o snapshot do cérebro
  setTimeout(() => void toolboxWithStatus().catch(() => {}), 30_000).unref();
  setInterval(() => void toolboxWithStatus(true).catch(() => {}), 5 * 60_000).unref();
}
