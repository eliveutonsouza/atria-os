import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { NotifyChannel, RunInfo } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, now, uid } from './db.ts';
import { emit } from './bus.ts';
import { findProject } from './projects.ts';
import { runBus, workflowRunDir } from './runs.ts';
import { registerAgentOptions, registerBrain, registerRunPrompt } from './extensions.ts';
import { publicUrl, sendNotice } from './notify.ts';

// Entregas dos agentes (ideia do Paperclip: artefatos registrados e verificados). Duas portas:
//  - automática: ao fim da execução, o que caiu na pasta da execução de workflow, em .atria/reports e as
//    imagens novas na raiz do projeto (screenshots);
//  - explícita: a ferramenta mcp__entregas__registrar_entrega, para o resto.
// Nunca um hook em todo Write (inundaria com código). Arquivos ficam onde estão; a tabela é o índice.

for (const [col, def] of [['run_id', 'TEXT'], ['size', 'INTEGER'], ['sha256', 'TEXT'], ['pinned', 'INTEGER NOT NULL DEFAULT 0'], ['mime', 'TEXT']] as const) {
  if (!db.prepare(`SELECT 1 FROM pragma_table_info('artifacts') WHERE name = ?`).get(col)) db.exec(`ALTER TABLE artifacts ADD COLUMN ${col} ${def}`);
}

export interface Entrega {
  id: string;
  title: string;
  kind: string;
  project: string | null;
  path: string;
  runId: string | null;
  size: number;
  pinned: boolean;
  createdAt: string;
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.md': 'text/markdown', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.zip': 'application/zip',
};
const kindOf = (p: string) => {
  const e = extname(p).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(e)) return 'image';
  if (['.csv', '.xlsx'].includes(e)) return 'table';
  if (e === '.html') return 'html';
  if (e === '.json' && p.includes('/.atria/reports/')) return 'report';
  return 'other';
};
const IGNORE = /(^|\/)(node_modules|\.git|\.next|dist|build|\.cache)(\/|$)|\.(tmp|lock|log)$/;
const MAX_BYTES = 200 * 1024 * 1024;

/** Caminho real dentro do workspace (nada fora dele vira entrega). */
export function insideWorkspace(p: string): string | null {
  try {
    const real = realpathSync(resolve(p));
    const root = realpathSync(config.workspaceDir);
    return real === root || !real.startsWith(`${root}/`) ? null : real;
  } catch {
    return null;
  }
}

// síncrono de propósito: missões conferem as entregas logo depois da varredura (arquivos ≤ 200 MB)
const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

type Row = { id: string; kind: string; title: string; project: string | null; path: string; created_at: string; run_id: string | null; size: number | null; pinned: number };
const toEntrega = (r: Row): Entrega => ({ id: r.id, title: r.title, kind: r.kind, project: r.project, path: r.path, runId: r.run_id, size: r.size ?? 0, pinned: !!r.pinned, createdAt: r.created_at });

/** Registra (ou atualiza, se o caminho já existe) um arquivo como entrega. */
export function registerArtifact(path: string, opts: { title?: string | null; project: string | null; runId: string | null }): Entrega | { error: string } {
  const real = insideWorkspace(path);
  if (!real) return { error: 'o arquivo precisa existir dentro do /workspace' };
  const st = statSync(real);
  if (!st.isFile()) return { error: 'não é um arquivo' };
  if (st.size > MAX_BYTES) return { error: 'arquivo grande demais (mais de 200 MB)' };
  const hash = sha256(real);
  const title = (opts.title?.trim() || basename(real)).slice(0, 160);
  const cur = db.prepare(`SELECT id FROM artifacts WHERE path = ?`).get(real) as { id: string } | undefined;
  const id = cur?.id ?? uid();
  if (cur) {
    db.prepare(`UPDATE artifacts SET title = ?, size = ?, sha256 = ?, run_id = COALESCE(?, run_id), created_at = ? WHERE id = ?`).run(title, st.size, hash, opts.runId, now(), id);
  } else {
    db.prepare(`INSERT INTO artifacts(id, kind, title, project, path, created_at, run_id, size, sha256, mime) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, kindOf(real), title, opts.project, real, now(), opts.runId, st.size, hash, MIME[extname(real).toLowerCase()] ?? null);
  }
  const e = getArtifact(id)!;
  emit({ type: 'artifact.created', artifact: { id: e.id, kind: e.kind as never, title: e.title, project: e.project, createdAt: e.createdAt, url: null } });
  return e;
}

export const getArtifact = (id: string): Entrega | null => {
  const r = db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) as Row | undefined;
  return r ? toEntrega(r) : null;
};

export function listArtifacts(opts: { project?: string | null; runId?: string; q?: string; limit?: number } = {}): Entrega[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.project !== undefined) {
    where.push('project IS ?');
    args.push(opts.project);
  }
  if (opts.runId) {
    where.push('run_id = ?');
    args.push(opts.runId);
  }
  if (opts.q) {
    where.push('(title LIKE ? OR path LIKE ?)');
    args.push(`%${opts.q}%`, `%${opts.q}%`);
  }
  const rows = db.prepare(`SELECT * FROM artifacts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`).all(...args, Math.min(200, opts.limit ?? 50)) as Row[];
  // arquivo apagado do disco some da lista
  return rows.map(toEntrega).filter((e) => existsSync(e.path));
}

// Arquivos novos (mtime ≥ início da execução) numa pasta; recursivo só na pasta da execução.
function newFiles(dir: string, sinceMs: number, recursive: boolean, out: string[] = [], depth = 0): string[] {
  if (!existsSync(dir) || out.length >= 30 || depth > 4) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (IGNORE.test(p)) continue;
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (recursive) newFiles(p, sinceMs, true, out, depth + 1);
    } else if (st.mtimeMs >= sinceMs && st.size > 0 && st.size <= MAX_BYTES) out.push(p);
    if (out.length >= 30) break;
  }
  return out;
}

/** Varre o que a execução gerou (exportado para os testes). */
export function scanRun(run: { id: string; project: string | null; workflow_run_id: string | null; started_at: string | null }): Entrega[] {
  if (!run.started_at) return [];
  const since = Date.parse(run.started_at) - 1000;
  const p = run.project ? findProject(run.project) : undefined;
  const root = p?.dir ?? join(config.metaDir, 'scratch');
  const files: string[] = [];
  if (run.workflow_run_id) newFiles(workflowRunDir(root, run.workflow_run_id), since, true, files);
  newFiles(join(config.metaDir, 'reports'), since, false, files);
  for (const f of newFiles(root, since, false)) if (kindOf(f) === 'image') files.push(f);
  const out: Entrega[] = [];
  for (const f of [...new Set(files)].slice(0, 30)) {
    const r = registerArtifact(f, { project: run.project, runId: run.id, title: null });
    if (!('error' in r)) out.push(r);
  }
  return out;
}

/** Varredura por id (missões chamam antes de conferir as entregas; repetir é inofensivo). */
export function scanRunById(id: string): Entrega[] {
  const row = db.prepare(`SELECT id, project, workflow_run_id, started_at, state FROM runs WHERE id = ?`).get(id) as (Parameters<typeof scanRun>[0] & { state: string }) | undefined;
  if (!row || row.state !== 'done') return [];
  try {
    return scanRun(row);
  } catch (e) {
    console.error('entregas', (e as Error).message);
    return [];
  }
}
runBus.on('finished', (info: RunInfo) => {
  if (info.state === 'done' && !info.missionId) scanRunById(info.id);
});

// ---------- envio e limpeza ----------

export async function sendArtifact(id: string, channels: NotifyChannel[]): Promise<{ ok: boolean; error?: string; title?: string }> {
  const e = getArtifact(id);
  if (!e || !existsSync(e.path)) return { ok: false, error: 'entrega não encontrada' };
  if (e.size > 10 * 1024 * 1024 && channels.includes('email')) return { ok: false, error: 'grande demais para e-mail (10 MB)' };
  const res = await sendNotice({ title: `Entrega · ${e.title}`, text: e.project ? `Do projeto ${findProject(e.project)?.name ?? e.project}.` : 'Arquivo gerado pelos agentes.', files: [e.path], url: publicUrl('/app'), channels, kind: 'notice' });
  const ok = res.some((r) => r.ok);
  return ok ? { ok, title: e.title } : { ok, error: res.map((r) => `${r.channel}: ${r.error ?? 'falhou'}`).join('; ') };
}

/** Entregas com mais de 30 dias (não fixadas) e acima de 2 GB no total: só apaga arquivos de .atria/; o resto sai do índice. */
export function cleanupArtifacts(nowMs = Date.now(), maxBytes = 2 * 1024 ** 3, maxDays = 30): { removed: number; deleted: number } {
  const rows = db.prepare(`SELECT * FROM artifacts WHERE pinned = 0 ORDER BY created_at DESC`).all() as Row[];
  const meta = `${config.metaDir}/`;
  let total = 0;
  let removed = 0;
  let deleted = 0;
  for (const r of rows) {
    total += r.size ?? 0;
    const old = nowMs - Date.parse(r.created_at) > maxDays * 86400_000;
    if (!old && total <= maxBytes) continue;
    if (r.path.startsWith(meta) && existsSync(r.path) && !insideGit(r.path)) {
      try {
        rmSync(r.path, { force: true });
        deleted++;
      } catch {
        /* segue */
      }
    }
    db.prepare(`DELETE FROM artifacts WHERE id = ?`).run(r.id);
    removed++;
  }
  return { removed, deleted };
}
// arquivo versionado no git do projeto nunca é apagado (o .atria/ fica fora do git, mas por garantia)
function insideGit(p: string): boolean {
  const rel = relative(config.workspaceDir, p).split('/')[0];
  return !!rel && existsSync(join(config.workspaceDir, rel, '.git')) && !p.includes('/.atria/');
}
setInterval(() => cleanupArtifacts(), 6 * 3600_000).unref();

// ---------- agentes: ferramenta explícita ----------

registerRunPrompt(() => '- Entregáveis (PDF, planilha, imagem, relatório, documento final): registre cada um com mcp__entregas__registrar_entrega (caminho + título) para o usuário achar e receber depois. O que você grava na pasta da execução de workflow já é registrado sozinho. Nunca diga que entregou um caminho que não existe.');

registerAgentOptions((_agentId, ctx) => {
  if (!ctx) return {};
  const runRow = () => db.prepare(`SELECT project FROM runs WHERE id = ?`).get(ctx.runId) as { project: string | null } | undefined;
  const server = createSdkMcpServer({
    name: 'entregas',
    version: '1.0.0',
    tools: [
      tool(
        'registrar_entrega',
        'Registra um arquivo final que você gerou (PDF, planilha, imagem, documento) como entrega desta tarefa, para o usuário achar e receber por Telegram/e-mail.',
        { caminho: z.string().describe('caminho absoluto do arquivo dentro de /workspace'), titulo: z.string().describe('título curto em português') },
        async ({ caminho, titulo }) => {
          const r = registerArtifact(caminho, { title: titulo, project: runRow()?.project ?? null, runId: ctx.runId });
          return 'error' in r ? { content: [{ type: 'text', text: `Não registrei: ${r.error}` }], isError: true } : { content: [{ type: 'text', text: `Entrega registrada: ${r.title} (${Math.round(r.size / 1024)} KB).` }] };
        },
      ),
    ],
  });
  return { mcpServers: { entregas: server } };
});

// ---------- Yui ----------

registerBrain({
  name: 'entregas',
  instructions: '- "Me manda o relatório/PDF/arquivo que o agente fez", "quais arquivos saíram hoje?" => listar_entregas (filtre por texto/projeto) e enviar_artefato com o id certo (padrão: Telegram). Confirme em 1 frase o que mandou.',
  tools: [
    {
      type: 'function', name: 'listar_entregas', strict: true,
      description: 'Lista os arquivos entregues pelos agentes (mais recentes primeiro).',
      parameters: { type: 'object', additionalProperties: false, properties: { texto: { type: ['string', 'null'] }, projeto: { type: ['string', 'null'] } }, required: ['texto', 'projeto'] },
    },
    {
      type: 'function', name: 'enviar_artefato', strict: true,
      description: 'Envia uma entrega ao usuário por Telegram, e-mail ou push.',
      parameters: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, canais: { type: 'array', items: { type: 'string', enum: ['telegram', 'email', 'push'] } } }, required: ['id', 'canais'] },
    },
  ],
  run(tool, args, ctx) {
    if (tool === 'listar_entregas') {
      const p = typeof args.projeto === 'string' && args.projeto ? findProject(args.projeto) : undefined;
      const list = listArtifacts({ ...(p ? { project: p.slug } : {}), ...(typeof args.texto === 'string' && args.texto ? { q: args.texto } : {}), limit: 10 });
      return Promise.resolve({ entregas: list.map((e) => ({ id: e.id, titulo: e.title, projeto: e.project ?? 'Geral', quando: e.createdAt, tamanho_kb: Math.round(e.size / 1024) })) });
    }
    if (tool === 'enviar_artefato') {
      if (ctx.dryRun) return Promise.resolve({ ok: true });
      const ch = (Array.isArray(args.canais) && args.canais.length ? args.canais : ['telegram']) as NotifyChannel[];
      return sendArtifact(String(args.id), ch);
    }
    return undefined;
  },
});

export function register(app: FastifyInstance): void {
  app.get('/api/entregas', (req) => {
    const q = req.query as { project?: string; run?: string; q?: string; limit?: string };
    return listArtifacts({ ...(q.project !== undefined ? { project: q.project || null } : {}), ...(q.run ? { runId: q.run } : {}), ...(q.q ? { q: q.q } : {}), limit: Number(q.limit) || 60 });
  });
  app.get('/api/entregas/:id/file', (req, reply) => {
    const e = getArtifact((req.params as { id: string }).id);
    if (!e || !insideWorkspace(e.path)) return reply.code(404).send({ error: 'não encontrado' });
    const download = (req.query as { download?: string }).download === '1';
    reply.header('content-type', MIME[extname(e.path).toLowerCase()] ?? 'application/octet-stream');
    reply.header('content-disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(basename(e.path))}`);
    reply.header('x-content-type-options', 'nosniff');
    // html/svg abrem como download: não rodam script na origem do painel
    if (/\.(html?|svg)$/i.test(e.path) && !download) reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    return reply.send(createReadStream(e.path));
  });
  app.post('/api/entregas/:id/pin', (req, reply) => {
    const on = (req.body as { pinned?: unknown } | undefined)?.pinned !== false;
    const r = db.prepare(`UPDATE artifacts SET pinned = ? WHERE id = ?`).run(on ? 1 : 0, (req.params as { id: string }).id);
    return reply.code(r.changes ? 204 : 404).send();
  });
  app.post('/api/entregas/:id/send', async (req, reply) => {
    const ch = (req.body as { channels?: unknown } | undefined)?.channels;
    const list = (Array.isArray(ch) ? ch : ['telegram']).filter((c): c is NotifyChannel => c === 'telegram' || c === 'email' || c === 'push');
    const r = await sendArtifact((req.params as { id: string }).id, list);
    return r.ok ? r : reply.code(400).send(r);
  });
}
