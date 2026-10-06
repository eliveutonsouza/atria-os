import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { query, type CanUseTool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ApprovalInfo, InboxItem, RunInfo, RunEventLine, RunState, RunStep } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, kvGet, kvSet, now, uid } from './db.ts';
import { emit } from './bus.ts';
import { findAgent, agentsWorking, type AgentDef } from './agents.ts';
import { ensureProject, findProject } from './projects.ts';
import { agentOptions, runPromptExtras } from './extensions.ts';
import { getSetting } from './settings.ts';
import { blockedReason } from './safety.ts';
import { saveRateLimit } from './claudeUsage.ts';

// Eventos para a camada de conversa (live.ts / brain.ts) narrar o trabalho.
export const runBus = new EventEmitter<{
  progress: [RunInfo];
  finished: [RunInfo];
  approval: [ApprovalInfo];
}>();

type RunRow = {
  id: string; mission_id: string | null; step_id: string | null; workflow_run_id: string | null; display: 'blocks' | 'html' | null; agent_id: string; project: string | null; instruction: string; task: string; state: RunState;
  progress: number; current_op: string | null; tools: string; steps: string; result: string | null;
  session_id: string | null; tokens_in: number; tokens_out: number; cost_usd: number; context_tokens?: number | null; context_window?: number | null; num_turns?: number | null;
  created_at: string; started_at: string | null; finished_at: string | null;
};

export function toRunInfo(r: RunRow): RunInfo {
  const agent = findAgent(r.agent_id);
  return {
    id: r.id,
    agent: agent?.name ?? r.agent_id,
    agentId: r.agent_id,
    project: r.project,
    task: r.task,
    state: r.state,
    progress: Math.round(r.progress),
    currentOp: r.current_op,
    tools: JSON.parse(r.tools),
    steps: JSON.parse(r.steps),
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    result: r.result,
    sessionId: r.session_id,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    costUsd: r.cost_usd,
    missionId: r.mission_id,
    workflowRunId: r.workflow_run_id,
    display: r.display,
  };
}

export function getRun(id: string): RunInfo | null {
  const r = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
  return r ? toRunInfo(r) : null;
}

export function listRuns(limit = 30): RunInfo[] {
  const rows = db
    .prepare(
      `SELECT * FROM runs ORDER BY CASE state WHEN 'running' THEN 0 WHEN 'waiting_approval' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END, created_at DESC LIMIT ?`,
    )
    .all(limit) as RunRow[];
  return rows.map(toRunInfo);
}

export function runEvents(id: string): RunEventLine[] {
  return db.prepare('SELECT t, kind, text FROM run_events WHERE run_id = ? ORDER BY id').all(id) as RunEventLine[];
}

function patch(id: string, fields: Partial<Record<keyof RunRow, unknown>>): RunInfo {
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const keys = Object.keys(clean);
  if (keys.length) {
    db.prepare(`UPDATE runs SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...clean, id });
  }
  const info = getRun(id)!;
  emit({ type: 'run.updated', run: info });
  return info;
}

function logEvent(runId: string, kind: RunEventLine['kind'], text: string) {
  db.prepare('INSERT INTO run_events(run_id, t, kind, text) VALUES(?, ?, ?, ?)').run(runId, now(), kind, text.slice(0, 4000));
}

// ---------- fila ----------

const running = new Map<string, AbortController>();

export interface EnqueueInput {
  agentId: string;
  project: string | null;
  instruction: string;
  task?: string;
  selectedElement?: string | null;
  origin?: 'yui' | 'manual' | 'routine' | 'mission' | 'workflow';
  routineId?: string;
  missionId?: string;
  stepId?: string;
  workflowRunId?: string;
  display?: 'blocks' | 'html' | null;
}

export function enqueueRun(input: EnqueueInput): RunInfo {
  const agent = findAgent(input.agentId);
  if (!agent) throw new Error(`agente desconhecido: ${input.agentId}`);
  const project = input.project ? findProject(input.project) : undefined;
  if (input.project && !project) throw new Error(`projeto desconhecido: ${input.project}`);
  const id = uid();
  const task = (input.task ?? input.instruction).replace(/\s+/g, ' ').slice(0, 110);
  const instruction = input.selectedElement
    ? `${input.instruction}\n\nContexto visual: o usuário selecionou o elemento \`${input.selectedElement}\` no preview.`
    : input.instruction;
  db.prepare(
    `INSERT INTO runs(id, agent_id, project, instruction, task, state, origin, routine_id, mission_id, step_id, workflow_run_id, display, created_at)
     VALUES(?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, agent.id, project?.slug ?? null, instruction, task, input.origin ?? 'yui', input.routineId ?? null,
    input.missionId ?? null, input.stepId ?? null, input.workflowRunId ?? null, input.display ?? null, now());
  const info = getRun(id)!;
  emit({ type: 'run.updated', run: info });
  setImmediate(pump);
  return info;
}

function pump() {
  while (running.size < config.maxConcurrentRuns) {
    const next = db.prepare(`SELECT * FROM runs WHERE state = 'queued' ORDER BY created_at LIMIT 1`).get() as RunRow | undefined;
    if (!next) return;
    const ac = new AbortController();
    running.set(next.id, ac);
    patch(next.id, { state: 'running', started_at: now(), current_op: 'Acordando…' });
    emit({ type: 'agents.updated', agentsWorking: agentsWorking() });
    execute(next, ac)
      .catch((err) => {
        if (ac.signal.aborted) {
          logEvent(next.id, 'system', 'cancelado pelo usuário');
          runBus.emit('finished', patch(next.id, { state: 'cancelled', finished_at: now(), current_op: 'Cancelado', result: 'Cancelado.' }));
          return;
        }
        logEvent(next.id, 'error', String(err?.message ?? err));
        const info = patch(next.id, { state: 'failed', finished_at: now(), result: `Falhou: ${String(err?.message ?? err).slice(0, 300)}` });
        runBus.emit('finished', info);
      })
      .finally(() => {
        running.delete(next.id);
        emit({ type: 'agents.updated', agentsWorking: agentsWorking() });
        setImmediate(pump);
      });
  }
}

export function cancelRun(id: string): boolean {
  const ac = running.get(id);
  if (ac) {
    ac.abort();
    return true;
  }
  const r = db.prepare(`UPDATE runs SET state = 'cancelled', finished_at = ? WHERE id = ? AND state = 'queued'`).run(now(), id);
  return r.changes > 0;
}

// Runs "running" de um processo anterior morreram com ele.
export function recoverRuns() {
  db.prepare(`UPDATE runs SET state = 'failed', finished_at = ?, result = 'Interrompido por reinício do Yui Console.' WHERE state IN ('running','waiting_approval')`).run(now());
  db.prepare(`UPDATE approvals SET status = 'expired', resolved_at = ? WHERE status = 'pending'`).run(now());
  setImmediate(pump);
}

// ---------- execução via Claude Agent SDK ----------

const SAFE_TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit', 'TodoWrite', 'WebSearch', 'WebFetch', 'Task'];

const SENSITIVE_MCP = /(send|reply|forward|delete|trash|remove|publish|deploy|merge|purchase|buy|pay|transfer|refund|share|invite|create_event|update_event|post_|tiktok_publish|execute_preset)/i;

const toolLabel = (name: string) => {
  if (name.startsWith('mcp__claude-in-chrome__')) return 'Chrome';
  if (name.startsWith('mcp__playwright__')) return 'Navegador';
  const m = /^mcp__([^_]+(?:_[^_]+)*)__/.exec(name);
  if (m) {
    const server = m[1].replace(/^claude_ai_/, '').replace(/[-_]/g, ' ');
    return /^claude_ai_/.test(m[1]) ? server : `${server.replace(/\b\w/g, (c) => c.toUpperCase())} MCP`;
  }
  return name;
};

function describeTool(name: string, input: Record<string, unknown>): string {
  const p = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  const short = (s: string) => s.replace(/^\/workspace\/[^/]+\//, '');
  switch (name) {
    case 'Read':
      return `Lendo ${short(p('file_path'))}`;
    case 'Edit':
    case 'Write':
      return `Editando ${short(p('file_path'))}`;
    case 'Bash':
      return `$ ${p('command').split('\n')[0].slice(0, 120)}`;
    case 'Grep':
      return `Buscando "${p('pattern').slice(0, 60)}"`;
    case 'Glob':
      return `Listando ${p('pattern')}`;
    case 'WebSearch':
      return `Pesquisando "${p('query').slice(0, 80)}"`;
    case 'WebFetch':
      return `Abrindo ${p('url').slice(0, 80)}`;
    case 'TodoWrite':
      return 'Atualizando plano';
    default: {
      const op = name.split('__').pop() ?? name;
      if (/navigate$/.test(op)) return `Navegando ${p('url').slice(0, 80)}`;
      if (/screenshot/.test(op)) return 'Tirando screenshot';
      if (/click$/.test(op)) return `Clicando ${p('element').slice(0, 60)}`;
      if (/(type|fill|form_input)/.test(op)) return 'Preenchendo formulário';
      return `${toolLabel(name)} · ${op}`;
    }
  }
}

// Aprovação genérica (modal do console). `ownerId` = run, missão ou execução de workflow.
export async function askApproval(ownerId: string, title: string, rows: ApprovalInfo['rows'], signal?: AbortSignal, opts: { kind?: ApprovalInfo['kind'] } = {}): Promise<boolean> {
  const id = uid();
  db.prepare(`INSERT INTO approvals(id, run_id, title, rows, created_at, kind) VALUES(?, ?, ?, ?, ?, ?)`).run(id, ownerId, title, JSON.stringify(rows), now(), opts.kind ?? null);
  const approval: ApprovalInfo = { id, runId: ownerId, title, rows, createdAt: now(), ...(opts.kind ? { kind: opts.kind } : {}) };
  emit({ type: 'approval.requested', approval });
  emit({ type: 'inbox.updated', inbox: inboxItems() });
  runBus.emit('approval', approval);
  const approved = await new Promise<boolean>((resolve) => {
    waiters.set(id, resolve);
    signal?.addEventListener('abort', () => resolve(false), { once: true });
  });
  waiters.delete(id);
  return approved;
}

async function requestApproval(run: RunRow, title: string, rows: ApprovalInfo['rows'], signal: AbortSignal): Promise<boolean> {
  patch(run.id, { state: 'waiting_approval', current_op: 'Aguardando sua aprovação' });
  const approved = await askApproval(run.id, title, rows, signal);
  patch(run.id, { state: 'running', current_op: approved ? 'Aprovado — continuando' : 'Rejeitado — ajustando' });
  return approved;
}

// Cancela todas as aprovações pendentes de um dono (missão/workflow cancelados).
export function expireApprovals(ownerId: string) {
  const rows = db.prepare(`SELECT id FROM approvals WHERE run_id = ? AND status = 'pending'`).all(ownerId) as { id: string }[];
  for (const r of rows) {
    db.prepare(`UPDATE approvals SET status = 'expired', resolved_at = ? WHERE id = ?`).run(now(), r.id);
    waiters.get(r.id)?.(false);
    emit({ type: 'approval.resolved', approvalId: r.id, approved: false });
  }
  if (rows.length) emit({ type: 'inbox.updated', inbox: inboxItems() });
}

const waiters = new Map<string, (ok: boolean) => void>();

export function resolveApproval(id: string, approved: boolean): boolean {
  const r = db.prepare(`UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'`).run(approved ? 'approved' : 'rejected', now(), id);
  if (!r.changes) return false;
  waiters.get(id)?.(approved);
  emit({ type: 'approval.resolved', approvalId: id, approved });
  emit({ type: 'inbox.updated', inbox: inboxItems() });
  return true;
}

export function pendingApprovals(): ApprovalInfo[] {
  const rows = db.prepare(`SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at`).all() as {
    id: string; run_id: string; title: string; rows: string; created_at: string; kind: string | null;
  }[];
  return rows.map((r) => ({ id: r.id, runId: r.run_id, title: r.title, rows: JSON.parse(r.rows), createdAt: r.created_at, ...(r.kind === 'destructive' ? { kind: 'destructive' as const } : {}) }));
}

export function inboxItems(): InboxItem[] {
  const dismissed = new Set(dismissedInbox());
  const items: InboxItem[] = pendingApprovals().map((a) => ({
    id: `approval:${a.id}`,
    tag: a.kind === 'destructive' ? 'Exclusão' : 'Aprovação',
    label: a.title,
    tone: a.kind === 'destructive' ? 'crit' : 'warn',
    action: { type: 'approval', approvalId: a.id },
  }));
  const failed = db
    .prepare(`SELECT id, task, project FROM runs WHERE state = 'failed' AND finished_at > ? ORDER BY finished_at DESC LIMIT 3`)
    .all(new Date(Date.now() - 24 * 3600_000).toISOString()) as { id: string; task: string; project: string | null }[];
  for (const f of failed) {
    if (dismissed.has(`failed:${f.id}`)) continue;
    items.push({ id: `failed:${f.id}`, tag: 'Falha', label: f.task, tone: 'crit', action: { type: 'view', view: 'runs', params: { runId: f.id } } });
  }
  return items;
}

// Falhas dispensadas pelo usuário somem do inbox (aprovações pendentes nunca são dispensáveis).
const dismissedInbox = (): string[] => {
  try {
    const v = JSON.parse(kvGet('inbox_dismissed') ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export function dismissInboxItem(id: string): boolean {
  if (!id.startsWith('failed:')) return false;
  const list = dismissedInbox().filter((x) => x !== id);
  kvSet('inbox_dismissed', JSON.stringify([...list, id].slice(-200)));
  emit({ type: 'inbox.updated', inbox: inboxItems() });
  return true;
}

// ---------- histórico: paginação e exclusão ----------

const ACTIVE_STATES = `('running','queued','waiting_approval')`;

// Página do histórico por data de criação (mais novas primeiro); `before` = created_at do último item já mostrado.
export function listRunsPage(before: string | null, limit = 40): { runs: RunInfo[]; next: string | null } {
  const rows = (before
    ? db.prepare(`SELECT * FROM runs WHERE created_at < ? ORDER BY created_at DESC LIMIT ?`).all(before, limit)
    : db.prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT ?`).all(limit)) as RunRow[];
  return { runs: rows.map(toRunInfo), next: rows.at(-1)?.created_at ?? null };
}

// Exclui uma execução (eventos vão junto). Ativa: cancela e espera o loop soltar a run antes de apagar.
export async function deleteRun(id: string): Promise<boolean> {
  if (!getRun(id)) return false;
  if (running.has(id)) {
    cancelRun(id);
    for (let i = 0; i < 100 && running.has(id); i++) await new Promise((r) => setTimeout(r, 50));
    if (running.has(id)) throw new Error('a execução não parou a tempo; tente de novo');
  } else cancelRun(id);
  expireApprovals(id);
  db.prepare('DELETE FROM run_events WHERE run_id = ?').run(id);
  db.prepare('DELETE FROM runs WHERE id = ?').run(id);
  emit({ type: 'inbox.updated', inbox: inboxItems() });
  return true;
}

// Apaga execuções terminadas há mais de N dias; ativas e na fila ficam.
export function purgeRuns(olderThanDays: number): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const where = `state NOT IN ${ACTIVE_STATES} AND COALESCE(finished_at, created_at) < ?`;
  const n = db.transaction(() => {
    db.prepare(`DELETE FROM run_events WHERE run_id IN (SELECT id FROM runs WHERE ${where})`).run(cutoff);
    return db.prepare(`DELETE FROM runs WHERE ${where}`).run(cutoff).changes;
  })();
  if (n) emit({ type: 'inbox.updated', inbox: inboxItems() });
  return n;
}

function systemAppend(agent: AgentDef, projectName: string | null): string {
  return [
    `Você é o ${agent.name}, um agente da força de trabalho da Yui (Yui Console).`,
    agent.prompt,
    '',
    'Regras de execução:',
    '- Use TodoWrite logo no início com 3 a 6 passos curtos em português; mantenha-o atualizado — ele vira a timeline que o usuário vê.',
    '- Trabalhe de forma autônoma; não faça perguntas ao usuário. Se algo bloquear, explique no resultado final.',
    '- Você trabalha no automático: não peça confirmação ao usuário, siga até entregar. Comandos catastróficos (apagar raiz/workspace, formatar disco, DROP DATABASE, mexer em stacks de produção protegidos, force push na main) são bloqueados; se um comando for negado, siga sem ele.',
    '- Resposta final: 1 a 3 frases em português, no estilo de status para ser falado em voz alta (o que foi feito, resultado, próximo passo).',
    projectName ? `- Projeto atual: ${projectName}.` : '- Sem projeto específico: trabalhe em /workspace/.yui/scratch.',
    '- Navegador: use as ferramentas mcp__playwright__* (Chromium headless na VPS) para navegar, testar sites, preencher formulários e tirar screenshots. Use mcp__claude-in-chrome__* só quando precisar do Chrome real do usuário (contas logadas dele) — chame list_connected_browsers antes; se não houver navegador conectado, use o Playwright e diga isso no resultado. Screenshots com filename relativo são salvos no diretório do projeto atual.',
    '- Relatórios: se pedirem um relatório, grave JSON em /workspace/.yui/reports/<AAAA-MM-DD-HHmm>.json com {title, lead, kpis:[{value,label}], sections:[{heading, tone:"cyan"|"warn"|"ok", items:[...]}]}.',
  ].join('\n');
}

// Login claude.ai no container (docker exec … claude → /login) traz conectores MCP e tem prioridade;
// sem ele, usa o token de inferência do setup-token.
export const claudeLoggedIn = () => existsSync(join(process.env.HOME ?? '/data/home', '.claude', '.credentials.json'));

export function claudeEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!claudeLoggedIn() && config.claudeToken) env.CLAUDE_CODE_OAUTH_TOKEN = config.claudeToken;
  return env;
}

async function execute(run: RunRow, ac: AbortController) {
  const agent = findAgent(run.agent_id);
  if (!agent) throw new Error(`agente ${run.agent_id} não existe mais`);
  let project = run.project ? findProject(run.project) : undefined;
  if (project && !project.cloned) {
    patch(run.id, { current_op: `Clonando ${project.repo}…` });
    project = await ensureProject(project);
  }
  const scratch = join(config.workspaceDir, '.yui', 'scratch');
  const yuiDir = join(config.workspaceDir, '.yui');
  mkdirSync(join(yuiDir, 'reports'), { recursive: true });
  mkdirSync(scratch, { recursive: true });
  const cwd = project?.dir ?? scratch;
  const extraPatterns = (project?.approvalPatterns ?? []).map((p) => new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const canUseTool: CanUseTool = async (toolName, input, { signal }) => {
    if (toolName === 'Bash') {
      const cmd = String(input.command ?? '');
      // Automático por padrão: só o catastrófico é negado (sem modal) e só os padrões que o usuário
      // configurou no yui.json do projeto pedem aprovação.
      const blocked = blockedReason(cmd);
      if (blocked) {
        logEvent(run.id, 'system', `Bloqueado por segurança (${blocked}): ${cmd.split('\n')[0].slice(0, 200)}`);
        return { behavior: 'deny', message: `Comando bloqueado por segurança (${blocked}). Não tente contornar; siga sem ele e explique no resultado.` };
      }
      if (extraPatterns.some((re) => re.test(cmd))) {
        const ok = await requestApproval(
          run,
          `${agent.name} quer executar um comando sensível${project ? ` no ${project.name}` : ''}.`,
          [
            { label: 'Comando', value: cmd.split('\n')[0].slice(0, 80) },
            { label: 'Agente', value: agent.name },
            { label: 'Projeto', value: project?.name ?? '—' },
          ],
          signal,
        );
        return ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'O usuário rejeitou este comando. Continue sem executá-lo e explique no resultado.' };
      }
      return { behavior: 'allow', updatedInput: input };
    }
    // Conectores/MCP com efeito externo irreversível (enviar e-mail, publicar, pagar…) pedem aprovação.
    if (toolName.startsWith('mcp__') && getSetting('approvals.mcpSensitive') !== false && SENSITIVE_MCP.test(toolName.split('__').pop() ?? '')) {
      const ok = await requestApproval(
        run,
        `${agent.name} quer usar ${toolLabel(toolName)} (${toolName.split('__').pop()}).`,
        [
          { label: 'Ferramenta', value: toolName.split('__').pop() ?? toolName },
          { label: 'Detalhe', value: JSON.stringify(input).slice(0, 80) },
          { label: 'Agente', value: agent.name },
        ],
        signal,
      );
      return ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'O usuário rejeitou esta ação. Continue sem ela e explique no resultado.' };
    }
    return { behavior: 'allow', updatedInput: input };
  };

  const tools = new Set<string>(JSON.parse(run.tools));
  let steps: RunStep[] = [];
  let lastContext = 0;
  let turns = 0;

  const { mcpServers: extraMcp, ...perAgent } = agentOptions(agent.id);
  const q = query({
    prompt: run.instruction,
    options: {
      cwd,
      abortController: ac,
      additionalDirectories: [yuiDir],
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: [systemAppend(agent, project?.name ?? null), runPromptExtras({ runId: run.id, agentId: agent.id, project: project?.slug ?? null, display: run.display })].filter(Boolean).join('\n'),
      },
      permissionMode: 'default',
      allowedTools: SAFE_TOOLS,
      canUseTool,
      // user: plugins/settings instalados no HOME do container; claude.ai: conectores MCP do login.
      settingSources: ['user', 'project', 'local'],
      // Navegador headless (sidecar Playwright) + Claude in Chrome (Chrome real do usuário, quando conectado).
      mcpServers: { playwright: { type: 'http', url: config.browserMcpUrl }, ...(extraMcp ?? {}) },
      extraArgs: { chrome: null },
      model: agent.model || config.claudeModel || undefined,
      maxTurns: 80,
      env: claudeEnv(),
      ...perAgent,
    },
  });

  for await (const msg of q as AsyncIterable<SDKMessage>) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      patch(run.id, { session_id: msg.session_id });
      logEvent(run.id, 'system', `session ${msg.session_id} · cwd ${cwd}`);
      const mcp = msg.mcp_servers.map((m) => `${m.name}${m.status === 'connected' ? '' : ` (${m.status})`}`);
      if (mcp.length) logEvent(run.id, 'system', `MCP: ${mcp.join(', ')}`);
      if (msg.plugins.length) logEvent(run.id, 'system', `plugins: ${msg.plugins.map((p) => p.name).join(', ')}`);
      kvSet('claude_capabilities', JSON.stringify({ at: now(), mcp: msg.mcp_servers, plugins: msg.plugins.map((p) => p.name), apiKeySource: msg.apiKeySource }));
    } else if (msg.type === 'rate_limit_event') {
      // limites do plano (sessão de 5 h, semana…): o painel Consumo de IA mostra o último lido
      saveRateLimit((msg as { rate_limit_info?: unknown }).rate_limit_info);
    } else if (msg.type === 'assistant') {
      turns++;
      // contexto ocupado no turno do loop principal (subagentes têm janela própria)
      const u = (msg.message as { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage;
      if (u && !(msg as { parent_tool_use_id?: string | null }).parent_tool_use_id) lastContext = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text.trim()) {
          logEvent(run.id, 'text', block.text.trim());
        } else if (block.type === 'tool_use') {
          const input = (block.input ?? {}) as Record<string, unknown>;
          tools.add(toolLabel(block.name));
          const op = describeTool(block.name, input);
          logEvent(run.id, 'tool', op);
          const fields: Record<string, unknown> = { current_op: op, tools: JSON.stringify([...tools]) };
          if (block.name === 'TodoWrite' && Array.isArray(input.todos)) {
            const todos = input.todos as { content: string; status: string; activeForm?: string }[];
            steps = todos.map((t) => ({
              label: t.status === 'in_progress' ? (t.activeForm ?? t.content) : t.content,
              status: t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'active' : 'pending',
            }));
            const done = todos.filter((t) => t.status === 'completed').length;
            fields.steps = JSON.stringify(steps);
            fields.progress = Math.min(95, Math.round((done / Math.max(1, todos.length)) * 100));
          } else if (!steps.length) {
            fields.progress = Math.min(80, 5 + turns * 4);
          }
          const info = patch(run.id, fields);
          runBus.emit('progress', info);
        }
      }
    } else if (msg.type === 'result') {
      const usage = msg.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
      // modelUsage soma também os subagentes (Task); usage é só o loop principal
      const mu = Object.values((msg as { modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; contextWindow?: number }> }).modelUsage ?? {});
      const muIn = mu.reduce((a, m) => a + (m.inputTokens ?? 0) + (m.cacheReadInputTokens ?? 0) + (m.cacheCreationInputTokens ?? 0), 0);
      const muOut = mu.reduce((a, m) => a + (m.outputTokens ?? 0), 0);
      const ctxWindow = mu.reduce((a, m) => Math.max(a, m.contextWindow ?? 0), 0);
      const ok = msg.subtype === 'success';
      const result = ok ? ((msg as { result?: string }).result ?? '').trim() : `Falhou (${msg.subtype}). ${(msg as { errors?: string[] }).errors?.join('; ') ?? ''}`;
      logEvent(run.id, ok ? 'result' : 'error', result || '(sem texto)');
      logEvent(run.id, 'system', `tokens: ${(usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)} in · ${usage.output_tokens ?? 0} out · $${msg.total_cost_usd.toFixed(4)}`);
      const info = patch(run.id, {
        state: ok ? 'done' : 'failed',
        progress: ok ? 100 : undefined,
        finished_at: now(),
        result: result.slice(0, 24000), // resultado completo: missões e workflows passam adiante
        current_op: ok ? 'Concluído' : 'Falhou',
        steps: JSON.stringify(ok ? steps.map((s) => ({ ...s, status: 'done' })) : steps),
        tokens_in: muIn || (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
        tokens_out: muOut || (usage.output_tokens ?? 0),
        cost_usd: msg.total_cost_usd,
        context_tokens: lastContext || null,
        context_window: ctxWindow || null,
        num_turns: (msg as { num_turns?: number }).num_turns ?? turns,
      } as Partial<Record<keyof RunRow, unknown>>);
      runBus.emit('finished', info);
      return;
    }
  }
  if (ac.signal.aborted) {
    const info = patch(run.id, { state: 'cancelled', finished_at: now(), current_op: 'Cancelado' });
    runBus.emit('finished', info);
  }
}
