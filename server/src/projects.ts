import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { LogsPayload, ProjectDetail, ProjectSummary, Tone } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, kvGet, kvSet } from './db.ts';
import { containerLogs } from './docker.ts';
import { sandboxUrl } from './sandbox.ts';
import { catalog, ensureCloned, projectConfigFile } from './github.ts';
import { trustDirs } from './trust.ts';

// Projeto = diretório em /workspace/<slug>. Configuração opcional em /workspace/<slug>/atria.json:
// { "name": "Stoqmate", "healthUrl": "https://...", "container": "stoqmate-api", "preview": "dist",
//   "approvalPatterns": ["npm run deploy"] }
export interface ProjectConfig {
  slug: string;
  name: string;
  dir: string;
  cloned: boolean; // false = só no catálogo do GitHub, clona sob demanda
  repo?: string; // owner/name
  description?: string | null;
  pushedAt?: string | null;
  healthUrl?: string;
  container?: string;
  preview?: string;
  approvalPatterns?: string[];
}

function localProjects(): ProjectConfig[] {
  if (!existsSync(config.workspaceDir)) return [];
  return readdirSync(config.workspaceDir)
    .filter((d) => !d.startsWith('.') && statSync(join(config.workspaceDir, d)).isDirectory())
    .sort()
    .map((slug) => {
      const dir = join(config.workspaceDir, slug);
      let cfg: Partial<ProjectConfig> = {};
      const f = projectConfigFile(dir);
      if (existsSync(f)) {
        try {
          cfg = JSON.parse(readFileSync(f, 'utf8'));
        } catch {
          /* atria.json inválido: ignora */
        }
      }
      return { ...cfg, slug, dir, cloned: true, name: cfg.name ?? slug } as ProjectConfig;
    });
}

// Pastas do workspace + repositórios do GitHub ainda não clonados.
export function listProjectConfigs(): ProjectConfig[] {
  const local = localProjects();
  const repos = catalog();
  const byRepo = new Map(repos.map((r) => [r.name_with_owner, r]));
  for (const p of local) {
    const r = p.repo ? byRepo.get(p.repo) : repos.find((x) => x.slug === p.slug);
    if (r) {
      p.repo ??= r.name_with_owner;
      p.description ??= r.description;
      p.pushedAt = r.pushed_at;
      byRepo.delete(r.name_with_owner);
    }
  }
  const remote = [...byRepo.values()]
    .filter((r) => !r.archived)
    .map((r) => ({
      slug: r.slug, name: r.name, dir: join(config.workspaceDir, r.slug), cloned: false,
      repo: r.name_with_owner, description: r.description, pushedAt: r.pushed_at,
    }) satisfies ProjectConfig);
  return [...local, ...remote];
}

export function findProject(q: string | null | undefined): ProjectConfig | undefined {
  if (!q) return undefined;
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const k = norm(q);
  if (!k) return undefined;
  const all = listProjectConfigs();
  return all.find((p) => norm(p.slug) === k || norm(p.name) === k || (p.repo && norm(p.repo) === k)) ??
    all.find((p) => norm(p.name).startsWith(k) || k.startsWith(norm(p.name))) ??
    all.find((p) => norm(p.name).includes(k) || (k.length > 4 && k.includes(norm(p.name)))) ??
    closest(all, k, norm);
}

// Fala/transcrição erra nomes ("autocomissão" vs repo "autocomiss-o"): menor distância de edição, até 2.
function closest(all: ProjectConfig[], k: string, norm: (s: string) => string): ProjectConfig | undefined {
  if (k.length < 5) return undefined;
  let best: ProjectConfig | undefined;
  let bestD = 3;
  for (const p of all) {
    const d = editDistance(k, norm(p.name));
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Clona se o projeto ainda só existe no GitHub; devolve a config já local.
export async function ensureProject(p: ProjectConfig): Promise<ProjectConfig> {
  if (p.cloned || !p.repo) return p;
  await ensureCloned(p.repo);
  return findProject(p.slug) ?? p;
}

export const activeProject = () => kvGet('active_project');
export const setActiveProject = (slug: string) => kvSet('active_project', slug);

const healthCache = new Map<string, { at: number; ok: boolean | null }>();
async function probe(p: ProjectConfig): Promise<boolean | null> {
  if (!p.healthUrl) return null;
  const c = healthCache.get(p.slug);
  if (c && Date.now() - c.at < 60_000) return c.ok;
  const ok = await fetch(p.healthUrl, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false);
  healthCache.set(p.slug, { at: Date.now(), ok });
  return ok;
}

function runStats(slug: string) {
  const rows = db
    .prepare(`SELECT state, task, agent_id, finished_at, created_at FROM runs WHERE project = ? ORDER BY created_at DESC LIMIT 20`)
    .all(slug) as { state: string; task: string; agent_id: string; finished_at: string | null; created_at: string }[];
  const active = rows.filter((r) => r.state === 'running' || r.state === 'queued' || r.state === 'waiting_approval');
  const done = rows.filter((r) => r.state === 'done' || r.state === 'failed');
  const failedLast = done[0]?.state === 'failed';
  const success = done.length ? done.filter((r) => r.state === 'done').length / done.length : null;
  return { rows, active, failedLast, success };
}

export async function projectSummary(p: ProjectConfig): Promise<ProjectSummary> {
  if (!p.cloned) {
    return {
      slug: p.slug, name: p.name, status: 'No GitHub', tone: 'muted', health: null,
      note: [p.description, p.pushedAt ? `push ${relTime(p.pushedAt)}` : null].filter(Boolean).join(' · ') || p.repo || '',
    };
  }
  const ok = await probe(p);
  const s = runStats(p.slug);
  let tone: Tone = 'ok';
  let status = 'Saudável';
  if (ok === false) {
    tone = 'warn';
    status = 'Fora do ar';
  } else if (s.failedLast) {
    tone = 'warn';
    status = 'Atenção';
  } else if (ok === null && !s.rows.length) {
    tone = 'cyan';
    status = 'Novo';
  }
  const healthBase = ok === false ? 40 : 96;
  const health = ok === null && s.success === null ? null : Math.round(healthBase * (s.success === null ? 1 : 0.7 + 0.3 * s.success));
  const notes: string[] = [];
  if (s.active.length) notes.push(`${s.active.length} agente${s.active.length > 1 ? 's' : ''} trabalhando`);
  if (s.failedLast) notes.push('última execução falhou');
  if (!notes.length) notes.push(s.rows[0] ? `última atividade ${relTime(s.rows[0].finished_at ?? s.rows[0].created_at)}` : 'sem execuções ainda');
  return { slug: p.slug, name: p.name, note: notes.join(' · '), status, tone, health };
}

export async function projectSummaries(): Promise<ProjectSummary[]> {
  return Promise.all(listProjectConfigs().filter((p) => p.cloned).map(projectSummary));
}

export async function projectDetail(p: ProjectConfig): Promise<ProjectDetail> {
  const sum = await projectSummary(p);
  const s = runStats(p.slug);
  const lastFailed = s.rows.find((r) => r.state === 'failed');
  const issue = sum.tone === 'warn' ? (sum.status === 'Fora do ar' ? `Health check falhando em ${p.healthUrl}.` : `Última execução falhou: ${lastFailed?.task ?? ''}`) : null;
  return {
    ...sum,
    issue,
    kpis: [
      { label: 'Saúde', value: sum.health === null ? '—' : `${sum.health}%`, tone: sum.tone },
      { label: 'Status', value: sum.status, tone: sum.tone === 'ok' ? undefined : sum.tone },
      { label: 'Agentes', value: s.active.length ? `${s.active.length} trabalhando` : 'dormindo' },
      { label: 'Execuções', value: String(s.rows.length) },
    ],
    activity: s.rows.slice(0, 8).map((r) => ({
      t: hhmm(r.finished_at ?? r.created_at),
      label: `${r.task}`,
      tone: r.state === 'done' ? 'ok' : r.state === 'failed' ? 'warn' : r.state === 'running' ? 'cyan' : 'muted',
    })),
    hasPreview: !!p.preview && existsSync(join(p.dir, p.preview)),
    previewUrl: p.preview && existsSync(join(p.dir, p.preview)) ? sandboxUrl(p.slug) : null,
    hasLogs: !!p.container,
  };
}

export async function projectLogs(p: ProjectConfig): Promise<LogsPayload> {
  if (!p.container) return { project: p.slug, source: '', summary: 'Este projeto não tem container configurado no atria.json.', lines: [] };
  const raw = await containerLogs(p.container, 200);
  const lines = raw.map((l) => {
    const m = /^(\S+)\s(.*)$/.exec(l);
    const ts = m?.[1] ?? '';
    const msg = m?.[2] ?? l;
    const level = /\b(error|fatal|exception)\b/i.test(msg) ? 'ERROR' : /\bwarn(ing)?\b/i.test(msg) ? 'WARN' : /\bdebug\b/i.test(msg) ? 'DEBUG' : 'INFO';
    return { t: ts ? new Date(ts).toLocaleTimeString('pt-BR', { timeZone: config.timezone }) : '', level, msg } as LogsPayload['lines'][number];
  });
  const errors = lines.filter((l) => l.level === 'ERROR').length;
  return {
    project: p.slug,
    source: p.container,
    summary: errors ? `${errors} linha${errors > 1 ? 's' : ''} de erro nas últimas ${lines.length}.` : `Sem erros nas últimas ${lines.length} linhas.`,
    lines,
  };
}

export function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: config.timezone });
}

export function relTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'agora';
  if (s < 3600) return `há ${Math.round(s / 60)}min`;
  if (s < 86400) return `há ${Math.round(s / 3600)}h`;
  return `há ${Math.round(s / 86400)}d`;
}

// ---------- CRUD de projetos (painel) ----------

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const run = promisify(execFile);

// Projeto local por slug exato (nunca por aproximação: é usado para apagar).
export function localProject(slug: string): ProjectConfig | undefined {
  return localProjects().find((p) => p.slug === slug);
}

const projectDirOf = (slug: string) => {
  const dir = resolve(config.workspaceDir, slug);
  if (!dir.startsWith(resolve(config.workspaceDir) + sep) || slug.startsWith('.') || slug.includes('/')) throw new Error('slug inválido');
  return dir;
};

export function slugFromUrl(url: string): string {
  const last = new URL(url).pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  return last.replace(/\.git$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
}

// URL https sem credenciais embutidas (tokens ficam no gh/credential helper, nunca no .git/config).
export function validGitUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname || u.pathname.split('/').filter(Boolean).length < 2) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function removedProjects(): string[] {
  const raw = kvGet('projects_removed');
  return raw ? (JSON.parse(raw) as string[]) : [];
}
const unremove = (slug: string) => kvSet('projects_removed', JSON.stringify(removedProjects().filter((s) => s !== slug)));

export async function addProject(input: { repo?: string; url?: string; slug?: string }): Promise<ProjectConfig> {
  if (input.repo) {
    const r = catalog().find((x) => x.name_with_owner === input.repo);
    if (!r) throw new Error(`repositório fora do catálogo: ${input.repo}`);
    if (localProject(r.slug)) throw new Error(`o projeto ${r.slug} já está no Atria OS`);
    unremove(r.slug);
    await ensureCloned(r.name_with_owner);
    return localProject(r.slug) ?? (() => { throw new Error('clone não apareceu no workspace'); })();
  }
  const url = validGitUrl(input.url);
  if (!url) throw new Error('informe uma URL git https válida (sem usuário/senha), ex.: https://github.com/dono/repo.git');
  const slug = (input.slug || slugFromUrl(url)).trim();
  if (!SLUG_RE.test(slug)) throw new Error('nome da pasta inválido: use letras minúsculas, números e hífen');
  const dir = projectDirOf(slug);
  if (existsSync(dir)) throw new Error(`já existe a pasta ${slug} no workspace`);
  unremove(slug);
  try {
    await run('git', ['clone', '--filter=blob:none', '--', url, dir], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 600_000, maxBuffer: 20 * 1024 * 1024 });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    const msg = String((e as { stderr?: string }).stderr || (e as Error).message).trim().split('\n').pop();
    throw new Error(`não consegui clonar: ${msg}`);
  }
  const gh = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(url)?.[1];
  writeFileSync(join(dir, 'atria.json'), `${JSON.stringify({ name: slug, ...(gh ? { repo: gh } : {}) }, null, 2)}\n`);
  const exclude = join(dir, '.git', 'info', 'exclude');
  if (existsSync(exclude) && !readFileSync(exclude, 'utf8').includes('atria.json')) writeFileSync(exclude, `${readFileSync(exclude, 'utf8')}\natria.json\n`);
  trustDirs([dir]);
  return localProject(slug)!;
}

export function activeRunsIn(slug: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM runs WHERE project = ? AND state IN ('running','queued','waiting_approval')`).get(slug) as { n: number }).n;
}

// Remove só a pasta local do clone; o repositório no GitHub não é tocado.
export function removeProject(slug: string): void {
  const p = localProject(slug);
  if (!p) throw Object.assign(new Error('projeto não está no Atria OS'), { code: 404 });
  if (activeRunsIn(slug)) throw Object.assign(new Error('há execuções ativas neste projeto; cancele antes de remover'), { code: 409 });
  rmSync(projectDirOf(slug), { recursive: true, force: true });
  healthCache.delete(slug);
  // não volta sozinho no próximo início (o clone automático dos repositórios recentes pula os removidos)
  const removed = new Set(removedProjects());
  removed.add(slug);
  kvSet('projects_removed', JSON.stringify([...removed]));
  if (activeProject() === slug) kvSet('active_project', '');
}

export interface ProjectSettings {
  name?: string;
  healthUrl?: string;
  container?: string;
  preview?: string;
  approvalPatterns?: string[];
}

export function readProjectSettings(slug: string): ProjectSettings & { repo?: string } {
  const p = localProject(slug);
  if (!p) throw Object.assign(new Error('projeto não está no Atria OS'), { code: 404 });
  return { name: p.name, repo: p.repo, healthUrl: p.healthUrl, container: p.container, preview: p.preview, approvalPatterns: p.approvalPatterns ?? [] };
}

// Valida e normaliza; devolve a mensagem de erro em vez de lançar.
export function validateSettings(b: unknown): { ok: ProjectSettings } | { error: string } {
  if (!b || typeof b !== 'object') return { error: 'corpo inválido' };
  const x = b as Record<string, unknown>;
  const str = (k: string) => (x[k] === undefined || x[k] === null ? '' : typeof x[k] === 'string' ? (x[k] as string).trim() : null);
  const out: ProjectSettings = {};
  const name = str('name');
  if (name === null || name.length > 80) return { error: 'nome inválido (até 80 caracteres)' };
  if (name) out.name = name;
  const health = str('healthUrl');
  if (health === null) return { error: 'healthUrl inválida' };
  if (health) {
    try {
      const u = new URL(health);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'healthUrl precisa começar com http(s)://' };
    } catch {
      return { error: 'healthUrl inválida' };
    }
    out.healthUrl = health;
  }
  const container = str('container');
  if (container === null || (container && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container))) return { error: 'container inválido (nome do container Docker)' };
  if (container) out.container = container;
  const preview = str('preview');
  if (preview === null || (preview && (preview.startsWith('/') || preview.split(/[\\/]/).includes('..') || preview.length > 120))) return { error: 'preview precisa ser uma pasta relativa ao projeto (ex.: dist)' };
  if (preview) out.preview = preview.replace(/\/+$/, '');
  const pats = x.approvalPatterns ?? [];
  if (!Array.isArray(pats) || pats.length > 20 || pats.some((p) => typeof p !== 'string' || p.length > 200)) return { error: 'approvalPatterns: lista de até 20 textos (até 200 caracteres cada)' };
  out.approvalPatterns = (pats as string[]).map((p) => p.trim()).filter(Boolean);
  return { ok: out };
}

// Grava no atria.json preservando chaves que o painel não edita (repo etc.).
export function writeProjectSettings(slug: string, s: ProjectSettings): ProjectSettings & { repo?: string } {
  const p = localProject(slug);
  if (!p) throw Object.assign(new Error('projeto não está no Atria OS'), { code: 404 });
  const f = projectConfigFile(p.dir);
  let cfg: Record<string, unknown> = {};
  if (existsSync(f)) {
    try {
      cfg = JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      /* atria.json inválido: recomeça */
    }
  }
  for (const k of ['healthUrl', 'container', 'preview'] as const) {
    if (s[k]) cfg[k] = s[k];
    else delete cfg[k];
  }
  if (s.name) cfg.name = s.name;
  if (s.approvalPatterns?.length) cfg.approvalPatterns = s.approvalPatterns;
  else delete cfg.approvalPatterns;
  writeFileSync(f, `${JSON.stringify(cfg, null, 2)}\n`);
  healthCache.delete(slug);
  return readProjectSettings(slug);
}
