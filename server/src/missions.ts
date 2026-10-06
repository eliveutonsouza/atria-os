import { trackOpenAI } from './usage.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ApprovalInfo, MissionInfo, MissionStep, RunInfo } from '../../shared/protocol.ts';
import { db, kvGet, now, uid } from './db.ts';
import { config } from './config.ts';
import { emit, setYuiState } from './bus.ts';
import { findAgent, loadAgents } from './agents.ts';
import { activeProject, findProject, setActiveProject } from './projects.ts';
import { askApproval, cancelRun, enqueueRun, expireApprovals, getRun, runBus } from './runs.ts';
import { openai } from './brain.ts';
import { narrate } from './live.ts';
import { registerBrain } from './extensions.ts';

// Missões: um pedido grande vira um plano (DAG de etapas, cada uma com um agente), mostrado no Canvas
// e executado em ordem de dependência. Resultados das etapas anteriores entram no contexto das seguintes.


db.exec(`
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  project TEXT,
  status TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
`);

// Rascunhos (status draft): detalhes do pedido e "pedir meu OK antes de" entram no planejamento.
function addColumn(col: string, def: string) {
  const cols = db.prepare('PRAGMA table_info(missions)').all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE missions ADD COLUMN ${col} ${def}`);
}
addColumn('details', 'TEXT');
addColumn('approval_before', 'TEXT');

type MissionRow = {
  id: string; title: string; goal: string; project: string | null; status: MissionInfo['status']; plan_json: string; created_at: string; finished_at: string | null;
  details: string | null; approval_before: string | null;
};

function toInfo(r: MissionRow): MissionInfo {
  return {
    id: r.id, title: r.title, goal: r.goal, project: r.project, status: r.status, steps: JSON.parse(r.plan_json), createdAt: r.created_at, finishedAt: r.finished_at,
    details: r.details, approvalBefore: r.approval_before ? (JSON.parse(r.approval_before) as string[]) : [],
  };
}

export function getMission(id: string): MissionInfo | null {
  const r = db.prepare('SELECT * FROM missions WHERE id = ?').get(id) as MissionRow | undefined;
  return r ? toInfo(r) : null;
}

export function listMissions(limit = 20): MissionInfo[] {
  return (db.prepare('SELECT * FROM missions ORDER BY created_at DESC LIMIT ?').all(limit) as MissionRow[]).map(toInfo);
}

function latestActive(): MissionInfo | null {
  const r = db.prepare(`SELECT * FROM missions WHERE status IN ('running','paused','blocked') ORDER BY created_at DESC LIMIT 1`).get() as MissionRow | undefined;
  return r ? toInfo(r) : null;
}

function save(m: MissionInfo) {
  db.prepare('UPDATE missions SET status = ?, plan_json = ?, finished_at = ? WHERE id = ?').run(m.status, JSON.stringify(m.steps), m.finishedAt, m.id);
  emit({ type: 'mission.updated', mission: m });
}

// ---------- planner ----------

interface PlannedStep { id: string; title: string; agent: string; instruction: string; depends_on: string[]; risky: boolean; display: 'blocks' | 'html' | 'none' }

function projectContext(slug: string | null): string {
  const p = slug ? findProject(slug) : undefined;
  if (!p) return 'Sem projeto: as etapas trabalham em /workspace/.yui/scratch.';
  const lines = [`Projeto: ${p.name} (${p.slug})${p.repo ? `, repo ${p.repo}` : ''}${p.cloned ? '' : ' — será clonado'}.`];
  if (p.description) lines.push(`Descrição: ${p.description}`);
  for (const f of ['README.md', 'package.json']) {
    const file = join(p.dir, f);
    if (p.cloned && existsSync(file)) lines.push(`${f} (início):\n${readFileSync(file, 'utf8').slice(0, 1200)}`);
  }
  if (p.preview) lines.push(`Preview do console: pasta "${p.preview}" (build estático).`);
  return lines.join('\n');
}

function connectorsLine(): string {
  try {
    const caps = JSON.parse(kvGet('claude_capabilities') ?? '{}') as { mcp?: { name: string; status: string }[] };
    return (caps.mcp ?? []).filter((m) => m.status !== 'failed' && m.status !== 'needs-auth').map((m) => m.name.replace(/^claude\.ai /, '')).join(', ');
  } catch {
    return '';
  }
}

export interface PlanOpts { details?: string | null; approvalBefore?: string[]; status?: 'draft' | 'running' }

const APPROVAL_LABEL: Record<string, string> = { deploy: 'deploy/publicação', enviar: 'envio de mensagem/e-mail' };

async function planSteps(goal: string, projectSlug: string | null, opts: PlanOpts): Promise<{ title: string; steps: MissionStep[] }> {
  const agents = loadAgents();
  const ids = agents.map((a) => a.id);
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'steps'],
    properties: {
      title: { type: 'string', description: 'título curto da missão (até 6 palavras)' },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'agent', 'instruction', 'depends_on', 'risky', 'display'],
          properties: {
            id: { type: 'string', description: 's1, s2, …' },
            title: { type: 'string', description: 'título curto da etapa (até 6 palavras)' },
            agent: { type: 'string', enum: ids },
            instruction: { type: 'string', description: 'instrução completa e autossuficiente para o agente' },
            depends_on: { type: 'array', items: { type: 'string' } },
            risky: { type: 'boolean', description: 'true SÓ se o usuário pediu explicitamente aprovação/permissão antes desta etapa' },
            display: { type: 'string', enum: ['blocks', 'html', 'none'], description: 'blocks se o resultado da etapa deve virar uma tela de dados para o usuário' },
          },
        },
      },
    },
  };
  const approvals = (opts.approvalBefore ?? []).map((a) => APPROVAL_LABEL[a]).filter(Boolean);
  const prompt = [
    `Objetivo do usuário: ${goal}`,
    ...(opts.details?.trim() ? [`Detalhes e referências do usuário: ${opts.details.trim()}`] : []),
    ...(approvals.length ? [`Peça aprovação (risky=true) antes de: ${approvals.join('; ')}.`] : []),
    projectContext(projectSlug),
    `Agentes disponíveis:\n${agents.map((a) => `- ${a.id}: ${a.name} — ${a.description}`).join('\n')}`,
    `Conectores dos agentes: ${connectorsLine() || 'Google Calendar, Gmail, Drive, Linear, Vercel, Supabase, Figma'}; navegador Playwright e Chrome do usuário.`,
  ].join('\n\n');
  const res = await openai.responses.create({
    model: config.plannerModel,
    instructions: `Você planeja missões para uma equipe de agentes Claude Code. Gere de 2 a 8 etapas, cada uma com UM agente da lista.
- Use dependências (depends_on) só quando a etapa precisa do resultado/arquivos de outra; etapas independentes rodam em paralelo.
- Instruções em português, completas e autossuficientes (o agente não vê esta conversa); cite arquivos/pastas esperados.
- Sites e landing pages: Next.js (create-next-app) no diretório do projeto, com build estático exportado para que o console mostre o preview; nunca HTML cru amador.
- Código: termine com uma etapa de QA que valida (testes/build/screenshot).
- Tudo roda no automático: marque risky=true SOMENTE nas etapas em que o pedido do usuário pede aprovação/permissão/revisão dele antes (ex.: "me pede OK antes de publicar"). Sem pedido explícito, risky=false — inclusive em deploy, publicação e envio.
- display=blocks apenas para etapas cujo resultado é um conjunto de dados para mostrar (leads, tabela, comparativo).`,
    input: prompt,
    text: { format: { type: 'json_schema', name: 'mission_plan', schema, strict: true } },
  });
  trackOpenAI('planejador', res.model, res.usage);
  const plan = JSON.parse(res.output_text) as { title: string; steps: PlannedStep[] };
  const planned = plan.steps.slice(0, 8);
  const known = new Set(planned.map((s) => s.id));
  const steps: MissionStep[] = planned.map((s) => {
    const agent = findAgent(s.agent);
    return {
      id: s.id,
      title: s.title,
      agentId: agent?.id ?? s.agent,
      agent: agent?.name ?? s.agent,
      instruction: s.instruction,
      dependsOn: s.depends_on.filter((d) => known.has(d) && d !== s.id),
      risky: s.risky,
      display: s.display === 'none' ? null : s.display,
      status: 'pending',
      runId: null,
      result: null,
    };
  });
  breakCycles(steps);
  return { title: plan.title, steps };
}

export async function planMission(goal: string, projectSlug: string | null, opts: PlanOpts = {}): Promise<MissionInfo> {
  const plan = await planSteps(goal, projectSlug, opts);
  return insertMission({ title: plan.title, goal, project: projectSlug, details: opts.details ?? null, approvalBefore: opts.approvalBefore ?? [], steps: plan.steps, status: opts.status ?? 'running' });
}

function insertMission(p: { title: string; goal: string; project: string | null; details: string | null; approvalBefore: string[]; steps: MissionStep[]; status: MissionInfo['status'] }): MissionInfo {
  const m: MissionInfo = { id: uid(), ...p, createdAt: now(), finishedAt: null };
  db.prepare('INSERT INTO missions(id, title, goal, project, status, plan_json, created_at, details, approval_before) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(m.id, m.title, m.goal, m.project, m.status, JSON.stringify(m.steps), m.createdAt, m.details, JSON.stringify(m.approvalBefore));
  emit({ type: 'mission.updated', mission: m });
  return m;
}

// Rascunho montado à mão: sem planejador, título = primeira linha do objetivo.
export function createManualDraft(goal: string, projectSlug: string | null, opts: PlanOpts = {}): MissionInfo {
  const title = goal.trim().split('\n')[0].trim().slice(0, 60) || 'Nova missão';
  return insertMission({ title, goal: goal.trim(), project: projectSlug, details: opts.details ?? null, approvalBefore: opts.approvalBefore ?? [], steps: [], status: 'draft' });
}

// ---------- edição (rascunho; pausada/bloqueada só nas etapas pendentes) ----------

export class MissionEditError extends Error {
  code: 400 | 404 | 409;
  constructor(code: 400 | 404 | 409, message: string) {
    super(message);
    this.code = code;
  }
}

export interface StepInput { id: string; title: string; agentId: string; instruction: string; dependsOn: string[]; risky: boolean; display: MissionStep['display'] }
export interface MissionPatch { title?: string; goal?: string; project?: string | null; details?: string | null; approvalBefore?: string[]; steps?: StepInput[] }

// Primeira dependência circular encontrada (ids no caminho), ou null.
function findCycle(steps: { id: string; dependsOn: string[] }[]): string[] | null {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map<string, 1 | 2>(); // 1 = no caminho, 2 = resolvida
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...path.slice(path.indexOf(id)), id];
    state.set(id, 1);
    path.push(id);
    for (const d of byId.get(id)?.dependsOn ?? []) {
      const c = visit(d);
      if (c) return c;
    }
    path.pop();
    state.set(id, 2);
    return null;
  };
  for (const s of steps) {
    const c = visit(s.id);
    if (c) return c;
  }
  return null;
}

function normalizeSteps(input: unknown): MissionStep[] {
  if (!Array.isArray(input)) throw new MissionEditError(400, 'steps precisa ser uma lista');
  if (input.length > 30) throw new MissionEditError(400, 'no máximo 30 etapas');
  const ids = new Set<string>();
  const steps = input.map((raw, i) => {
    const s = (raw ?? {}) as Partial<StepInput>;
    const id = String(s.id ?? '').trim();
    if (!id) throw new MissionEditError(400, `etapa ${i + 1} sem id`);
    if (ids.has(id)) throw new MissionEditError(400, `id de etapa repetido: ${id}`);
    ids.add(id);
    const title = String(s.title ?? '').trim();
    if (!title) throw new MissionEditError(400, `etapa ${id} sem título`);
    const agent = s.agentId ? findAgent(String(s.agentId)) : undefined;
    if (!agent) throw new MissionEditError(400, `etapa "${title}": agente desconhecido (${s.agentId || 'vazio'})`);
    return {
      id,
      title: title.slice(0, 120),
      agentId: agent.id,
      agent: agent.name,
      instruction: String(s.instruction ?? ''),
      dependsOn: Array.isArray(s.dependsOn) ? [...new Set(s.dependsOn.map(String))] : [],
      risky: !!s.risky,
      display: s.display === 'blocks' || s.display === 'html' ? s.display : null,
      status: 'pending',
      runId: null,
      result: null,
    } satisfies MissionStep;
  });
  for (const s of steps) {
    if (s.dependsOn.includes(s.id)) throw new MissionEditError(400, `a etapa "${s.title}" não pode depender dela mesma`);
    const bad = s.dependsOn.find((d) => !ids.has(d));
    if (bad) throw new MissionEditError(400, `a etapa "${s.title}" depende de uma etapa que não existe (${bad})`);
  }
  const cycle = findCycle(steps);
  if (cycle) throw new MissionEditError(400, `dependência circular entre etapas: ${cycle.join(' → ')}`);
  return steps;
}

const sameStep = (a: MissionStep, b: MissionStep) =>
  a.title === b.title && a.agentId === b.agentId && a.instruction === b.instruction && a.risky === b.risky && a.display === b.display &&
  a.dependsOn.length === b.dependsOn.length && a.dependsOn.every((d) => b.dependsOn.includes(d));

function saveAll(m: MissionInfo) {
  db.prepare('UPDATE missions SET title = ?, goal = ?, project = ?, details = ?, approval_before = ?, status = ?, plan_json = ?, finished_at = ? WHERE id = ?')
    .run(m.title, m.goal, m.project, m.details ?? null, JSON.stringify(m.approvalBefore ?? []), m.status, JSON.stringify(m.steps), m.finishedAt, m.id);
  emit({ type: 'mission.updated', mission: m });
}

export function updateMission(id: string, patch: MissionPatch): MissionInfo {
  const m = getMission(id);
  if (!m) throw new MissionEditError(404, 'not found');
  if (m.status === 'draft') {
    if (patch.goal !== undefined) {
      if (!String(patch.goal).trim()) throw new MissionEditError(400, 'o objetivo não pode ficar vazio');
      m.goal = String(patch.goal).trim();
    }
    if (patch.title !== undefined && String(patch.title).trim()) m.title = String(patch.title).trim().slice(0, 80);
    if (patch.project !== undefined) {
      if (patch.project && !findProject(patch.project)) throw new MissionEditError(400, 'projeto não encontrado');
      m.project = patch.project || null;
    }
    if (patch.details !== undefined) m.details = patch.details ? String(patch.details) : null;
    if (patch.approvalBefore !== undefined) m.approvalBefore = Array.isArray(patch.approvalBefore) ? patch.approvalBefore.filter((a) => a in APPROVAL_LABEL) : [];
    if (patch.steps !== undefined) m.steps = normalizeSteps(patch.steps);
  } else if (m.status === 'paused' || m.status === 'blocked') {
    if (patch.title !== undefined || patch.goal !== undefined || patch.project !== undefined || patch.details !== undefined || patch.approvalBefore !== undefined) {
      throw new MissionEditError(409, 'com a missão em andamento só dá para editar as etapas pendentes');
    }
    if (patch.steps !== undefined) {
      const next = normalizeSteps(patch.steps);
      const old = new Map(m.steps.map((s) => [s.id, s]));
      for (const prev of m.steps) {
        if (prev.status === 'pending') continue;
        const cur = next.find((s) => s.id === prev.id);
        if (!cur) throw new MissionEditError(409, `a etapa "${prev.title}" já saiu da fila e não pode ser removida`);
        if (!sameStep(prev, cur)) throw new MissionEditError(409, `a etapa "${prev.title}" já saiu da fila e não pode ser alterada`);
      }
      // etapas que já saíram da fila mantêm estado, run e resultado
      m.steps = next.map((s) => {
        const prev = old.get(s.id);
        return prev && prev.status !== 'pending' ? prev : s;
      });
    }
  } else {
    throw new MissionEditError(409, 'só dá para editar rascunhos ou missões pausadas/bloqueadas');
  }
  saveAll(m);
  return m;
}

export async function replanMission(id: string): Promise<MissionInfo> {
  const m = getMission(id);
  if (!m) throw new MissionEditError(404, 'not found');
  if (m.status !== 'draft') throw new MissionEditError(409, 'só rascunhos podem ser replanejados');
  const plan = await planSteps(m.goal, m.project, { details: m.details, approvalBefore: m.approvalBefore });
  const cur = getMission(id);
  if (!cur || cur.status !== 'draft') throw new MissionEditError(409, 'o rascunho mudou durante o planejamento');
  cur.title = plan.title;
  cur.steps = plan.steps;
  saveAll(cur);
  return cur;
}

export function startMission(id: string): MissionInfo {
  const m = getMission(id);
  if (!m) throw new MissionEditError(404, 'not found');
  if (m.status !== 'draft') throw new MissionEditError(409, 'a missão já foi iniciada');
  if (!m.steps.length) throw new MissionEditError(400, 'adicione pelo menos uma etapa antes de iniciar');
  m.status = 'running';
  m.finishedAt = null;
  saveAll(m);
  advance(m.id);
  return getMission(id)!;
}

// Dependências circulares (raras) são cortadas: a etapa mantém só dependências que vêm antes dela na lista.
function breakCycles(steps: MissionStep[]) {
  const order = new Map(steps.map((s, i) => [s.id, i]));
  for (const s of steps) s.dependsOn = s.dependsOn.filter((d) => (order.get(d) ?? 99) < (order.get(s.id) ?? 0));
}

// ---------- executor ----------

function instructionFor(m: MissionInfo, step: MissionStep): string {
  const deps = m.steps.filter((s) => step.dependsOn.includes(s.id));
  const ctx = deps.length
    ? `\n\nResultados das etapas anteriores (os arquivos delas estão no mesmo diretório):\n${deps.map((d) => `- ${d.title} (${d.agent}): ${(d.result ?? '').slice(0, 8000)}`).join('\n')}`
    : '';
  return `Missão "${m.title}" — objetivo geral: ${m.goal}\nSua etapa: ${step.title}\n\n${step.instruction}${ctx}`;
}

const approving = new Set<string>(); // `${missionId}:${stepId}` aguardando aprovação

function advance(id: string) {
  const m = getMission(id);
  if (!m || m.status !== 'running') return;
  const done = (sid: string) => m.steps.find((s) => s.id === sid)?.status === 'done';
  let changed = false;
  for (const step of m.steps) {
    if (step.status !== 'pending' || !step.dependsOn.every(done)) continue;
    if (step.risky) {
      const key = `${m.id}:${step.id}`;
      if (approving.has(key)) continue;
      approving.add(key);
      step.status = 'waiting_approval';
      changed = true;
      void askApproval(m.id, `Missão "${m.title}": etapa "${step.title}" (${step.agent}) precisa do seu OK.`, [
        { label: 'Etapa', value: step.title },
        { label: 'Agente', value: step.agent },
        { label: 'Instrução', value: step.instruction.slice(0, 80) },
      ]).then((ok) => {
        approving.delete(key);
        const cur = getMission(m.id);
        const st = cur?.steps.find((s) => s.id === step.id);
        if (!cur || !st || st.status !== 'waiting_approval') return;
        if (ok) {
          st.risky = false; // aprovada: segue como etapa normal
          st.status = 'pending';
        } else {
          st.status = 'skipped';
          st.result = 'Etapa rejeitada pelo usuário.';
          skipDependents(cur, st.id);
        }
        save(cur);
        advance(cur.id);
        finishIfDone(cur.id);
      });
      continue;
    }
    try {
      const run = enqueueRun({
        agentId: step.agentId,
        project: m.project,
        instruction: instructionFor(m, step),
        task: `${step.title} · ${m.title}`,
        origin: 'mission',
        missionId: m.id,
        stepId: step.id,
        display: step.display,
      });
      step.status = 'running';
      step.runId = run.id;
    } catch (e) {
      step.status = 'failed';
      step.result = (e as Error).message;
      m.status = 'blocked';
    }
    changed = true;
  }
  if (changed) save(m);
  finishIfDone(m.id);
}

function skipDependents(m: MissionInfo, sid: string) {
  for (const s of m.steps) {
    if (s.status === 'pending' && s.dependsOn.includes(sid)) {
      s.status = 'skipped';
      s.result = 'Pulada: depende de uma etapa que não foi executada.';
      skipDependents(m, s.id);
    }
  }
}

function finishIfDone(id: string) {
  const m = getMission(id);
  if (!m || (m.status !== 'running' && m.status !== 'blocked')) return;
  const open = m.steps.some((s) => s.status === 'pending' || s.status === 'running' || s.status === 'waiting_approval');
  if (open) return;
  const failed = m.steps.filter((s) => s.status === 'failed');
  const doneCount = m.steps.filter((s) => s.status === 'done').length;
  m.status = failed.length ? 'failed' : doneCount === 0 ? 'cancelled' : 'done';
  m.finishedAt = now();
  save(m);
  if (m.status === 'cancelled') {
    narrate(`Missão ${m.title} encerrada sem executar etapas.`, { speak: true });
    return;
  }
  const last = [...m.steps].reverse().find((s) => s.status === 'done');
  narrate(
    failed.length
      ? `A missão ${m.title} terminou com ${failed.length} etapa${failed.length > 1 ? 's' : ''} com falha. ${failed[0].title}: ${(failed[0].result ?? '').slice(0, 200)}`
      : `Missão ${m.title} concluída: ${doneCount} etapas. ${(last?.result ?? '').slice(0, 300)}`,
    { speak: true, end: failed.length ? 'warning' : 'success' },
  );
  showMissionResult(m);
}

// Ao fim, mostra o entregável: preview do projeto se houver, senão a própria missão.
function showMissionResult(m: MissionInfo) {
  const p = m.project ? findProject(m.project) : undefined;
  if (m.status === 'done' && p?.cloned && p.preview && existsSync(join(p.dir, p.preview))) {
    setActiveProject(p.slug);
    emit({ type: 'ui.action', action: { type: 'show_view', view: 'website', params: { project: p.slug } } });
    return;
  }
  const hasCustom = m.steps.some((s) => s.display && s.status === 'done');
  if (!hasCustom) emit({ type: 'ui.action', action: { type: 'show_view', view: 'mission', params: { missionId: m.id } } });
}

runBus.on('finished', (run: RunInfo) => {
  if (!run.missionId) return;
  const m = getMission(run.missionId);
  if (!m) return;
  const step = m.steps.find((s) => s.runId === run.id);
  if (!step) return;
  if (m.status === 'cancelled') return; // etapa já marcada como cancelada
  step.result = run.result;
  if (run.state === 'done') {
    step.status = 'done';
    narrate(`Etapa concluída: ${step.title} (${step.agent}).`, { speak: false });
  } else {
    step.status = run.state === 'cancelled' ? 'cancelled' : 'failed';
    if (m.status === 'running') {
      m.status = 'blocked';
      narrate(`A etapa ${step.title} da missão ${m.title} falhou. Quer que eu tente de novo ou ajuste o plano?`, { speak: true, end: 'warning' });
    }
    skipDependents(m, step.id);
  }
  save(m);
  advance(m.id);
  finishIfDone(m.id);
});

export function controlMission(id: string, action: 'pause' | 'resume' | 'cancel' | 'retry'): MissionInfo | null {
  const m = getMission(id);
  if (!m) return null;
  if (m.status === 'draft') return m; // rascunho só muda pelo editor (iniciar/descartar)
  if (action === 'pause' && m.status === 'running') m.status = 'paused';
  else if (action === 'resume' && (m.status === 'paused' || m.status === 'blocked')) m.status = 'running';
  else if (action === 'retry') {
    for (const s of m.steps) {
      if (s.status === 'failed' || s.status === 'cancelled' || (s.status === 'skipped' && s.result?.startsWith('Pulada'))) {
        s.status = 'pending';
        s.runId = null;
        s.result = null;
      }
    }
    m.status = 'running';
    m.finishedAt = null;
  } else if (action === 'cancel' && !['done', 'failed', 'cancelled'].includes(m.status)) {
    for (const s of m.steps) {
      if (s.status === 'running' && s.runId) cancelRun(s.runId);
      if (s.status === 'pending' || s.status === 'waiting_approval' || s.status === 'running') s.status = 'cancelled';
    }
    expireApprovals(m.id);
    m.status = 'cancelled';
    m.finishedAt = now();
  }
  save(m);
  if (m.status === 'running') advance(m.id);
  return getMission(id);
}

// Após reinício: etapas "running" cujo run morreu viram falha (missão fica bloqueada para retry).
// Exclusão definitiva: cancela o que estiver rodando (mesmo caminho do "cancel") e apaga a missão.
// Runs das etapas ficam no histórico, só perdem o vínculo.
export function deleteMission(id: string): boolean {
  const m = getMission(id);
  if (!m) return false;
  if (!['done', 'failed', 'cancelled'].includes(m.status)) controlMission(id, 'cancel');
  expireApprovals(id);
  for (const key of approving) if (key.startsWith(`${id}:`)) approving.delete(key);
  db.prepare('UPDATE runs SET mission_id = NULL, step_id = NULL WHERE mission_id = ?').run(id);
  db.prepare('DELETE FROM missions WHERE id = ?').run(id);
  emit({ type: 'mission.deleted', missionId: id });
  return true;
}

// O que some junto com a missão (linhas do modal de aprovação da Yui).
export function missionDeleteSummary(m: MissionInfo): ApprovalInfo['rows'] {
  const running = m.steps.filter((s) => s.status === 'running' || s.status === 'waiting_approval').length;
  return [
    { label: 'Missão', value: m.title },
    { label: 'Status', value: m.status },
    { label: 'Etapas', value: `${m.steps.filter((s) => s.status === 'done').length}/${m.steps.length} concluídas` },
    ...(running ? [{ label: 'Em andamento', value: `${running} etapa(s) — serão canceladas`, tone: 'crit' as const }] : []),
    { label: 'Desfazer', value: 'não é possível', tone: 'crit' },
  ];
}

function recoverMissions() {
  for (const m of listMissions(50).filter((x) => x.status === 'running' || x.status === 'paused')) {
    let changed = false;
    for (const s of m.steps) {
      if (s.status === 'waiting_approval') {
        s.status = 'pending';
        changed = true;
      }
      if (s.status === 'running' && s.runId) {
        const r = getRun(s.runId);
        // No boot (antes de recoverRuns), runs 'running'/'waiting_approval' morreram com o processo anterior.
        if (!r || r.state === 'failed' || r.state === 'cancelled' || r.state === 'running' || r.state === 'waiting_approval') {
          s.status = 'failed';
          s.result = r?.result ?? 'Interrompida por reinício.';
          m.status = 'blocked';
          changed = true;
        } else if (r.state === 'done') {
          s.status = 'done';
          s.result = r.result;
          changed = true;
        }
      }
    }
    if (changed) save(m);
    if (m.status === 'running') advance(m.id);
  }
}

// ---------- cérebro ----------

registerBrain({
  name: 'missions',
  instructions: `- Pedidos grandes ou com mais de uma especialidade (site completo, landing page, auditoria completa, campanha, pesquisa + conteúdo, "faça X, Y e Z") => plan_mission com o objetivo completo e o projeto. A missão já aparece na tela e começa sozinha; diga em uma frase quantas etapas e quais agentes. Tarefa pontual de um especialista => delegate_task. Não trave pedindo projeto ou nome: sem projeto use project null (trabalha num diretório temporário) e use nomes provisórios, avisando.
- "pausa/retoma/cancela a missão", "tenta de novo" => mission_control. "como está a missão?" => get_mission.
- "exclui/remove/apaga a missão X" => delete_mission: é irreversível, use só quando o usuário pedir claramente para excluir aquela missão (nunca por iniciativa própria; para parar uma missão use mission_control cancel) — abre um modal de aprovação; diga que aguarda a aprovação dele e nunca diga que já excluiu.`,
  snapshot: () => {
    const act = listMissions(10).filter((m) => ['running', 'paused', 'blocked'].includes(m.status));
    return act.length
      ? `Missões ativas: ${act.map((m) => `"${m.title}" [${m.id}] ${m.status}, ${m.steps.filter((s) => s.status === 'done').length}/${m.steps.length} etapas`).join('; ')}.`
      : 'Missões ativas: nenhuma.';
  },
  tools: [
    {
      type: 'function', name: 'plan_mission', strict: true,
      description: 'Cria um plano de execução multi-agente (etapas com dependências), mostra no Canvas e começa a executar.',
      parameters: { type: 'object', additionalProperties: false, required: ['goal', 'project'], properties: { goal: { type: 'string', description: 'objetivo completo do usuário, com todos os detalhes ditos' }, project: { type: ['string', 'null'], description: 'slug do projeto; null se não houver' } } },
    },
    {
      type: 'function', name: 'mission_control', strict: true,
      description: 'Pausa, retoma, cancela ou tenta de novo (retry) uma missão. mission_id null = missão ativa mais recente.',
      parameters: { type: 'object', additionalProperties: false, required: ['mission_id', 'action'], properties: { mission_id: { type: ['string', 'null'] }, action: { type: 'string', enum: ['pause', 'resume', 'cancel', 'retry'] } } },
    },
    {
      type: 'function', name: 'get_mission', strict: true,
      description: 'Estado de uma missão (etapas, agentes, resultados). mission_id null = mais recente.',
      parameters: { type: 'object', additionalProperties: false, required: ['mission_id', 'show'], properties: { mission_id: { type: ['string', 'null'] }, show: { type: 'boolean', description: 'true para abrir a missão no Canvas' } } },
    },
    {
      type: 'function', name: 'delete_mission', strict: true,
      description: 'Pede a exclusão definitiva de uma missão (cancela etapas em andamento). Só exclui depois que o usuário aprovar no modal de ação destrutiva.',
      parameters: { type: 'object', additionalProperties: false, required: ['mission_id'], properties: { mission_id: { type: 'string' } } },
    },
  ],
  run(tool, args) {
    if (tool === 'delete_mission') {
      const m = getMission(String(args.mission_id));
      if (!m) return Promise.resolve({ ok: false, error: 'missão não encontrada', recentes: listMissions(10).map((x) => ({ id: x.id, titulo: x.title })) });
      // Não espera o clique: o turno da Yui termina já e a exclusão acontece só se o usuário aprovar.
      void askApproval(`delete:mission:${m.id}`, `Excluir a missão "${m.title}" definitivamente?`, missionDeleteSummary(m), undefined, { kind: 'destructive' }).then((ok) => {
        if (!ok) return narrate(`Ok, mantive a missão ${m.title}.`, { speak: true });
        narrate(deleteMission(m.id) ? `Missão ${m.title} excluída.` : `A missão ${m.title} já não existia.`, { speak: true });
      });
      return Promise.resolve({ ok: true, status: 'aguardando_aprovacao', titulo: m.title, aviso: 'Nada foi excluído ainda: só exclui se o usuário aprovar no modal.' });
    }
    if (tool === 'plan_mission') {
      return (async () => {
        const proj = typeof args.project === 'string' && args.project ? findProject(args.project) : findProject(activeProject());
        if (args.project && !proj) return { ok: false, error: 'projeto não encontrado' };
        setYuiState('delegating');
        const m = await planMission(String(args.goal), proj?.slug ?? null);
        if (proj) setActiveProject(proj.slug);
        emit({ type: 'ui.action', action: { type: 'show_view', view: 'mission', params: { missionId: m.id } } });
        advance(m.id);
        return { ok: true, mission_id: m.id, titulo: m.title, etapas: m.steps.map((s) => `${s.title} (${s.agent})${s.risky ? ' [precisa de OK]' : ''}`) };
      })();
    }
    if (tool === 'mission_control') {
      const m: MissionInfo | undefined = (args.mission_id ? getMission(String(args.mission_id)) : null) ?? latestActive() ?? listMissions(1)[0];
      if (!m) return Promise.resolve({ ok: false, error: 'nenhuma missão' });
      const r = controlMission(m.id, args.action as 'pause');
      return Promise.resolve({ ok: !!r, status: r?.status });
    }
    if (tool === 'get_mission') {
      const m: MissionInfo | undefined = (args.mission_id ? getMission(String(args.mission_id)) : null) ?? latestActive() ?? listMissions(1)[0];
      if (!m) return Promise.resolve({ ok: false, error: 'nenhuma missão' });
      if (args.show) emit({ type: 'ui.action', action: { type: 'show_view', view: 'mission', params: { missionId: m.id } } });
      return Promise.resolve({ titulo: m.title, status: m.status, etapas: m.steps.map((s) => ({ etapa: s.title, agente: s.agent, status: s.status, resultado: s.result?.slice(0, 300) })) });
    }
    return undefined;
  },
});

// ---------- rotas ----------

export function register(app: FastifyInstance): void {
  recoverMissions();
  app.get('/api/missions', () => listMissions(30));
  app.get('/api/missions/:id', (req, reply) => getMission((req.params as { id: string }).id) ?? reply.code(404).send({ error: 'not found' }));
  for (const action of ['pause', 'resume', 'cancel', 'retry'] as const) {
    app.post(`/api/missions/:id/${action}`, (req, reply) => controlMission((req.params as { id: string }).id, action) ?? reply.code(404).send({ error: 'not found' }));
  }
  app.delete('/api/missions/:id', (req, reply) => reply.code(deleteMission((req.params as { id: string }).id) ? 204 : 404).send());
  // Erros de edição viram { error } com o código certo (400 validação, 404, 409 estado).
  const guard = async <T>(reply: FastifyReply, fn: () => T | Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof MissionEditError) return reply.code(e.code).send({ error: e.message });
      throw e;
    }
  };
  // mode manual = rascunho sem planejador; mode ai = planeja. Rascunho por padrão; start:true já começa a executar.
  app.post('/api/missions', (req, reply) => guard(reply, async () => {
    const b = (req.body ?? {}) as { goal?: string; project?: string | null; details?: string | null; approvalBefore?: string[]; mode?: 'ai' | 'manual'; start?: boolean };
    if (!b.goal?.trim()) return reply.code(400).send({ error: 'Descreva o objetivo da missão.' });
    if (b.project && !findProject(b.project)) return reply.code(400).send({ error: 'projeto não encontrado' });
    const opts: PlanOpts = { details: b.details ?? null, approvalBefore: Array.isArray(b.approvalBefore) ? b.approvalBefore.filter((a) => a in APPROVAL_LABEL) : [] };
    if (b.mode === 'manual') return createManualDraft(b.goal, b.project ?? null, opts);
    const m = await planMission(b.goal.trim(), b.project ?? null, { ...opts, status: b.start ? 'running' : 'draft' });
    if (b.start) advance(m.id);
    return getMission(m.id);
  }));
  app.put('/api/missions/:id', (req, reply) => guard(reply, () => updateMission((req.params as { id: string }).id, (req.body ?? {}) as MissionPatch)));
  app.post('/api/missions/:id/replan', (req, reply) => guard(reply, () => replanMission((req.params as { id: string }).id)));
  app.post('/api/missions/:id/start', (req, reply) => guard(reply, () => startMission((req.params as { id: string }).id)));
}
