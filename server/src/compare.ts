import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { RunInfo } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db } from './db.ts';
import { findAgent } from './agents.ts';
import { findProject } from './projects.ts';
import { enqueueRun, getRun } from './runs.ts';
import { registerBrain } from './extensions.ts';

// Refazer com outro modelo e comparar (versão leve dos evals do Paperclip): mesma instrução e agente, outro
// modelo. Em projeto com git a refeita roda numa cópia isolada (git worktree em .atria/compare/<id>); o usuário
// compara lado a lado e decide se aplica as mudanças da cópia no projeto ou descarta.

const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe', timeout: 60_000 });

export function startCompare(runId: string, model: string): RunInfo {
  const orig = db.prepare(`SELECT agent_id, project, instruction, task, state, compare_of FROM runs WHERE id = ?`).get(runId) as
    { agent_id: string; project: string | null; instruction: string; task: string; state: string; compare_of: string | null } | undefined;
  if (!orig) throw new Error('execução não encontrada');
  if (!['done', 'failed'].includes(orig.state)) throw new Error('espere a execução terminar para comparar');
  if (!/^[\w.:-]{2,80}$/.test(model)) throw new Error('modelo inválido');
  if (!findAgent(orig.agent_id)) throw new Error('o agente dessa execução não existe mais');
  const base = orig.compare_of ?? runId; // comparar uma refeita compara com o original
  return enqueueRun({ agentId: orig.agent_id, project: orig.project, instruction: orig.instruction, task: `↺ ${orig.task}`.slice(0, 110), origin: 'manual', compareOf: base, model });
}

interface Side { run: RunInfo; model: string | null; seconds: number | null; turns: number | null; diff: string | null; worktree: string | null }

function side(id: string): Side | null {
  const run = getRun(id);
  if (!run) return null;
  const r = db.prepare(`SELECT num_turns, worktree, model_used, model_override, started_at, finished_at FROM runs WHERE id = ?`).get(id) as
    { num_turns: number | null; worktree: string | null; model_used: string | null; model_override: string | null; started_at: string | null; finished_at: string | null };
  let diff: string | null = null;
  if (r.worktree && existsSync(r.worktree)) {
    try {
      git(r.worktree, ['add', '-A', '--intent-to-add', '.']);
      diff = git(r.worktree, ['diff', '--shortstat', 'HEAD']).trim() || 'sem mudanças';
    } catch {
      diff = null;
    }
  }
  return {
    run,
    model: r.model_used ?? r.model_override,
    seconds: r.started_at && r.finished_at ? Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000) : null,
    turns: r.num_turns,
    diff,
    worktree: r.worktree && existsSync(r.worktree) ? r.worktree : null,
  };
}

/** Original e refeitas de uma comparação (por qualquer um dos ids). */
export function comparison(id: string): { original: Side; refeitas: Side[] } | null {
  const row = db.prepare(`SELECT compare_of FROM runs WHERE id = ?`).get(id) as { compare_of: string | null } | undefined;
  if (!row) return null;
  const base = row.compare_of ?? id;
  const original = side(base);
  if (!original) return null;
  const ids = (db.prepare(`SELECT id FROM runs WHERE compare_of = ? ORDER BY created_at`).all(base) as { id: string }[]).map((x) => x.id);
  return { original, refeitas: ids.map(side).filter((s): s is Side => !!s) };
}

function worktreeOf(id: string): { wt: string; project: string } {
  const r = db.prepare(`SELECT worktree, project FROM runs WHERE id = ? AND compare_of IS NOT NULL`).get(id) as { worktree: string | null; project: string | null } | undefined;
  const p = r?.project ? findProject(r.project) : undefined;
  if (!r?.worktree || !existsSync(r.worktree) || !p) throw new Error('esta refeita não tem cópia isolada');
  return { wt: r.worktree, project: p.dir };
}

export class CompareConflict extends Error {
  conflicts: string[];
  constructor(conflicts: string[]) {
    super(`o projeto tem mudanças não salvas nos mesmos arquivos (${conflicts.slice(0, 5).join(', ')}${conflicts.length > 5 ? '…' : ''}), provavelmente da execução original`);
    this.conflicts = conflicts;
  }
}

/**
 * "Ficar com a refeita": aplica no projeto as mudanças da cópia e descarta a cópia.
 * Se o projeto tiver mudanças não salvas nos mesmos arquivos (em geral, da execução original), recusa com a lista;
 * com `replace`, esses arquivos passam a ser exatamente os da refeita.
 */
export function applyCompare(id: string, replace = false): { ok: true; stat: string } {
  const { wt, project } = worktreeOf(id);
  git(wt, ['add', '-A']);
  const patch = execFileSync('git', ['-C', wt, 'diff', '--cached', '--binary', 'HEAD'], { stdio: 'pipe', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (!patch.length) {
    discardCompare(id);
    return { ok: true, stat: 'sem mudanças para aplicar' };
  }
  const stat = git(wt, ['diff', '--cached', '--shortstat', 'HEAD']).trim();
  // arquivos que a refeita mudou: "A\tcaminho", "M\tcaminho", "D\tcaminho" (renomeados viram D + A)
  const changes = git(wt, ['diff', '--cached', '--name-status', '--no-renames', 'HEAD']).split('\n').filter(Boolean).map((l) => {
    const [st, ...rest] = l.split('\t');
    return { st: st[0], path: rest.join('\t') };
  });
  const dirty = new Set(git(project, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, '')));
  const conflicts = changes.map((c) => c.path).filter((p) => dirty.has(p));
  if (conflicts.length && !replace) throw new CompareConflict(conflicts);
  if (conflicts.length) {
    // substituir: cada arquivo mudado pela refeita fica igual ao da cópia
    for (const c of changes) {
      const dest = join(project, c.path);
      if (!dest.startsWith(`${project}/`)) continue;
      if (c.st === 'D') rmSync(dest, { force: true });
      else {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(wt, c.path), dest);
      }
    }
  } else {
    execFileSync('git', ['-C', project, 'apply', '--3way', '--whitespace=nowarn'], { input: patch, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 });
  }
  discardCompare(id);
  return { ok: true, stat };
}

export function discardCompare(id: string): boolean {
  const r = db.prepare(`SELECT worktree, project FROM runs WHERE id = ?`).get(id) as { worktree: string | null; project: string | null } | undefined;
  if (!r?.worktree) return false;
  const p = r.project ? findProject(r.project) : undefined;
  try {
    if (p) git(p.dir, ['worktree', 'remove', '--force', r.worktree]);
  } catch {
    /* cópia já sumiu ou git reclamou: apaga a pasta */
  }
  rmSync(r.worktree, { recursive: true, force: true });
  if (p) {
    try {
      git(p.dir, ['worktree', 'prune']);
    } catch {
      /* sem git */
    }
  }
  db.prepare(`UPDATE runs SET worktree = NULL WHERE id = ?`).run(id);
  return true;
}

// Cópias com mais de 7 dias saem sozinhas.
function cleanupWorktrees() {
  const dir = join(config.metaDir, 'compare');
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    try {
      if (Date.now() - statSync(join(dir, name)).mtimeMs > 7 * 86400_000) {
        if (!discardCompare(name)) rmSync(join(dir, name), { recursive: true, force: true });
      }
    } catch {
      /* segue */
    }
  }
}
setInterval(cleanupWorktrees, 6 * 3600_000).unref();

registerBrain({
  name: 'comparar',
  instructions: '- "Refaz isso com o Opus/outro modelo e compara" => comparar_execucao (sem id = última concluída; modelo como o usuário disser, ex.: claude-opus-5-5). Diga que roda numa cópia isolada e que o resultado aparece lado a lado em Execuções.',
  tools: [
    {
      type: 'function', name: 'comparar_execucao', strict: true,
      description: 'Refaz uma execução de agente com outro modelo, numa cópia isolada do projeto, para comparar.',
      parameters: { type: 'object', additionalProperties: false, properties: { run_id: { type: ['string', 'null'] }, modelo: { type: 'string' } }, required: ['run_id', 'modelo'] },
    },
  ],
  run(tool, args, ctx) {
    if (tool !== 'comparar_execucao') return undefined;
    const id = typeof args.run_id === 'string' && args.run_id ? args.run_id
      : (db.prepare(`SELECT id FROM runs WHERE state IN ('done','failed') ORDER BY finished_at DESC LIMIT 1`).get() as { id: string } | undefined)?.id;
    if (!id) return Promise.resolve({ ok: false, error: 'nenhuma execução concluída' });
    if (ctx.dryRun) return Promise.resolve({ ok: true });
    try {
      const r = startCompare(id, String(args.modelo ?? ''));
      return Promise.resolve({ ok: true, run_id: r.id, tarefa: r.task });
    } catch (e) {
      return Promise.resolve({ ok: false, error: (e as Error).message });
    }
  },
});

export function register(app: FastifyInstance): void {
  app.post('/api/runs/:id/compare', (req, reply) => {
    try {
      return startCompare((req.params as { id: string }).id, String((req.body as { model?: unknown } | undefined)?.model ?? ''));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
  app.get('/api/runs/:id/comparison', (req, reply) => comparison((req.params as { id: string }).id) ?? reply.code(404).send({ error: 'não encontrado' }));
  app.post('/api/runs/:id/compare/apply', (req, reply) => {
    try {
      return applyCompare((req.params as { id: string }).id, (req.body as { replace?: unknown } | undefined)?.replace === true);
    } catch (e) {
      if (e instanceof CompareConflict) return reply.code(409).send({ error: e.message, conflicts: e.conflicts });
      return reply.code(409).send({ error: `não consegui aplicar: ${(e as Error).message.split('\n')[0]}` });
    }
  });
  app.post('/api/runs/:id/compare/discard', (req, reply) => reply.code(discardCompare((req.params as { id: string }).id) ? 204 : 404).send());
}
