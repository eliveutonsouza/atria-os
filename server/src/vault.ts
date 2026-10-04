import { execFile } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { VaultBacklink, VaultFile, VaultGraphPayload, VaultSearchHit, VaultStatus, VaultTreeEntry } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { kvGet, kvSet } from './db.ts';
import { emit } from './bus.ts';
import { registerBrain, registerRunPrompt } from './extensions.ts';
import { listProjectConfigs } from './projects.ts';
import { basename, buildIndex, rings, shortestPath, suggest, type VaultIndex } from './vaultIndex.ts';

// Vault Obsidian exclusivo do Yui Console: notas .md em /workspace/.yui/vault, links [[…]] indexados
// em memória (grafo do Cérebro), histórico em git local com commit automático.

const exec = promisify(execFile);
export const vaultRoot = () => join(config.workspaceDir, '.yui', 'vault');
const MAX_FILE = 2_000_000;
const HIDDEN = new Set(['.git', '.trash']);
const NOT_NOTES = new Set(['.obsidian', '_templates', '.git', '.trash']);
const COMMIT_DEBOUNCE = 120_000;

// ---------- caminhos seguros ----------

export class VaultError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.code = code;
  }
}

// Resolve um caminho relativo dentro do vault. Recusa absoluto, "..", bytes nulos, symlinks e .git.
export function safePath(rel: unknown, opts: { mustExist?: boolean } = {}): { abs: string; rel: string } {
  if (typeof rel !== 'string' || !rel.trim() || rel.includes('\0')) throw new VaultError(400, 'caminho inválido');
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = clean.split('/');
  if (parts.some((p) => p === '..' || p === '.' || p === '')) throw new VaultError(400, 'caminho inválido');
  if (parts.some((p) => HIDDEN.has(p))) throw new VaultError(403, 'caminho protegido');
  const root = realpathSync(vaultRoot());
  const abs = resolve(root, clean);
  if (!abs.startsWith(root + sep)) throw new VaultError(400, 'fora do vault');
  // nenhum componente existente pode ser symlink (evita escapar do vault)
  let cur = root;
  for (const p of parts) {
    cur = join(cur, p);
    if (!existsSync(cur)) break;
    if (lstatSync(cur).isSymbolicLink()) throw new VaultError(403, 'symlink não permitido');
  }
  if (opts.mustExist && !existsSync(abs)) throw new VaultError(404, 'não encontrado');
  return { abs, rel: clean };
}

const isNote = (rel: string) => rel.toLowerCase().endsWith('.md') && !rel.split('/').some((p) => NOT_NOTES.has(p));

// ---------- leitura do disco ----------

function walk(dir: string, base: string, out: string[]) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (HIDDEN.has(e.name) || e.isSymbolicLink()) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) walk(join(dir, e.name), rel, out);
    else out.push(rel);
  }
}

function allFiles(): string[] {
  const out: string[] = [];
  if (existsSync(vaultRoot())) walk(vaultRoot(), '', out);
  return out;
}

let idx: VaultIndex = buildIndex([]);
let texts = new Map<string, string>();
let indexedAt = 0;

function reindex() {
  const inputs = [];
  const t = new Map<string, string>();
  for (const rel of allFiles().filter(isNote)) {
    const abs = join(vaultRoot(), rel);
    const st = statSync(abs);
    if (st.size > MAX_FILE) continue;
    const text = readFileSync(abs, 'utf8');
    t.set(rel, text);
    inputs.push({ path: rel, text, mtime: st.mtimeMs });
  }
  idx = buildIndex(inputs);
  texts = t;
  indexedAt = Date.now();
}

export function tree(): VaultTreeEntry[] {
  const out: VaultTreeEntry[] = [];
  const rec = (dir: string, base: string, depth: number): number => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => !HIDDEN.has(e.name) && !e.isSymbolicLink())
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    let count = 0;
    for (const e of entries) {
      const rel = base ? `${base}/${e.name}` : e.name;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        const at = out.length;
        out.push({ path: rel, name: e.name, dir: true, depth });
        const n = rec(abs, rel, depth + 1);
        out[at].count = n;
        count += n;
      } else {
        const st = statSync(abs);
        out.push({ path: rel, name: e.name, dir: false, depth, size: st.size, mtime: st.mtimeMs });
        if (e.name.endsWith('.md')) count++;
      }
    }
    return count;
  };
  if (existsSync(vaultRoot())) rec(vaultRoot(), '', 0);
  return out;
}

export function readNote(rel: string): VaultFile {
  const p = safePath(rel, { mustExist: true });
  const st = statSync(p.abs);
  if (st.isDirectory()) throw new VaultError(400, 'é uma pasta');
  if (st.size > MAX_FILE) throw new VaultError(413, 'arquivo grande demais');
  const text = readFileSync(p.abs, 'utf8');
  const n = idx.notes.get(p.rel);
  return { path: p.rel, text, mtime: st.mtimeMs, title: n?.title ?? basename(p.rel), tags: n?.tags ?? [], props: n?.props ?? {} };
}

function assertWritable(rel: string) {
  if (!/\.(md|canvas|txt|json|css)$/i.test(rel)) throw new VaultError(400, 'só .md (e arquivos de texto do vault) podem ser escritos');
}

export function writeNote(rel: string, text: string, baseMtime?: number): { path: string; mtime: number } {
  const p = safePath(rel);
  assertWritable(p.rel);
  if (Buffer.byteLength(text) > MAX_FILE) throw new VaultError(413, 'arquivo grande demais');
  if (baseMtime && existsSync(p.abs) && Math.abs(statSync(p.abs).mtimeMs - baseMtime) > 1) throw new VaultError(409, 'a nota mudou desde que você abriu');
  mkdirSync(dirname(p.abs), { recursive: true });
  writeFileSync(p.abs, text);
  changed([p.rel]);
  return { path: p.rel, mtime: statSync(p.abs).mtimeMs };
}

export function createNote(rel: string, text?: string): string {
  let r = rel.trim();
  if (!/\.[a-z]+$/i.test(r)) r += '.md';
  const p = safePath(r);
  assertWritable(p.rel);
  if (existsSync(p.abs)) throw new VaultError(409, 'já existe');
  mkdirSync(dirname(p.abs), { recursive: true });
  writeFileSync(p.abs, text ?? `# ${basename(p.rel)}\n\n`);
  changed([p.rel]);
  return p.rel;
}

export function removeNote(rel: string) {
  const p = safePath(rel, { mustExist: true });
  // lixeira do Obsidian em vez de apagar de vez
  const trash = join(vaultRoot(), '.trash', `${Date.now()}-${p.rel.replace(/\//g, '__')}`);
  mkdirSync(dirname(trash), { recursive: true });
  renameSync(p.abs, trash);
  changed([p.rel]);
}

function moveNote(from: string, to: string): string {
  const a = safePath(from, { mustExist: true });
  const b = safePath(to);
  if (existsSync(b.abs)) throw new VaultError(409, 'destino já existe');
  mkdirSync(dirname(b.abs), { recursive: true });
  renameSync(a.abs, b.abs);
  changed([a.rel, b.rel]);
  return b.rel;
}

// ---------- mudanças: reindex + evento + commit ----------

let pendingPaths = new Set<string>();
let flushTimer: NodeJS.Timeout | null = null;
let commitTimer: NodeJS.Timeout | null = null;
let selfWriteUntil = 0;

function changed(paths: string[]) {
  for (const p of paths) pendingPaths.add(p);
  selfWriteUntil = Date.now() + 500;
  scheduleFlush(50);
}

function scheduleFlush(ms: number) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const paths = [...pendingPaths];
    pendingPaths = new Set();
    try {
      reindex();
    } catch (e) {
      console.error('vault reindex', (e as Error).message);
    }
    emit({ type: 'vault.changed', paths, at: indexedAt });
    scheduleCommit();
  }, ms);
}

function startWatcher() {
  try {
    const w = watch(vaultRoot(), { recursive: true }, (_ev, file) => {
      if (!file) return;
      const rel = String(file).split(sep).join('/');
      if (rel.split('/').some((p) => p === '.git')) return;
      pendingPaths.add(rel);
      scheduleFlush(Date.now() < selfWriteUntil ? 50 : 400);
    });
    w.on('error', (e) => console.error('vault watch', e.message));
  } catch (e) {
    // sem watch recursivo: reindexa periodicamente
    console.error('vault watch indisponível', (e as Error).message);
    setInterval(() => scheduleFlush(0), 30_000).unref();
  }
}

// ---------- git local ----------

const git = (...args: string[]) => exec('git', ['-C', vaultRoot(), ...args], { timeout: 20_000, maxBuffer: 4_000_000 });

async function ensureGit() {
  if (existsSync(join(vaultRoot(), '.git'))) return;
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'Yui');
  await git('config', 'user.email', 'yui@yui-console.local');
  await git('config', 'core.quotepath', 'false');
  const gi = join(vaultRoot(), '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, '.trash/\n.obsidian/workspace*.json\n.obsidian/cache\n.DS_Store\n');
  await commitNow('vault: início');
}

let lastCommit: { at: string; msg: string } | null = null;

async function commitNow(msg?: string) {
  try {
    const { stdout } = await git('status', '--porcelain');
    const files = stdout.split('\n').filter(Boolean);
    if (!files.length) return;
    await git('add', '-A');
    const m = msg ?? `vault: ${files.length} ${files.length === 1 ? 'nota alterada' : 'notas alteradas'}`;
    await git('commit', '-q', '-m', m);
    lastCommit = { at: new Date().toISOString(), msg: m };
  } catch (e) {
    console.error('vault git', (e as Error).message);
  }
}

function scheduleCommit() {
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    commitTimer = null;
    commitNow().catch(() => {});
  }, COMMIT_DEBOUNCE);
  commitTimer.unref();
}

async function status(): Promise<VaultStatus> {
  let pending = 0;
  let last = lastCommit;
  try {
    pending = (await git('status', '--porcelain')).stdout.split('\n').filter(Boolean).length;
    if (!last) {
      const { stdout } = await git('log', '-1', '--format=%cI%x00%s');
      const [at, msg] = stdout.trim().split('\0');
      if (at) last = lastCommit = { at, msg };
    }
  } catch {
    /* sem git ainda */
  }
  const editor = await fetch(`${config.codeUrl}/code/`, { signal: AbortSignal.timeout(2500), redirect: 'manual' })
    .then((r) => r.status < 500)
    .catch(() => false);
  return { notes: idx.notes.size, links: idx.graph.links.length, pending, lastCommitAt: last?.at ?? null, lastCommitMsg: last?.msg ?? null, editor };
}

// ---------- seed + workspace do VS Code ----------

function seedVault() {
  const src = join(config.seedDir, '.yui', 'vault');
  mkdirSync(vaultRoot(), { recursive: true });
  if (!existsSync(src)) return;
  const seeded = new Set<string>(JSON.parse(kvGet('vault_seeded') ?? '[]'));
  const files: string[] = [];
  walk(src, '', files);
  let n = 0;
  for (const f of files) {
    // semeia cada arquivo uma vez: se o usuário apagar, não volta
    if (seeded.has(f)) continue;
    const dst = join(vaultRoot(), f);
    if (!existsSync(dst)) {
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(join(src, f), dst);
      n++;
    }
    seeded.add(f);
  }
  kvSet('vault_seeded', JSON.stringify([...seeded]));
  if (n) console.log(`vault: ${n} arquivos semeados`);
}

export const codeWorkspaceFile = () => join(config.workspaceDir, '.yui', 'yui.code-workspace');
let lastWorkspaceJson = '';

// Workspace multi-root do VS Code: vault primeiro, depois os projetos clonados.
export function writeCodeWorkspace() {
  const projects = listProjectConfigs()
    .filter((p) => p.cloned)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((p) => ({ name: p.name, path: relative(join(config.workspaceDir, '.yui'), p.dir) }));
  const ws = {
    folders: [{ name: 'Vault', path: 'vault' }, ...projects],
    settings: {
      'files.exclude': { '**/.git': true, '**/.trash': true, '**/node_modules': true },
      'workbench.startupEditor': 'none',
      'foam.files.ignore': ['**/.obsidian/**', '**/_templates/**', '**/node_modules/**'],
    },
  };
  const json = JSON.stringify(ws, null, 2);
  if (json === lastWorkspaceJson) return;
  lastWorkspaceJson = json;
  writeFileSync(codeWorkspaceFile(), json);
}

// ---------- utilidades para outros módulos ----------

export function search(q: string, limit = 30): VaultSearchHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const hits: (VaultSearchHit & { score: number })[] = [];
  for (const [path, text] of texts) {
    const n = idx.notes.get(path)!;
    const inTitle = n.title.toLowerCase().includes(needle) || path.toLowerCase().includes(needle);
    const lines = text.split('\n');
    const li = lines.findIndex((l) => l.toLowerCase().includes(needle));
    if (!inTitle && li < 0) continue;
    const line = li < 0 ? 0 : li;
    hits.push({ path, title: n.title, line: line + 1, snippet: (lines[line] ?? '').trim().slice(0, 200), score: (inTitle ? 2 : 0) + (li >= 0 ? 1 : 0) + (n.tags.includes(needle.replace(/^#/, '')) ? 1 : 0) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map(({ score: _s, ...h }) => h);
}

export function backlinks(rel: string): VaultBacklink[] {
  const out: VaultBacklink[] = [];
  for (const src of idx.inc.get(rel) ?? []) {
    const n = idx.notes.get(src);
    if (!n) continue;
    const l = n.links.find((x) => idx.resolve(x.target, src) === rel);
    const lines = (texts.get(src) ?? '').split('\n');
    const line = l?.line ?? 1;
    out.push({ path: src, title: n.title, line, snippet: (lines[line - 1] ?? '').trim().slice(0, 220) });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
}

export function graph(): VaultGraphPayload {
  const counts = new Map<string, number>();
  for (const n of idx.graph.nodes) if (!n.ghost) counts.set(n.folder, (counts.get(n.folder) ?? 0) + 1);
  return {
    nodes: idx.graph.nodes,
    links: idx.graph.links,
    folders: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true })),
    at: indexedAt,
  };
}

// Acrescenta [[alvo]] na seção "## Relacionadas" (cria a seção se faltar).
export function linkNotes(from: string, to: string) {
  const a = readNote(from);
  const wl = `[[${basename(to)}]]`;
  if (a.text.includes(wl)) return;
  let text = a.text.replace(/\s*$/, '\n');
  if (/^## Relacionadas\s*$/m.test(text)) text = text.replace(/^## Relacionadas\s*$/m, (h) => `${h}\n- ${wl}`);
  else text += `\n## Relacionadas\n- ${wl}\n`;
  writeNote(from, text);
}

// Grava (ou acrescenta a) uma nota usada pela automação (relatórios, diário, lições).
export function upsertNote(rel: string, text: string, mode: 'replace' | 'append' = 'replace') {
  const p = safePath(rel);
  const cur = existsSync(p.abs) ? readFileSync(p.abs, 'utf8') : '';
  writeNote(rel, mode === 'append' && cur ? `${cur.replace(/\s*$/, '\n')}${text}` : text);
}

export const vaultNoteCount = () => idx.notes.size;

// ---------- HTTP ----------

export function register(app: FastifyInstance) {
  seedVault();
  reindex();
  startWatcher();
  ensureGit().catch((e) => console.error('vault git init', e.message));
  try {
    writeCodeWorkspace();
  } catch (e) {
    console.error('code-workspace', (e as Error).message);
  }
  setInterval(() => {
    try {
      writeCodeWorkspace();
    } catch {
      /* ignora */
    }
  }, 60_000).unref();

  const wrap = <T>(fn: () => T | Promise<T>) => async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof VaultError) return reply.code(e.code).send({ error: e.message });
      throw e;
    }
  };
  type Q = Record<string, string | undefined>;

  app.get('/api/vault/tree', () => tree());
  app.get('/api/vault/graph', () => graph());
  app.get('/api/vault/status', () => status());
  app.get('/api/vault/file', (req, reply) => wrap(() => readNote((req.query as Q).path ?? ''))(req, reply));
  app.put('/api/vault/file', (req, reply) =>
    wrap(() => {
      const b = (req.body ?? {}) as { path?: string; text?: unknown; baseMtime?: number };
      if (typeof b.text !== 'string') throw new VaultError(400, 'text');
      return writeNote(b.path ?? '', b.text, b.baseMtime);
    })(req, reply),
  );
  app.post('/api/vault/file', (req, reply) =>
    wrap(() => {
      const b = (req.body ?? {}) as { path?: string; text?: string };
      return { path: createNote(b.path ?? '', typeof b.text === 'string' ? b.text : undefined) };
    })(req, reply),
  );
  app.delete('/api/vault/file', (req, reply) =>
    wrap(() => {
      removeNote((req.query as Q).path ?? '');
      return reply.code(204).send(undefined);
    })(req, reply),
  );
  app.post('/api/vault/move', (req, reply) =>
    wrap(() => {
      const b = (req.body ?? {}) as { from?: string; to?: string };
      return { path: moveNote(b.from ?? '', b.to ?? '') };
    })(req, reply),
  );
  app.get('/api/vault/backlinks', (req, reply) => wrap(() => backlinks(safePath((req.query as Q).path).rel))(req, reply));
  app.get('/api/vault/rings', (req, reply) =>
    wrap(() => {
      const q = req.query as Q;
      return rings(idx, safePath(q.path).rel, Math.max(1, Math.min(3, Number(q.depth) || 2)));
    })(req, reply),
  );
  app.get('/api/vault/path', (req) => {
    const q = req.query as Q;
    return { path: q.from && q.to ? shortestPath(idx, q.from, q.to) : null };
  });
  app.get('/api/vault/suggest', (req, reply) =>
    wrap(() => {
      const rel = safePath((req.query as Q).path).rel;
      return suggest(idx, texts, rel).map((s) => ({ ...s, title: idx.notes.get(s.id)?.title ?? basename(s.id) }));
    })(req, reply),
  );
  app.post('/api/vault/link', (req, reply) =>
    wrap(() => {
      const b = (req.body ?? {}) as { from?: string; to?: string };
      linkNotes(safePath(b.from, { mustExist: true }).rel, safePath(b.to, { mustExist: true }).rel);
      return reply.code(204).send(undefined);
    })(req, reply),
  );
  app.get('/api/vault/search', (req) => search((req.query as Q).q ?? ''));
  // Ponte com o VS Code (extensão yui-bridge no yui-code): pedir para abrir e saber o que está aberto.
  const bridge = (f: string) => join(config.workspaceDir, '.yui', f);
  app.post('/api/vault/open', (req, reply) =>
    wrap(() => {
      const b = (req.body ?? {}) as { path?: string; line?: number };
      const p = safePath(b.path, { mustExist: true });
      writeFileSync(bridge('.editor-open.json'), JSON.stringify({ path: p.abs.replace(realpathSync(vaultRoot()), join(config.workspaceDir, '.yui', 'vault')), line: Number(b.line) || 0, at: Date.now() }));
      return reply.code(204).send(undefined);
    })(req, reply),
  );
  app.get('/api/vault/editor-state', () => {
    try {
      const st = JSON.parse(readFileSync(bridge('.editor-state.json'), 'utf8')) as { path: string; at: number };
      const prefix = join(config.workspaceDir, '.yui', 'vault') + '/';
      return { path: st.path.startsWith(prefix) ? st.path.slice(prefix.length) : null, abs: st.path, at: st.at };
    } catch {
      return { path: null, abs: null, at: 0 };
    }
  });
  app.post('/api/vault/commit', async () => {
    await commitNow();
    return status();
  });
}

// ---------- agentes e Yui ----------

registerRunPrompt(() =>
  [
    '- Vault (memória de longo prazo do Yui Console, formato Obsidian): /workspace/.yui/vault. Notas .md com [[links]] por nome de arquivo e #tags.',
    '  · Antes de decidir algo relevante, procure no vault (rg em /workspace/.yui/vault) se já existe decisão ou lição.',
    '  · Lição aprendida (erro que não deve se repetir, truque que funcionou): acrescente em 03-Agentes/<SeuNome>.md na seção "## Lições" uma linha "- AAAA-MM-DD: lição — [[nota relacionada]]".',
    '  · Decisão de arquitetura/produto: crie 02-Decisoes/ADR-NNN <título curto>.md a partir de _templates/ADR.md (próximo número livre) e ligue ao projeto com [[...]].',
    '  · Não apague nem reescreva notas de outros; acrescente. Use links para o projeto ([[<projeto>]]) e para o dia ([[AAAA-MM-DD]]).',
  ].join('\n'),
);

registerBrain({
  name: 'vault',
  instructions: `- Vault/cérebro (memória de longo prazo): perguntas sobre decisões, histórico, o que foi feito, lições, "você lembra…" => vault_search e vault_read antes de responder; cite a nota.
- "abre o vault/a nota X" => open_vault; "mostra o cérebro/as conexões/a constelação de X" => open_brain (path opcional).
- "anota/guarda isso" => vault_write_note (00-Inbox por padrão), com [[links]] para notas existentes.`,
  tools: [
    {
      type: 'function', name: 'vault_search', strict: true,
      description: 'Busca no vault (títulos, texto e tags). Devolve notas com trecho.',
      parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' } } },
    },
    {
      type: 'function', name: 'vault_read', strict: true,
      description: 'Lê uma nota do vault (caminho relativo ou nome) com backlinks.',
      parameters: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string' } } },
    },
    {
      type: 'function', name: 'vault_write_note', strict: true,
      description: 'Cria ou acrescenta texto markdown numa nota do vault. Caminho relativo (ex.: 00-Inbox/Ideia X.md).',
      parameters: {
        type: 'object', additionalProperties: false, required: ['path', 'text', 'mode'],
        properties: { path: { type: 'string' }, text: { type: 'string' }, mode: { type: 'string', enum: ['create', 'append'] } },
      },
    },
    {
      type: 'function', name: 'open_vault', strict: true,
      description: 'Abre a tela Vault (arquivos + editor), opcionalmente numa nota.',
      parameters: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: ['string', 'null'] } } },
    },
    {
      type: 'function', name: 'open_brain', strict: true,
      description: 'Abre o Cérebro (universo de conexões). Com path, abre a constelação daquela nota.',
      parameters: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: ['string', 'null'] } } },
    },
  ],
  run(tool, args, ctx) {
    const find = (p: unknown) => {
      if (typeof p !== 'string' || !p.trim()) return null;
      return idx.notes.has(p) ? p : idx.resolve(p.replace(/\.md$/i, ''));
    };
    try {
      if (tool === 'vault_search') return Promise.resolve(search(String(args.query), 8));
      if (tool === 'vault_read') {
        const p = find(args.path);
        if (!p) return Promise.resolve({ ok: false, error: 'nota não encontrada' });
        const n = readNote(p);
        return Promise.resolve({ path: p, title: n.title, text: n.text.slice(0, 8000), backlinks: backlinks(p).map((b) => b.title) });
      }
      if (tool === 'vault_write_note') {
        if (ctx.dryRun) return Promise.resolve({ ok: true, dryRun: true });
        let rel = String(args.path);
        if (!rel.includes('/')) rel = `00-Inbox/${rel}`;
        if (!rel.endsWith('.md')) rel += '.md';
        upsertNote(rel, String(args.text), args.mode === 'append' ? 'append' : 'replace');
        return Promise.resolve({ ok: true, path: rel });
      }
      if (tool === 'open_vault' || tool === 'open_brain') {
        const p = find(args.path);
        if (!ctx.dryRun) emit({ type: 'ui.action', action: { type: 'show_view', view: tool === 'open_vault' ? 'vault' : 'brain', params: p ? { note: p } : {} } });
        return Promise.resolve({ ok: true, path: p });
      }
    } catch (e) {
      return Promise.resolve({ ok: false, error: (e as Error).message });
    }
    return undefined;
  },
  snapshot: () => `Vault: ${idx.notes.size} notas, ${idx.graph.links.length} links.`,
});
