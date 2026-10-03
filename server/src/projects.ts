import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LogsPayload, ProjectDetail, ProjectSummary, Tone } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, kvGet, kvSet } from './db.ts';
import { containerLogs } from './docker.ts';
import { sandboxUrl } from './sandbox.ts';
import { catalog, ensureCloned } from './github.ts';

// Projeto = diretório em /workspace/<slug>. Configuração opcional em /workspace/<slug>/yui.json:
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
      const f = join(dir, 'yui.json');
      if (existsSync(f)) {
        try {
          cfg = JSON.parse(readFileSync(f, 'utf8'));
        } catch {
          /* yui.json inválido: ignora */
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
  if (!p.container) return { project: p.slug, source: '', summary: 'Este projeto não tem container configurado no yui.json.', lines: [] };
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
