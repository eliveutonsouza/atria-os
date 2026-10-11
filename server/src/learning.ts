import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { InstalledSkill, RunInfo } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, kvGet, kvSet, now, uid } from './db.ts';
import { emit } from './bus.ts';
import { findAgent, loadAllAgents } from './agents.ts';
import { getRun, inboxItems, runBus } from './runs.ts';
import { getSetting } from './settings.ts';
import { registerAgentOptions, registerBrain, registerRunPrompt } from './extensions.ts';
import { openai } from './brain.ts';
import { trackOpenAI } from './usage.ts';
import { openaiOverCap } from './budget.ts';
import { addMemory } from './memoria.ts';
import { applyPlacements, frontmatterName, libDir, listInstalled, platformDir, removePlacements, saveInstalled, validName } from './skillsHub.ts';
import { vaultRoot } from './vault.ts';

// Aprendizado (ideias do Hermes: revisão em segundo plano, curator semanal e skills que nascem da experiência).
//  - Lições por agente: aplicadas sozinhas e reversíveis (desfazer na ficha do agente); entram no prompt do agente.
//  - Memória do usuário e skills: só por proposta que o usuário aprova (cartão "Yui aprendeu", no máximo 1 por dia).
//  - A revisão roda só em execução longa (> 15 turnos), com falha, com aprovação rejeitada ou com 👎, com teto diário.

db.exec(`
CREATE TABLE IF NOT EXISTS agent_lessons (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  text TEXT NOT NULL,
  run_id TEXT,
  source TEXT NOT NULL, -- revisao | vault | consolidado | usuario
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_lessons_agent ON agent_lessons(agent_id, active);
CREATE TABLE IF NOT EXISTS learn_proposals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL, -- memory | skill
  agent_id TEXT,
  run_id TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  decided_at TEXT
);`);

export const MAX_LESSONS = 15;
export const MAX_LESSON_CHARS = 1200;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ---------- lições ----------

export interface Lesson { id: string; agentId: string; text: string; runId: string | null; source: string; createdAt: string }
type LessonRow = { id: string; agent_id: string; text: string; run_id: string | null; source: string; created_at: string };
const toLesson = (r: LessonRow): Lesson => ({ id: r.id, agentId: r.agent_id, text: r.text, runId: r.run_id, source: r.source, createdAt: r.created_at });

export const activeLessons = (agentId: string): Lesson[] =>
  (db.prepare(`SELECT * FROM agent_lessons WHERE agent_id = ? AND active = 1 ORDER BY created_at DESC`).all(agentId) as LessonRow[]).map(toLesson);

/** Acrescenta uma lição (sem repetir); acima do teto (15 itens / 1200 caracteres), desativa as mais antigas. */
export function addLesson(agentId: string, text: string, source: string, runId: string | null = null): Lesson | null {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (t.length < 8 || activeLessons(agentId).some((l) => norm(l.text) === norm(t))) return null;
  const id = uid();
  db.prepare(`INSERT INTO agent_lessons(id, agent_id, text, run_id, source, created_at) VALUES(?, ?, ?, ?, ?, ?)`).run(id, agentId, t, runId, source, now());
  let list = activeLessons(agentId);
  while (list.length > MAX_LESSONS || list.reduce((n, l) => n + l.text.length + 3, 0) > MAX_LESSON_CHARS) {
    const oldest = list.at(-1)!;
    db.prepare(`UPDATE agent_lessons SET active = 0 WHERE id = ?`).run(oldest.id);
    list = list.slice(0, -1);
  }
  return list.find((l) => l.id === id) ?? null;
}

export const undoLesson = (id: string) => db.prepare(`UPDATE agent_lessons SET active = 0 WHERE id = ? AND active = 1`).run(id).changes > 0;

registerRunPrompt((ctx) => {
  const list = activeLessons(ctx.agentId);
  if (!list.length) return null;
  return `- Lições que você aprendeu em execuções anteriores (siga-as; valem mais que hábitos genéricos):\n${list.map((l) => `  · ${l.text}`).join('\n')}`;
});

// Lições que os agentes escreveram no vault (03-Agentes/<Nome>.md › ## Lições) entram uma vez na tabela.
// A instrução antiga de escrever no vault continua uma semana em paralelo; depois sai (a tabela vira a fonte).
export function importVaultLessons(): number {
  if (kvGet('learn_vault_imported')) return 0;
  const dir = join(vaultRoot(), '03-Agentes');
  let n = 0;
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const name = f.replace(/\.md$/, '');
      const agent = loadAllAgents().find((a) => norm(a.name) === norm(name) || a.id === name.toLowerCase());
      if (!agent) continue;
      const md = readFileSync(join(dir, f), 'utf8');
      const sec = /^##\s+Li[cç][oõ]es\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(md)?.[1] ?? '';
      for (const line of sec.split('\n')) {
        const m = /^\s*[-*]\s+(?:\d{4}-\d{2}-\d{2}:\s*)?(.+)$/.exec(line);
        // "lição — [[nota]]": o link no fim é referência do vault, não parte da lição
        const text = m?.[1].replace(/\s+[—-]\s+(\[\[[^\]]+\]\][\s,]*)+$/, '').replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1');
        if (text && addLesson(agent.id, text, 'vault')) n++;
      }
    }
  }
  kvSet('learn_vault_imported', now());
  return n;
}

// ---------- propostas (memória e skills) ----------

export interface SkillDraft { nome: string; descricao: string; corpo: string }
export interface Proposal { id: string; kind: 'memory' | 'skill'; agentId: string | null; runId: string | null; createdAt: string; memory?: { texto: string; motivo: string }; skill?: SkillDraft & { diff: 'nova' | 'atualiza' } }
type PropRow = { id: string; kind: string; agent_id: string | null; run_id: string | null; payload: string; status: string; created_at: string };

const pendingDir = () => join(homedir(), '.atria', 'skills-pending');
const historyDir = () => join(homedir(), '.atria', 'skills-history');

function toProposal(r: PropRow): Proposal {
  const p = JSON.parse(r.payload);
  const base = { id: r.id, kind: r.kind as Proposal['kind'], agentId: r.agent_id, runId: r.run_id, createdAt: r.created_at };
  if (r.kind === 'memory') return { ...base, memory: p };
  return { ...base, skill: { ...p, diff: existsSync(join(libDir(), p.nome, 'SKILL.md')) ? 'atualiza' : 'nova' } };
}

export const pendingProposals = (): Proposal[] =>
  (db.prepare(`SELECT * FROM learn_proposals WHERE status = 'pending' ORDER BY created_at`).all() as PropRow[]).map(toProposal);

const skillMd = (d: SkillDraft) => `---\nname: ${d.nome}\ndescription: ${d.descricao.replace(/\n/g, ' ')}\n---\n\n${d.corpo.trim()}\n`;
const DANGER = /\b(rm\s+-[a-z]*[rf]|curl\s|wget\s|nc\s|ssh\s|scp\s|chmod\s+[0-7]*7|sudo\s|mkfs|dd\s+if=|base64\s+-d|eval\s)/i;

/** Lint de skill proposta: nome, descrição, tamanho, nada de comandos de rede/rm e sem colidir com skill do hub. */
export function lintSkill(d: SkillDraft): string | null {
  const nome = (d.nome ?? '').trim();
  if (!validName(nome)) return 'nome inválido (minúsculas, números, - . _; até 64)';
  if (!d.descricao?.trim() || d.descricao.length > 300) return 'descrição obrigatória (até 300 caracteres)';
  const md = skillMd(d);
  if (md.length > 24_000) return 'skill grande demais (até 24 mil caracteres)';
  if (frontmatterName(md) !== nome) return 'frontmatter inválido';
  if (DANGER.test(d.corpo)) return 'a skill tem comando de rede, rm ou sudo: não aceito em skill proposta';
  const hub = listInstalled().find((s) => s.name === nome && s.origin !== 'local');
  if (hub || (!listInstalled().some((s) => s.name === nome) && existsSync(join(platformDir(), nome)))) return `já existe uma skill "${nome}" de outra origem`;
  return null;
}

export function propose(kind: 'memory' | 'skill', payload: { texto: string; motivo: string } | SkillDraft, agentId: string | null, runId: string | null): Proposal | { error: string } {
  if (kind === 'skill') {
    const d = payload as SkillDraft;
    d.nome = (d.nome ?? '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64);
    const err = lintSkill(d);
    if (err) return { error: err };
    if (pendingProposals().some((p) => p.skill?.nome === d.nome)) return { error: 'já existe uma proposta pendente com esse nome' };
  } else {
    const m = payload as { texto: string; motivo: string };
    if (!m.texto?.trim() || m.texto.length > 200) return { error: 'memória: texto de até 200 caracteres' };
    if (pendingProposals().some((p) => p.memory && norm(p.memory.texto) === norm(m.texto))) return { error: 'já proposta' };
  }
  const id = uid();
  db.prepare(`INSERT INTO learn_proposals(id, kind, agent_id, run_id, payload, created_at) VALUES(?, ?, ?, ?, ?, ?)`).run(id, kind, agentId, runId, JSON.stringify(payload), now());
  if (kind === 'skill') {
    mkdirSync(join(pendingDir(), id), { recursive: true });
    writeFileSync(join(pendingDir(), id, 'SKILL.md'), skillMd(payload as SkillDraft));
    writeFileSync(join(pendingDir(), id, 'meta.json'), JSON.stringify({ agentId, runId, createdAt: now() }, null, 2));
  }
  emit({ type: 'inbox.updated', inbox: inboxItems() });
  return toProposal(db.prepare(`SELECT * FROM learn_proposals WHERE id = ?`).get(id) as PropRow);
}

/** Instala a skill aprovada como skill local do agente que propôs (escopo inicial: só ele). */
function installLocalSkill(d: SkillDraft, agentId: string | null): InstalledSkill {
  const dir = join(libDir(), d.nome);
  const file = join(dir, 'SKILL.md');
  if (existsSync(file)) {
    mkdirSync(historyDir(), { recursive: true });
    copyFileSync(file, join(historyDir(), `${d.nome}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`));
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, skillMd(d));
  const list = listInstalled();
  const prev = list.find((s) => s.name === d.nome);
  const agents = prev?.scope === 'agents' ? [...new Set([...prev.agents, ...(agentId ? [agentId] : [])])] : agentId ? [agentId] : [];
  const rec: InstalledSkill = {
    name: d.nome, source: 'local', skillId: d.nome, scope: prev?.scope ?? (agents.length ? 'agents' : 'platform'), agents: prev?.scope === 'platform' ? [] : agents,
    description: d.descricao, treeSha: '', audits: [], installedAt: prev?.installedAt ?? now(), ...(prev ? { updatedAt: now() } : {}), origin: 'local',
  };
  if (prev) removePlacements(prev);
  applyPlacements(rec);
  saveInstalled([...list.filter((s) => s !== prev), rec]);
  return rec;
}

export function decide(approve: string[], reject: string[]): { approved: string[]; rejected: string[]; errors: string[] } {
  const out = { approved: [] as string[], rejected: [] as string[], errors: [] as string[] };
  for (const p of pendingProposals()) {
    const yes = approve.includes(p.id);
    const no = reject.includes(p.id);
    if (!yes && !no) continue;
    if (yes) {
      try {
        if (p.memory) {
          const r = addMemory(p.memory.texto, 'proposta');
          if (!r.ok) throw new Error(r.error);
        } else if (p.skill) {
          const err = lintSkill(p.skill);
          if (err) throw new Error(err);
          installLocalSkill(p.skill, p.agentId);
        }
        out.approved.push(p.memory?.texto ?? p.skill!.nome);
      } catch (e) {
        out.errors.push(`${p.memory?.texto ?? p.skill?.nome}: ${(e as Error).message}`);
        continue;
      }
    } else out.rejected.push(p.memory?.texto ?? p.skill!.nome);
    db.prepare(`UPDATE learn_proposals SET status = ?, decided_at = ? WHERE id = ?`).run(yes ? 'approved' : 'rejected', now(), p.id);
    rmSync(join(pendingDir(), p.id), { recursive: true, force: true });
  }
  emit({ type: 'inbox.updated', inbox: inboxItems() });
  return out;
}

// ---------- revisão em segundo plano ----------

const today = () => new Date().toISOString().slice(0, 10);
const reviewsToday = () => Number(kvGet(`learn_reviews:${today()}`) ?? 0);
const dailyCap = () => Number(getSetting('learn.dailyReviews') ?? 30);

/** A execução merece revisão? (longa, falhou, teve aprovação rejeitada ou nota 👎) */
export function worthReview(run: Pick<RunInfo, 'id' | 'state' | 'rating'>): boolean {
  if (run.rating === -1) return true;
  if (run.state === 'failed') return true;
  if (run.state !== 'done') return false;
  const r = db.prepare(`SELECT num_turns FROM runs WHERE id = ?`).get(run.id) as { num_turns: number | null } | undefined;
  if ((r?.num_turns ?? 0) > 15) return true;
  return !!db.prepare(`SELECT 1 FROM approvals WHERE run_id = ? AND status = 'rejected' LIMIT 1`).get(run.id);
}

const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['licoes', 'memoria', 'skill'],
  properties: {
    licoes: { type: 'array', maxItems: 2, items: { type: 'object', additionalProperties: false, required: ['texto'], properties: { texto: { type: 'string' } } } },
    memoria: { type: 'array', maxItems: 1, items: { type: 'object', additionalProperties: false, required: ['texto', 'motivo'], properties: { texto: { type: 'string' }, motivo: { type: 'string' } } } },
    skill: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['nome', 'descricao', 'corpo'], properties: { nome: { type: 'string' }, descricao: { type: 'string' }, corpo: { type: 'string' } } }] },
  },
} as const;

let reviewing = Promise.resolve();
export function queueReview(runId: string, why: string): void {
  reviewing = reviewing.then(() => review(runId, why)).catch((e) => console.error('aprendizado', (e as Error).message));
}

async function review(runId: string, why: string): Promise<void> {
  if (!config.openaiKey || reviewsToday() >= dailyCap() || openaiOverCap()) return;
  const run = getRun(runId);
  if (!run) return;
  const row = db.prepare(`SELECT instruction FROM runs WHERE id = ?`).get(runId) as { instruction: string } | undefined;
  const events = (db.prepare(`SELECT kind, text FROM run_events WHERE run_id = ? AND kind IN ('error','system','result') ORDER BY t DESC LIMIT 15`).all(runId) as { kind: string; text: string }[])
    .reverse().map((e) => `[${e.kind}] ${e.text.slice(0, 300)}`).join('\n');
  const rejected = (db.prepare(`SELECT title FROM approvals WHERE run_id = ? AND status = 'rejected'`).all(runId) as { title: string }[]).map((a) => a.title);
  kvSet(`learn_reviews:${today()}`, String(reviewsToday() + 1));
  const res = await openai.responses.create({
    model: config.brainModel,
    instructions: `Você revisa uma execução de um agente (Claude Code) do Atria OS para que ele aprenda. Responda em português, JSON.
- licoes: 0 a 2 lições CONCRETAS e reutilizáveis para este agente (o que evitar ou o truque que funcionou), em 1 frase imperativa cada. Nada genérico ("seja cuidadoso"). Sem lição clara, lista vazia.
- memoria: no máximo 1 fato/preferência DO USUÁRIO que esteja explícito nas palavras da instrução do usuário (não em resultados, páginas ou e-mails). Na dúvida, vazio.
- skill: só se a execução mostrou um procedimento de vários passos que vai se repetir (ex.: deploy de um projeto específico). nome em kebab-case, descricao de 1 frase dizendo quando usar, corpo com passos numerados. Sem comandos rm, curl, wget, ssh ou sudo. Senão, null.
- Lições já existentes não devem ser repetidas.`,
    input: [
      `Motivo da revisão: ${why}`,
      `Agente: ${run.agent}`,
      `Instrução: ${(row?.instruction ?? run.task).slice(0, 1500)}`,
      `Estado: ${run.state}${run.rating === -1 ? ' (usuário deu 👎)' : ''}`,
      rejected.length ? `Aprovações rejeitadas pelo usuário: ${rejected.join('; ')}` : '',
      `Resultado: ${(run.result ?? '').slice(0, 2000)}`,
      events ? `Eventos finais:\n${events}` : '',
      `Lições atuais:\n${activeLessons(run.agentId).map((l) => `- ${l.text}`).join('\n') || '(nenhuma)'}`,
    ].filter(Boolean).join('\n\n'),
    text: { format: { type: 'json_schema', name: 'revisao', schema: REVIEW_SCHEMA as unknown as Record<string, unknown>, strict: true } },
  });
  trackOpenAI('aprendizado', res.model, res.usage);
  const out = JSON.parse(res.output_text) as { licoes: { texto: string }[]; memoria: { texto: string; motivo: string }[]; skill: SkillDraft | null };
  for (const l of out.licoes.slice(0, 2)) addLesson(run.agentId, l.texto, 'revisao', runId);
  for (const m of out.memoria.slice(0, 1)) propose('memory', m, run.agentId, runId);
  if (out.skill) propose('skill', out.skill, run.agentId, runId);
}

runBus.on('finished', (run: RunInfo) => {
  if (worthReview(run)) queueReview(run.id, run.state === 'failed' ? 'a execução falhou' : 'execução longa ou com aprovação rejeitada');
});
runBus.on('rated', (run: RunInfo) => {
  if (run.rating === -1) queueReview(run.id, 'o usuário deu 👎 no resultado');
});

// ---------- consolidação semanal (domingo de madrugada) ----------

export async function consolidate(): Promise<number> {
  if (!config.openaiKey || openaiOverCap()) return 0;
  const rows = db.prepare(`SELECT agent_id, COUNT(*) AS n FROM agent_lessons WHERE active = 1 GROUP BY agent_id HAVING n > 10 ORDER BY n DESC LIMIT 8`).all() as { agent_id: string; n: number }[];
  let merged = 0;
  for (const r of rows) {
    const list = activeLessons(r.agent_id);
    const res = await openai.responses.create({
      model: config.brainModel,
      instructions: 'Funda e pode as lições de um agente: junte repetidas, remova as obsoletas ou genéricas. Devolva no máximo 10, cada uma em 1 frase imperativa, em português.',
      input: list.map((l) => `- ${l.text}`).join('\n'),
      text: { format: { type: 'json_schema', name: 'licoes', strict: true, schema: { type: 'object', additionalProperties: false, required: ['licoes'], properties: { licoes: { type: 'array', maxItems: 10, items: { type: 'string' } } } } } },
    });
    trackOpenAI('aprendizado', res.model, res.usage);
    const next = (JSON.parse(res.output_text) as { licoes: string[] }).licoes.filter((t) => t.trim().length >= 8);
    if (!next.length) continue;
    db.prepare(`UPDATE agent_lessons SET active = 0 WHERE agent_id = ? AND active = 1`).run(r.agent_id);
    for (const t of next.reverse()) addLesson(r.agent_id, t, 'consolidado');
    merged++;
  }
  return merged;
}

const weekKey = () => {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  return `${d.getFullYear()}-${Math.ceil(((d.getTime() - onejan.getTime()) / 86400_000 + onejan.getDay() + 1) / 7)}`;
};
setInterval(() => {
  const d = new Date();
  if (d.getDay() !== 0 || d.getHours() !== 4 || kvGet('learn_consolidated') === weekKey()) return;
  kvSet('learn_consolidated', weekKey());
  void consolidate().catch((e) => console.error('aprendizado: consolidação', (e as Error).message));
}, 30 * 60_000).unref();

// ---------- agentes: propor skill ----------

registerRunPrompt(() => '- Se você resolveu algo em vários passos que vai se repetir (ex.: o deploy deste projeto), proponha uma skill com mcp__aprendizado__propor_skill. O usuário aprova antes de virar skill.');

registerAgentOptions((agentId, ctx) => {
  if (!ctx) return {};
  const server = createSdkMcpServer({
    name: 'aprendizado',
    version: '1.0.0',
    tools: [
      tool(
        'propor_skill',
        'Propõe uma skill (procedimento reutilizável) a partir do que você acabou de fazer. Vira skill sua só depois que o usuário aprovar.',
        { nome: z.string().describe('kebab-case, ex.: deploy-stoqmate'), descricao: z.string().describe('1 frase: quando usar'), corpo: z.string().describe('passos numerados em markdown, sem rm/curl/wget/ssh/sudo') },
        async ({ nome, descricao, corpo }) => {
          const r = propose('skill', { nome, descricao, corpo }, agentId, ctx.runId);
          return 'error' in r ? { content: [{ type: 'text', text: `Não propus: ${r.error}` }], isError: true } : { content: [{ type: 'text', text: `Skill "${r.skill!.nome}" proposta; o usuário decide no cartão "Yui aprendeu".` }] };
        },
      ),
    ],
  });
  return { mcpServers: { aprendizado: server } };
});

// ---------- Yui ----------

async function draftSkillFromRun(runId: string): Promise<SkillDraft> {
  const run = getRun(runId);
  if (!run) throw new Error('execução não encontrada');
  const steps = (db.prepare(`SELECT text FROM run_events WHERE run_id = ? AND kind IN ('tool','text') ORDER BY t LIMIT 60`).all(runId) as { text: string }[]).map((e) => `- ${e.text.slice(0, 200)}`).join('\n');
  const res = await openai.responses.create({
    model: config.brainModel,
    instructions: 'Transforme o que o agente fez numa skill reutilizável (SKILL.md). nome em kebab-case; descricao de 1 frase dizendo quando usar; corpo com passos numerados e pontos de atenção. Sem comandos rm, curl, wget, ssh ou sudo. Português.',
    input: `Tarefa: ${run.task}\nResultado: ${(run.result ?? '').slice(0, 1500)}\nPassos:\n${steps}`,
    text: { format: { type: 'json_schema', name: 'skill', strict: true, schema: { type: 'object', additionalProperties: false, required: ['nome', 'descricao', 'corpo'], properties: { nome: { type: 'string' }, descricao: { type: 'string' }, corpo: { type: 'string' } } } } },
  });
  trackOpenAI('aprendizado', res.model, res.usage);
  return JSON.parse(res.output_text) as SkillDraft;
}

registerBrain({
  name: 'aprendizado',
  instructions: '- "Salva isso como skill", "transforma o que o agente fez em skill" => salvar_skill (sem id = última execução concluída). A skill fica para o usuário aprovar no cartão "Yui aprendeu"; diga isso em 1 frase.\n- "O que o agente X aprendeu?" => licoes_agente.',
  tools: [
    {
      type: 'function', name: 'salvar_skill', strict: true,
      description: 'Rascunha uma skill a partir de uma execução e deixa para o usuário aprovar.',
      parameters: { type: 'object', additionalProperties: false, properties: { run_id: { type: ['string', 'null'] } }, required: ['run_id'] },
    },
    {
      type: 'function', name: 'licoes_agente', strict: true,
      description: 'Lições que um agente aprendeu (ativas).',
      parameters: { type: 'object', additionalProperties: false, properties: { agente: { type: 'string' } }, required: ['agente'] },
    },
  ],
  run(tool, args, ctx) {
    if (tool === 'licoes_agente') {
      const a = findAgent(String(args.agente ?? ''));
      return Promise.resolve(a ? { agente: a.name, licoes: activeLessons(a.id).map((l) => l.text) } : { ok: false, error: 'agente não encontrado' });
    }
    if (tool !== 'salvar_skill') return undefined;
    return (async () => {
      const id = typeof args.run_id === 'string' && args.run_id ? args.run_id : (db.prepare(`SELECT id FROM runs WHERE state = 'done' ORDER BY finished_at DESC LIMIT 1`).get() as { id: string } | undefined)?.id;
      if (!id) return { ok: false, error: 'nenhuma execução concluída' };
      if (ctx.dryRun) return { ok: true };
      const run = getRun(id)!;
      const r = propose('skill', await draftSkillFromRun(id), run.agentId, id);
      return 'error' in r ? { ok: false, error: r.error } : { ok: true, skill: r.skill!.nome, nota: 'fica para aprovar no cartão "Yui aprendeu"' };
    })();
  },
});

export function register(app: FastifyInstance): void {
  importVaultLessons();
  app.get('/api/learning/proposals', () => pendingProposals());
  app.post('/api/learning/decide', (req) => {
    const b = (req.body ?? {}) as { approve?: unknown; reject?: unknown };
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return decide(ids(b.approve), ids(b.reject));
  });
  app.get('/api/agents/:id/lessons', (req) => activeLessons((req.params as { id: string }).id));
  app.post('/api/agents/:id/lessons', (req, reply) => {
    const l = addLesson((req.params as { id: string }).id, String((req.body as { text?: unknown } | undefined)?.text ?? ''), 'usuario');
    return l ?? reply.code(400).send({ error: 'lição vazia ou repetida' });
  });
  app.delete('/api/lessons/:id', (req, reply) => reply.code(undoLesson((req.params as { id: string }).id) ? 204 : 404).send());
}
