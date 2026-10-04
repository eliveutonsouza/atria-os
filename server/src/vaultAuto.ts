import cron from 'node-cron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunInfo } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db } from './db.ts';
import { runBus } from './runs.ts';
import { findProject } from './projects.ts';
import { upsertNote, vaultRoot } from './vault.ts';

// Conteúdo automático do vault: relatório por execução, nota do projeto e nota do dia.

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function localParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour === '24' ? '00' : p.hour}${p.minute}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

// Nome de arquivo seguro e legível.
const fileSafe = (s: string, max = 60) =>
  s
    .replace(/[\\/:*?"<>|#^[\]\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[.\s]+$/, '')
    .trim() || 'sem título';

const exists = (rel: string) => existsSync(join(vaultRoot(), rel));

function ensureDaily(day: string) {
  const rel = `Diario/${day}.md`;
  if (!exists(rel)) upsertNote(rel, `---\ntipo: diário\ntags: [diario]\n---\n# ${day}\n\n## Execuções\n`);
  return rel;
}

// Acrescenta uma linha no fim da seção "## <título>" (cria a seção no fim da nota se faltar).
function appendUnder(rel: string, heading: string, line: string) {
  const abs = join(vaultRoot(), rel);
  const text = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  const lines = text.replace(/\s*$/, '').split('\n');
  const h = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (h < 0) {
    upsertNote(rel, `${lines.join('\n')}\n\n## ${heading}\n${line}\n`);
    return;
  }
  let end = h + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
  while (end > h + 1 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, line.replace(/\n$/, ''));
  upsertNote(rel, `${lines.join('\n')}\n`);
}

function ensureProjectNote(slug: string) {
  const p = findProject(slug);
  const name = fileSafe(p?.name ?? slug);
  const rel = `05-Projetos/${name}.md`;
  if (!exists(rel)) {
    upsertNote(
      rel,
      `---\ntipo: projeto\nslug: ${slug}\n${p?.repo ? `repo: ${p.repo}\n` : ''}tags: [repo]\n---\n# ${name}\n\n${p?.description ?? ''}\n\nParte de [[Projetos]].\n\n## Execuções\n`,
    );
  }
  return name;
}

export function writeRunReport(run: RunInfo) {
  if (run.state !== 'done' && run.state !== 'failed') return;
  const { day, hm, time } = localParts(run.finishedAt ? new Date(run.finishedAt) : new Date());
  const daily = ensureDaily(day);
  const project = run.project ? ensureProjectNote(run.project) : null;
  const changedFiles = run.tools.some((t) => EDIT_TOOLS.has(t));
  const icon = run.state === 'done' ? '✓' : '✗';
  const task = run.task.replace(/\s+/g, ' ').trim();

  // Execução sem mudança e sem falha: só uma linha no diário (menos ruído no Cérebro).
  if (!changedFiles && run.state === 'done') {
    appendUnder(daily, 'Execuções', `- ${time} ${icon} [[${run.agent}]]${project ? ` em [[${project}]]` : ''}: ${task.slice(0, 160)}`);
    return;
  }

  const title = `${day} ${hm} ${run.agent} - ${fileSafe(task, 50)}`;
  const rel = `04-Execucoes/${title}.md`;
  const steps = run.steps.map((s) => `- [${s.status === 'done' ? 'x' : ' '}] ${s.label}`).join('\n');
  const body = [
    '---',
    'tipo: execução',
    `agente: ${run.agent}`,
    project ? `projeto: ${run.project}` : null,
    `estado: ${run.state === 'done' ? 'concluída' : 'falhou'}`,
    `run: ${run.id}`,
    `custo_usd: ${run.costUsd.toFixed(4)}`,
    'tags: [execucao]',
    '---',
    `# ${run.agent} - ${fileSafe(task, 80)}`,
    '',
    `Agente: [[${run.agent}]]${project ? ` · Projeto: [[${project}]]` : ''} · Dia: [[${day}]]`,
    '',
    '## Pedido',
    task,
    '',
    '## Resultado',
    run.result?.trim() || '(sem resumo)',
    steps ? `\n## Passos\n${steps}` : null,
    run.tools.length ? `\n## Ferramentas\n${[...new Set(run.tools)].join(', ')}` : null,
    '',
  ]
    .filter((l) => l !== null)
    .join('\n');
  upsertNote(rel, body);
  appendUnder(daily, 'Execuções', `- ${time} ${icon} [[${title}]]`);
  if (project) appendUnder(`05-Projetos/${project}.md`, 'Execuções', `- [[${title}]]`);
}

// Fechamento do dia: resumo com números reais do banco.
export function closeDay(d = new Date()) {
  const { day } = localParts(d);
  const rel = ensureDaily(day);
  const since = new Date(d.getTime() - 24 * 3600_000).toISOString();
  const r = db
    .prepare(`SELECT state, COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS c FROM runs WHERE finished_at > ? GROUP BY state`)
    .all(since) as { state: string; n: number; c: number }[];
  const n = (s: string) => r.find((x) => x.state === s)?.n ?? 0;
  const cost = r.reduce((s, x) => s + x.c, 0);
  upsertNote(rel, `\n## Resumo do dia\n- ${n('done')} concluídas, ${n('failed')} falharam, ${n('cancelled')} canceladas.\n- Custo: $${cost.toFixed(2)}.\n`, 'append');
}

export function register() {
  runBus.on('finished', (run) => {
    try {
      writeRunReport(run);
    } catch (e) {
      console.error('vault: relatório da execução', (e as Error).message);
    }
  });
  cron.schedule(
    '50 23 * * *',
    () => {
      try {
        closeDay();
      } catch (e) {
        console.error('vault: fechamento do dia', (e as Error).message);
      }
    },
    { timezone: config.timezone },
  );
}
