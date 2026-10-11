import type { FastifyInstance } from 'fastify';
import { emit } from './bus.ts';
import { activeProject, addProject, findProject, projectSummaries, readProjectSettings, removeProject, validateSettings, writeProjectSettings } from './projects.ts';
import { loadToolbox } from './toolbox.ts';
import { registerBrain } from './extensions.ts';

// Projetos pelo painel: adicionar (clonar do catálogo ou URL), remover o clone local e editar o atria.json.

const codeOf = (e: unknown) => (e as { code?: unknown }).code;
const fail = (e: unknown) => ({ status: typeof codeOf(e) === 'number' ? (codeOf(e) as number) : 400, error: (e as Error).message });

// Objetivo do projeto por voz: "o objetivo do Stoqmate é…" / "qual o objetivo deste projeto?".
registerBrain({
  name: 'objetivo-projeto',
  instructions: '- "O objetivo do projeto X é…", "qual o objetivo deste projeto?" => objetivo_projeto (sem projeto citado = o ativo; objetivo null = só ler). Responda em 1 frase.',
  tools: [
    {
      type: 'function', name: 'objetivo_projeto', strict: true,
      description: 'Lê ou define o objetivo de um projeto (entra no prompt de todos os agentes que trabalham nele).',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          projeto: { type: ['string', 'null'], description: 'slug ou nome; null = projeto ativo' },
          objetivo: { type: ['string', 'null'], description: 'novo objetivo (até 600 caracteres); null = só ler; "" = apagar' },
        },
        required: ['projeto', 'objetivo'],
      },
    },
  ],
  run(tool, args, ctx) {
    if (tool !== 'objetivo_projeto') return undefined;
    const p = findProject(typeof args.projeto === 'string' && args.projeto ? args.projeto : (ctx.project ?? activeProject()));
    if (!p) return Promise.resolve({ ok: false, error: 'projeto não encontrado; diga qual projeto' });
    try {
      const cur = readProjectSettings(p.slug);
      if (typeof args.objetivo !== 'string') return Promise.resolve({ ok: true, projeto: p.name, objetivo: cur.goal || null });
      if (ctx.dryRun) return Promise.resolve({ ok: true, projeto: p.name, objetivo: args.objetivo });
      const v = validateSettings({ ...cur, goal: args.objetivo });
      if ('error' in v) return Promise.resolve({ ok: false, error: v.error });
      const saved = writeProjectSettings(p.slug, v.ok);
      return Promise.resolve({ ok: true, projeto: p.name, objetivo: saved.goal || null });
    } catch (e) {
      return Promise.resolve({ ok: false, error: (e as Error).message });
    }
  },
});

export function register(app: FastifyInstance): void {
  app.post('/api/projects', async (req, reply) => {
    const b = (req.body ?? {}) as { repo?: unknown; url?: unknown; slug?: unknown };
    const repo = typeof b.repo === 'string' && b.repo.trim() ? b.repo.trim() : undefined;
    const url = typeof b.url === 'string' && b.url.trim() ? b.url.trim() : undefined;
    if (!repo === !url) return reply.code(400).send({ error: 'informe repo (do catálogo) ou url' });
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) return reply.code(400).send({ error: 'repo no formato dono/nome' });
    try {
      const p = await addProject({ repo, url, slug: typeof b.slug === 'string' ? b.slug : undefined });
      emit({ type: 'ui.action', action: { type: 'switch_project', project: p.slug, name: p.name } });
      return reply.code(201).send({ slug: p.slug, name: p.name, projects: await projectSummaries() });
    } catch (e) {
      const f = fail(e);
      return reply.code(/já existe|já está/.test(f.error) ? 409 : f.status).send({ error: f.error });
    }
  });

  app.delete('/api/projects/:slug', async (req, reply) => {
    try {
      removeProject((req.params as { slug: string }).slug);
      return { projects: await projectSummaries() };
    } catch (e) {
      const f = fail(e);
      return reply.code(f.status).send({ error: f.error });
    }
  });

  app.get('/api/projects/:slug/config', async (req, reply) => {
    try {
      return readProjectSettings((req.params as { slug: string }).slug);
    } catch (e) {
      const f = fail(e);
      return reply.code(f.status).send({ error: f.error });
    }
  });

  app.put('/api/projects/:slug/config', async (req, reply) => {
    const v = validateSettings(req.body);
    if ('error' in v) return reply.code(400).send({ error: v.error });
    try {
      return writeProjectSettings((req.params as { slug: string }).slug, v.ok);
    } catch (e) {
      const f = fail(e);
      return reply.code(f.status).send({ error: f.error });
    }
  });

  // Lista crua do toolbox.json para o editor do painel: GET /api/toolbox junta a nota calculada
  // (status) à nota salva, e regravar essa lista acumularia notas no arquivo.
  app.get('/api/toolbox/defs', () => loadToolbox().map(({ status: _s, ...d }) => d));
}
