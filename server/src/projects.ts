import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LogsPayload, ProjectDetail, ProjectSummary, Tone } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, kvGet, kvSet } from './db.ts';
import { containerLogs } from './docker.ts';
import { sandboxUrl } from './sandbox.ts';

// Projeto = diretório em /workspace/<slug>. Configuração opcional em /workspace/<slug>/yui.json:
// { "name": "Stoqmate", "healthUrl": "https://...", "container": "stoqmate-api", "preview": "dist",
//   "approvalPatterns": ["npm run deploy"] }
export interface ProjectConfig {
  slug: string;
  name: string;
  dir: string;
  healthUrl?: string;
  container?: string;
  preview?: string;
  approvalPatterns?: string[];
}

export function listProjectConfigs(): ProjectConfig[] {
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
      return { ...cfg, slug, dir, name: cfg.name ?? slug } as ProjectConfig;
    });
}

export function findProject(q: string | null | undefined): ProjectConfig | undefined {
  if (!q) return undefined;
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const k = norm(q);
  return listProjectConfigs().find((p) => norm(p.slug) === k || norm(p.name) === k) ??
    listProjectConfigs().find((p) => norm(p.name).includes(k) || k.includes(norm(p.name)));
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
  return Promise.all(listProjectConfigs().map(projectSummary));
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
