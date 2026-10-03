import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';
import { db, now } from './db.ts';
import { listContainers } from './docker.ts';

// Projetos do usuário = repositórios do GitHub. Catálogo automático (gh repo list) + clone sob demanda.

const run = promisify(execFile);
const gh = (args: string[]) => run('gh', args, { env: process.env, maxBuffer: 20 * 1024 * 1024, timeout: 120_000 });
const git = (args: string[], cwd?: string) => run('git', args, { cwd, env: process.env, maxBuffer: 20 * 1024 * 1024, timeout: 600_000 });

export interface RepoRow {
  name_with_owner: string;
  name: string;
  owner: string;
  description: string | null;
  language: string | null;
  pushed_at: string | null;
  archived: number;
  url: string;
}

export const githubEnabled = () => !!process.env.GH_TOKEN;

export async function initGithub(): Promise<void> {
  if (!githubEnabled()) {
    console.log('github: GH_TOKEN ausente — catálogo desligado');
    return;
  }
  await gh(['auth', 'setup-git']).catch((e) => console.error('gh setup-git', e.message));
  const me = await gh(['api', 'user', '-q', '.login + "\\t" + (.name // .login)']).then((r) => r.stdout.trim().split('\t')).catch(() => null);
  if (me) {
    await git(['config', '--global', 'user.name', me[1] || me[0]]);
    await git(['config', '--global', 'user.email', `${me[0]}@users.noreply.github.com`]);
  }
}

export async function syncCatalog(): Promise<number> {
  if (!githubEnabled()) return 0;
  const owners = [''];
  const orgs = await gh(['api', 'user/orgs', '-q', '.[].login']).then((r) => r.stdout.split('\n').filter(Boolean)).catch(() => []);
  owners.push(...orgs);
  const fields = 'name,nameWithOwner,description,pushedAt,isArchived,primaryLanguage,url';
  const upsert = db.prepare(`INSERT INTO repos(name_with_owner, name, owner, description, language, pushed_at, archived, url, synced_at)
    VALUES(@nwo, @name, @owner, @description, @language, @pushed_at, @archived, @url, @synced_at)
    ON CONFLICT(name_with_owner) DO UPDATE SET description = excluded.description, language = excluded.language,
      pushed_at = excluded.pushed_at, archived = excluded.archived, url = excluded.url, synced_at = excluded.synced_at`);
  const stamp = now();
  let n = 0;
  for (const owner of owners) {
    const args = ['repo', 'list', ...(owner ? [owner] : []), '--limit', '300', '--json', fields];
    const list = await gh(args)
      .then((r) => JSON.parse(r.stdout) as { name: string; nameWithOwner: string; description: string; pushedAt: string; isArchived: boolean; primaryLanguage: { name: string } | null; url: string }[])
      .catch((e) => {
        console.error(`gh repo list ${owner || '(user)'}`, e.message);
        return [];
      });
    for (const r of list) {
      upsert.run({
        nwo: r.nameWithOwner, name: r.name, owner: r.nameWithOwner.split('/')[0], description: r.description || null,
        language: r.primaryLanguage?.name ?? null, pushed_at: r.pushedAt || null, archived: r.isArchived ? 1 : 0, url: r.url, synced_at: stamp,
      });
      n++;
    }
  }
  // Repos que sumiram do GitHub (ou do token) saem do catálogo.
  if (n) db.prepare('DELETE FROM repos WHERE synced_at < ?').run(stamp);
  return n;
}

export function catalog(): (RepoRow & { slug: string })[] {
  const rows = db.prepare('SELECT * FROM repos ORDER BY pushed_at DESC').all() as RepoRow[];
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.name.toLowerCase(), (count.get(r.name.toLowerCase()) ?? 0) + 1);
  return rows.map((r) => ({ ...r, slug: count.get(r.name.toLowerCase())! > 1 ? `${r.owner}-${r.name}` : r.name }));
}

const cloning = new Map<string, Promise<string>>();

// Garante o repositório em /workspace/<slug>; devolve o diretório.
export function ensureCloned(nameWithOwner: string): Promise<string> {
  const repo = catalog().find((r) => r.name_with_owner === nameWithOwner);
  if (!repo) return Promise.reject(new Error(`repo fora do catálogo: ${nameWithOwner}`));
  const dir = join(config.workspaceDir, repo.slug);
  if (existsSync(join(dir, '.git'))) return Promise.resolve(dir);
  const pending = cloning.get(nameWithOwner);
  if (pending) return pending;
  const p = (async () => {
    console.log(`github: clonando ${nameWithOwner}`);
    await git(['clone', '--filter=blob:none', `https://github.com/${nameWithOwner}.git`, dir]);
    await writeYuiJson(dir, repo.name, nameWithOwner);
    return dir;
  })().finally(() => cloning.delete(nameWithOwner));
  cloning.set(nameWithOwner, p);
  return p;
}

// Atualiza um clone limpo (fast-forward); clones com alterações locais ficam como estão.
export async function refreshClone(dir: string): Promise<void> {
  const dirty = await git(['status', '--porcelain'], dir).then((r) => r.stdout.trim().length > 0).catch(() => true);
  if (dirty) return;
  await git(['pull', '--ff-only', '--quiet'], dir).catch(() => {});
}

async function writeYuiJson(dir: string, name: string, nameWithOwner: string) {
  const f = join(dir, 'yui.json');
  const cfg: Record<string, unknown> = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  cfg.name ??= name;
  cfg.repo ??= nameWithOwner;
  if (cfg.preview === undefined) {
    const preview = ['out', 'dist', 'build'].find((d) => existsSync(join(dir, d, 'index.html')));
    if (preview) cfg.preview = preview;
  }
  if (cfg.container === undefined) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const c = await listContainers()
      .then((l) => l.find((x) => x.state === 'running' && norm(x.name).startsWith(norm(name))))
      .catch(() => undefined);
    if (c) cfg.container = c.name;
  }
  writeFileSync(f, `${JSON.stringify(cfg, null, 2)}\n`);
  // yui.json é config local do console, não do repo.
  const exclude = join(dir, '.git', 'info', 'exclude');
  if (existsSync(exclude) && !readFileSync(exclude, 'utf8').includes('yui.json')) writeFileSync(exclude, `${readFileSync(exclude, 'utf8')}\nyui.json\n`);
}

export async function startGithub(): Promise<void> {
  if (!githubEnabled()) return;
  await initGithub();
  const n = await syncCatalog();
  console.log(`github: ${n} repositórios no catálogo`);
  const recent = catalog().filter((r) => !r.archived && r.pushed_at && Date.now() - new Date(r.pushed_at).getTime() < 30 * 86400_000);
  for (const r of recent) {
    await ensureCloned(r.name_with_owner).catch((e) => console.error(`clone ${r.name_with_owner}:`, e.message));
  }
  setInterval(() => void syncCatalog().catch((e) => console.error('sync', e.message)), 30 * 60_000).unref();
}
