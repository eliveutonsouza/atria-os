import { trackOpenAI } from './usage.ts';
import OpenAI from 'openai';
import type { ChatContext, ViewName } from '../../shared/protocol.ts';
import { VIEW_NAMES } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, kvGet, now, uid } from './db.ts';
import { emit, setYuiState } from './bus.ts';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentInfos, agentsDir, invalidateAgents, loadAgents, parseAgent, serializeAgent } from './agents.ts';
import { activeProject, findProject, listProjectConfigs, projectDetail, projectLogs, setActiveProject } from './projects.ts';
import { enqueueRun, inboxItems, listRuns, pendingApprovals } from './runs.ts';
import { infra, overview } from './metrics.ts';
import { createRoutine } from './routines.ts';
import { brainExtensions, type ToolCtx } from './extensions.ts';

// "Cérebro" da Yui: modelo de texto (Responses API) com as ferramentas do console.
// Recebe pedidos digitados ou delegações do GPT-Live e devolve uma frase curta para ser dita/mostrada.

// 429 (limite de tokens/min da conta) acontece sob carga: o SDK respeita retry-after com backoff.
export const openai = new OpenAI({ apiKey: config.openaiKey || 'missing', maxRetries: 4 });
// Chave trocada nas Configurações → o mesmo cliente (importado por voz, missões, workflows) passa a usá-la.
export function refreshOpenAI() {
  openai.apiKey = config.openaiKey || 'missing';
}

let uiContext: ChatContext = { view: null, mode: 'center' };
export function setUiContext(ctx: ChatContext) {
  uiContext = ctx;
}
export const getUiContext = () => uiContext;

export function saveMessage(who: 'user' | 'yui', text: string, source: 'text' | 'voice') {
  const t = text.trim();
  if (!t) return;
  db.prepare('INSERT INTO messages(id, who, text, source, at) VALUES(?, ?, ?, ?, ?)').run(uid(), who, t, source, now());
}

export function recentMessages(limit = 24): { who: 'user' | 'yui'; text: string; at: string }[] {
  return (db.prepare('SELECT who, text, at FROM messages ORDER BY at DESC LIMIT ?').all(limit) as { who: 'user' | 'yui'; text: string; at: string }[]).reverse();
}

// Nome do dono vem das Configurações (pode mudar com o servidor no ar).
const ownerName = () => (config.userName ? `de ${config.userName}` : 'do usuário');
const instructionsText = () => `Você é o raciocínio por trás da Yui, a assistente do Yui Console — a central pessoal de IA ${ownerName()}.
A Yui conversa (por voz ou texto) e você decide o que fazer usando ferramentas. A força de execução são agentes Claude Code (delegate_task).

Como responder:
- Responda SEMPRE em português do Brasil, 1 ou 2 frases curtas, tom calmo e direto, pronto para ser falado. Sem markdown, listas ou emojis.
- Nunca invente números, status ou resultados: consulte com get_overview, get_project, get_runs, get_logs ou get_infra antes de afirmar.
- Quando o usuário pedir para ver algo ("me mostra", "abre", "quero ver", "mostra os dados", "faz um gráfico") chame show_view com a view certa:
  brief (resumo da noite), dashboard (visão geral), terminal (Claude Code interativo/shell; "abre o terminal"), agents, runs (execuções), project (precisa de project), logs (precisa de project), report, website (preview do projeto; precisa de project), infra (VPS/containers), artifact.
- Quando você responder um status sem o usuário pedir para ver, chame suggest_view com a view relacionada e termine com uma pergunta curta tipo "Quer ver?".
- "Volta", "fecha", "sair" => close_canvas. "Tela cheia" => set_focus(true).
- Pedidos de trabalho (corrigir, criar, pesquisar, revisar, gerar relatório, criar site) => delegate_task com o agente mais adequado e uma instrução completa e autossuficiente (o agente não vê esta conversa). Diga em uma frase quem você acordou e o que vai fazer.
- Para trabalhos que o usuário quer recorrentes ("todo dia às 8h…") use create_routine.
- Os agentes têm acesso real às contas do usuário pelos conectores listados em "Conectores dos agentes" (ex.: Google Calendar, Gmail, Drive, Linear, Vercel, Supabase) e a um navegador. NUNCA diga que não há acesso a um serviço dessa lista: delegue ao agente Assistente (agenda, e-mail, documentos, tarefas, consultas) com instrução completa (data, hora, fuso ${config.timezone}, título). Se faltar só a data, assuma a próxima ocorrência futura e diga qual assumiu.
- Os projetos do usuário são os repositórios dele no GitHub (catálogo automático). Nunca peça para cadastrar projeto: se não reconhecer o nome, use list_repos. Projetos ainda não clonados são clonados sozinhos ao abrir ou delegar.
- Se o usuário mudar de projeto ("agora no Stoqmate"), use switch_project.
- Aprovações são sempre decididas pelo usuário no modal; use open_approval para mostrá-lo, nunca aprove sozinha.
- Se a fala parecer transcrição truncada ou ambígua, pergunte só o detalhe que falta.

Roteamento (quem faz o quê):
- Ver/abrir telas: show_view. "o que está acontecendo agora", "execuções" => runs; "visão geral" => dashboard; "ferramentas, conectores, MCP, skills, plugins" => tools; "workflows" => workflows; "rotinas/agendamentos" => routines; "mapa/guia do Claude Code" => claude; um agente específico => agent.
- "Tem aprovação pendente?" => open_approval (abre o modal se houver).
- "Consegue acessar meus projetos/GitHub?" => list_repos e responda com o que existe.
- Agenda, e-mail, Drive, documentos, Linear, Vercel, Supabase, Figma, contas pessoais => delegate_task agente "assistente" (com display "blocks" quando o usuário quer VER algo, ex.: e-mails, agenda, lista de issues).
- Claude Design: designs, decks/slides, protótipos, telas, identidade visual => delegate_task agente "designer" (se não existir, crie com create_agent).
- Código: backend (APIs, banco, bugs de servidor), frontend (telas, componentes, sites), qa (testes), security (segurança), devops (deploy, Docker, logs, incidentes).
- Pesquisa web, leads, concorrência => research. Textos, legendas, roteiros => copy. Relatórios => report.
- Nenhum agente serve => create_agent com um especialista e depois delegue a ele.
- Trabalho de 2+ especialidades ou entregável grande => plan_mission (não faça vários delegate_task soltos). Criar site, landing page, app ou sistema novo => SEMPRE plan_mission.
- "Abre/mostra o projeto X" => show_view project com project X (isso já troca o projeto ativo; switch_project sozinho não abre nada).`;

const S = (props: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties: props,
  required,
  additionalProperties: false,
});

const viewEnum = { type: 'string', enum: VIEW_NAMES };
const nullableStr = (description: string) => ({ type: ['string', 'null'], description });

const TOOLS: OpenAI.Responses.FunctionTool[] = [
  { type: 'function', name: 'show_view', strict: true, description: 'Abre uma visualização no Canvas ao lado da Yui.', parameters: S({ view: viewEnum, project: nullableStr('slug ou nome do projeto, quando a view precisar'), run_id: nullableStr('id da execução para destacar') }, ['view', 'project', 'run_id']) },
  { type: 'function', name: 'suggest_view', strict: true, description: 'Deixa uma visualização sugerida ("Quer ver?") sem abrir agora.', parameters: S({ view: viewEnum, project: nullableStr('slug do projeto') }, ['view', 'project']) },
  { type: 'function', name: 'close_canvas', strict: true, description: 'Fecha o Canvas e volta a Yui ao centro.', parameters: S({}, []) },
  { type: 'function', name: 'set_focus', strict: true, description: 'Liga/desliga tela cheia do Canvas.', parameters: S({ on: { type: 'boolean' } }, ['on']) },
  { type: 'function', name: 'switch_project', strict: true, description: 'Troca o projeto ativo.', parameters: S({ project: { type: 'string' } }, ['project']) },
  { type: 'function', name: 'get_overview', strict: true, description: 'KPIs gerais: agentes, execuções, sucesso, saúde de cada projeto.', parameters: S({}, []) },
  { type: 'function', name: 'get_project', strict: true, description: 'Detalhe de um projeto: saúde, problema atual, atividade recente.', parameters: S({ project: { type: 'string' } }, ['project']) },
  { type: 'function', name: 'get_runs', strict: true, description: 'Execuções ativas e recentes dos agentes com resultados.', parameters: S({}, []) },
  { type: 'function', name: 'get_logs', strict: true, description: 'Logs recentes do container do projeto (erros e avisos).', parameters: S({ project: { type: 'string' } }, ['project']) },
  { type: 'function', name: 'get_infra', strict: true, description: 'CPU, RAM, disco e containers da VPS.', parameters: S({}, []) },
  { type: 'function', name: 'list_agents', strict: true, description: 'Agentes disponíveis, especialidade e status.', parameters: S({}, []) },
  {
    type: 'function', name: 'delegate_task', strict: true,
    description: 'Acorda um agente Claude Code para executar um trabalho real (código, pesquisa, relatório, site).',
    parameters: S({
      agent: { type: 'string', description: 'id ou nome do agente (ver list_agents)' },
      project: nullableStr('slug do projeto onde trabalhar; null para tarefas sem projeto'),
      instruction: { type: 'string', description: 'instrução completa e autossuficiente em português' },
      use_selected_element: { type: 'boolean', description: 'true se o pedido se refere ao elemento selecionado no preview' },
      display: { type: 'string', enum: ['blocks', 'html', 'none'], description: 'blocks = o agente devolve uma tela de dados que abre sozinha (e-mails, agenda, leads, listas); html = página visual sob medida; none = só resposta falada' },
    }, ['agent', 'project', 'instruction', 'use_selected_element', 'display']),
  },
  {
    type: 'function', name: 'create_routine', strict: true, description: `Agenda trabalho recorrente de um agente (cron, fuso ${config.timezone}).`,
    parameters: S({ name: { type: 'string' }, cron: { type: 'string', description: 'expressão cron de 5 campos' }, agent: { type: 'string' }, project: nullableStr('slug'), instruction: { type: 'string' } }, ['name', 'cron', 'agent', 'project', 'instruction']),
  },
  { type: 'function', name: 'list_repos', strict: true, description: 'Busca nos repositórios GitHub do usuário (catálogo completo, clonados ou não).', parameters: S({ query: nullableStr('trecho do nome/descrição; null lista os mais recentes') }, ['query']) },
  { type: 'function', name: 'open_approval', strict: true, description: 'Mostra ao usuário o modal da aprovação pendente mais antiga.', parameters: S({}, []) },
  {
    type: 'function', name: 'create_agent', strict: true,
    description: 'Cria um novo agente especialista (quando nenhum existente serve). Fica disponível na hora.',
    parameters: S({
      name: { type: 'string', description: 'nome curto, ex.: SEO' },
      description: { type: 'string', description: 'uma linha: o que faz e quais ferramentas usa' },
      group: { type: 'string', description: 'Engineering | Operações | Growth | Design' },
      prompt: { type: 'string', description: 'instruções do agente em português (papel, como trabalhar, entregáveis)' },
    }, ['name', 'description', 'group', 'prompt']),
  },
];

// Conectores MCP vistos no último run (gravado por runs.ts no init do SDK).
function connectors(): string {
  try {
    const caps = JSON.parse(kvGet('claude_capabilities') ?? '{}') as { mcp?: { name: string; status: string }[] };
    const ok = (caps.mcp ?? []).filter((m) => !['needs-auth', 'failed', 'disabled'].includes(m.status)).map((m) => m.name.replace(/^claude\.ai /, ''));
    return ok.length ? ok.join(', ') : 'Google Calendar, Gmail, Google Drive, Linear, Vercel, Supabase, Figma (via login claude.ai)';
  } catch {
    return 'desconhecidos';
  }
}

function snapshot(): string {
  const extra = brainExtensions().map((e) => e.snapshot?.()).filter(Boolean);
  const ap = activeProject();
  const runs = listRuns(12);
  const lines = [
    `Projeto ativo: ${ap ?? 'nenhum'}.`,
    `Tela atual: ${uiContext.mode === 'center' ? 'Yui ao centro, sem Canvas' : `Canvas com view "${uiContext.view}"${uiContext.params?.project ? ` do projeto ${uiContext.params.project}` : ''}${uiContext.mode === 'focus' ? ' em tela cheia' : ''}`}.`,
    uiContext.selectedElement ? `Elemento selecionado no preview: ${uiContext.selectedElement}.` : '',
    `Projetos no workspace: ${listProjectConfigs().filter((p) => p.cloned).map((p) => `${p.name} (${p.slug})`).join(', ') || 'nenhum'}.`,
    `Outros repositórios no GitHub (clonam sob demanda): ${listProjectConfigs().filter((p) => !p.cloned).map((p) => p.slug).join(', ') || 'nenhum'}.`,
    `Agentes: ${loadAgents().map((a) => `${a.name} [${a.id}] — ${a.description}`).join('; ')}.`,
    `Execuções: ${runs.filter((r) => ['running', 'queued', 'waiting_approval'].includes(r.state)).map((r) => `${r.agent}: ${r.task} (${r.state}, ${r.progress}%)`).join('; ') || 'nenhuma ativa'}.`,
    `Conectores dos agentes: ${connectors()}.`,
    `Navegador dos agentes: Playwright (Chromium na VPS) e Chrome real do usuário quando conectado.`,
    `Aprovações pendentes: ${pendingApprovals().length}.`,
  ];
  return [...lines, ...extra].filter(Boolean).join('\n');
}

async function runTool(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<unknown> {
  if (ctx.dryRun) {
    ctx.calls?.push({ name, args });
    return dryResult(name);
  }
  const proj = (k = 'project') => (typeof args[k] === 'string' && args[k] ? findProject(args[k] as string) : undefined);
  switch (name) {
    case 'show_view': {
      const view = args.view as ViewName;
      const p = proj() ?? (['project', 'logs', 'website'].includes(view) ? findProject(activeProject()) : undefined);
      if (['project', 'logs', 'website'].includes(view) && !p) return { ok: false, error: 'essa view precisa de um projeto existente' };
      if (p) setActiveProject(p.slug);
      emit({ type: 'ui.action', action: { type: 'show_view', view, params: { project: p?.slug, runId: (args.run_id as string) || undefined } } });
      setYuiState('showing');
      return { ok: true };
    }
    case 'suggest_view': {
      const p = proj();
      emit({ type: 'ui.action', action: { type: 'suggest_view', view: args.view as ViewName, params: { project: p?.slug } } });
      return { ok: true };
    }
    case 'close_canvas':
      emit({ type: 'ui.action', action: { type: 'close_canvas' } });
      return { ok: true };
    case 'set_focus':
      emit({ type: 'ui.action', action: { type: 'set_focus', on: !!args.on } });
      return { ok: true };
    case 'switch_project': {
      const p = proj();
      if (!p) return { ok: false, error: 'projeto não encontrado', projetos: listProjectConfigs().map((x) => x.name) };
      setActiveProject(p.slug);
      emit({ type: 'ui.action', action: { type: 'switch_project', project: p.slug, name: p.name } });
      return { ok: true, project: p.name };
    }
    case 'get_overview':
      return overview();
    case 'get_project': {
      const p = proj();
      if (!p) return { error: 'projeto não encontrado' };
      const d = await projectDetail(p);
      const runs = listRuns(40).filter((r) => r.project === p.slug).slice(0, 5).map((r) => ({ agente: r.agent, tarefa: r.task, estado: r.state, resultado: r.result }));
      return { ...d, execucoes: runs };
    }
    case 'get_runs':
      return listRuns(15).map((r) => ({ id: r.id, agente: r.agent, projeto: r.project, tarefa: r.task, estado: r.state, progresso: r.progress, operacao: r.currentOp, resultado: r.result }));
    case 'get_logs': {
      const p = proj();
      if (!p) return { error: 'projeto não encontrado' };
      const l = await projectLogs(p).catch((e) => ({ summary: `erro lendo logs: ${e.message}`, lines: [] as { level: string; msg: string; t: string }[] }));
      return { resumo: l.summary, linhas: l.lines.filter((x) => x.level !== 'INFO' && x.level !== 'DEBUG').slice(-30).concat(l.lines.slice(-8)) };
    }
    case 'get_infra':
      return infra();
    case 'list_agents':
      return agentInfos().map((a) => ({ ...a, descricao: loadAgents().find((d) => d.id === a.id)?.description }));
    case 'delegate_task': {
      const project = (args.project as string | null) ?? null;
      const run = enqueueRun({
        agentId: String(args.agent),
        project,
        instruction: String(args.instruction),
        selectedElement: args.use_selected_element ? uiContext.selectedElement ?? null : null,
        display: args.display === 'blocks' || args.display === 'html' ? args.display : null,
      });
      setYuiState('delegating');
      return { ok: true, run_id: run.id, agente: run.agent, estado: run.state };
    }
    case 'create_routine': {
      const r = createRoutine({ name: String(args.name), cron: String(args.cron), agentId: String(args.agent), project: (args.project as string | null) ?? null, instruction: String(args.instruction) });
      return { ok: true, id: r.id };
    }
    case 'list_repos': {
      const q = String(args.query ?? '').toLowerCase();
      return listProjectConfigs()
        .filter((p) => p.repo && (!q || `${p.repo} ${p.description ?? ''}`.toLowerCase().includes(q)))
        .slice(0, 25)
        .map((p) => ({ slug: p.slug, repo: p.repo, descricao: p.description, ultimo_push: p.pushedAt, clonado: p.cloned }));
    }
    case 'create_agent': {
      const slug = String(args.name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agente';
      const file = join(agentsDir(), `${slug}.md`);
      if (existsSync(file)) return { ok: true, id: slug, nota: 'já existia' };
      const def = parseAgent(slug, `---\nname: x\n---\n`);
      writeFileSync(file, serializeAgent({ ...def, name: String(args.name), description: String(args.description), group: String(args.group || 'Geral'), prompt: String(args.prompt) }));
      invalidateAgents();
      return { ok: true, id: slug };
    }
    case 'open_approval': {
      const a = pendingApprovals()[0];
      if (!a) return { ok: false, error: 'nenhuma aprovação pendente' };
      emit({ type: 'ui.action', action: { type: 'open_approval', approvalId: a.id } });
      return { ok: true, titulo: a.title };
    }
    default: {
      for (const ext of brainExtensions()) {
        const r = ext.run(name, args, ctx);
        if (r !== undefined) return r;
      }
      return { error: `ferramenta desconhecida ${name}` };
    }
  }
}

export interface ThinkInput {
  request: string; // fala/texto do usuário (ou transcrição recente)
  source: 'text' | 'voice';
  dryRun?: boolean; // avaliação: tools só são registradas (scripts/eval-brain.ts)
  calls?: { name: string; args: Record<string, unknown> }[];
}

// Respostas plausíveis para o modo de avaliação (não toca em nada real).
function dryResult(name: string): unknown {
  if (name.startsWith('get_') || name.startsWith('list_')) return { ok: true, nota: 'dados de exemplo (avaliação)', itens: [] };
  return { ok: true };
}

const allTools = () => [...TOOLS, ...brainExtensions().flatMap((e) => e.tools)];
const allInstructions = () => [instructionsText(), ...brainExtensions().map((e) => e.instructions).filter(Boolean)].join('\n');

// Retorna a frase final da Yui. Efeitos de UI já foram emitidos durante o loop.
export async function think({ request, dryRun = false, calls }: ThinkInput): Promise<string> {
  const ctx: ToolCtx & { calls?: ThinkInput['calls'] } = { dryRun, calls };
  if (!config.openaiKey) return 'Ainda não tenho a chave da OpenAI configurada no servidor.';
  if (!dryRun) setYuiState('thinking');
  const history = recentMessages(20)
    .map((m) => `${m.who === 'user' ? 'Usuário' : 'Yui'}: ${m.text}`)
    .join('\n');
  let input: OpenAI.Responses.ResponseInput = [
    { role: 'developer', content: `Contexto do console:\n${snapshot()}\n\nConversa recente:\n${history || '(início)'}` },
    { role: 'user', content: request },
  ];
  let previous: string | undefined;
  for (let step = 0; step < 8; step++) {
    const res = await openai.responses.create({
      model: config.brainModel,
      instructions: allInstructions(),
      input,
      tools: allTools(),
      previous_response_id: previous,
      parallel_tool_calls: true,
    });
    trackOpenAI('cerebro', res.model, res.usage);
    previous = res.id;
    const calls = res.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === 'function_call');
    if (!calls.length) return res.output_text.trim() || 'Pronto.';
    const outputs: OpenAI.Responses.ResponseInput = [];
    for (const c of calls) {
      let out: unknown;
      try {
        out = await runTool(c.name, JSON.parse(c.arguments || '{}'), ctx);
      } catch (e) {
        out = { error: (e as Error).message };
      }
      outputs.push({ type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(out).slice(0, 12000) });
    }
    input = outputs;
  }
  return 'Fiz o que consegui por agora.';
}

export { inboxItems };
