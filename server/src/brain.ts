import OpenAI from 'openai';
import type { ChatContext, ViewName } from '../../shared/protocol.ts';
import { VIEW_NAMES } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, now, uid } from './db.ts';
import { emit, setYuiState } from './bus.ts';
import { agentInfos, loadAgents } from './agents.ts';
import { activeProject, findProject, listProjectConfigs, projectDetail, projectLogs, setActiveProject } from './projects.ts';
import { enqueueRun, inboxItems, listRuns, pendingApprovals } from './runs.ts';
import { infra, overview } from './metrics.ts';
import { createRoutine } from './routines.ts';

// "Cérebro" da Yui: modelo de texto (Responses API) com as ferramentas do console.
// Recebe pedidos digitados ou delegações do GPT-Live e devolve uma frase curta para ser dita/mostrada.

export const openai = new OpenAI({ apiKey: config.openaiKey || 'missing', maxRetries: 1 });

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

const INSTRUCTIONS = `Você é o raciocínio por trás da Yui, a assistente do Yui Console — a central pessoal de IA do ${config.userName}.
A Yui conversa (por voz ou texto) e você decide o que fazer usando ferramentas. A força de execução são agentes Claude Code (delegate_task).

Como responder:
- Responda SEMPRE em português do Brasil, 1 ou 2 frases curtas, tom calmo e direto, pronto para ser falado. Sem markdown, listas ou emojis.
- Nunca invente números, status ou resultados: consulte com get_overview, get_project, get_runs, get_logs ou get_infra antes de afirmar.
- Quando o usuário pedir para ver algo ("me mostra", "abre", "quero ver", "mostra os dados", "faz um gráfico") chame show_view com a view certa:
  brief (resumo da noite), dashboard (visão geral), agents, runs (execuções), project (precisa de project), logs (precisa de project), report, website (preview do projeto; precisa de project), infra (VPS/containers), artifact.
- Quando você responder um status sem o usuário pedir para ver, chame suggest_view com a view relacionada e termine com uma pergunta curta tipo "Quer ver?".
- "Volta", "fecha", "sair" => close_canvas. "Tela cheia" => set_focus(true).
- Pedidos de trabalho (corrigir, criar, pesquisar, revisar, gerar relatório, criar site) => delegate_task com o agente mais adequado e uma instrução completa e autossuficiente (o agente não vê esta conversa). Diga em uma frase quem você acordou e o que vai fazer.
- Para trabalhos que o usuário quer recorrentes ("todo dia às 8h…") use create_routine.
- Os projetos do usuário são os repositórios dele no GitHub (catálogo automático). Nunca peça para cadastrar projeto: se não reconhecer o nome, use list_repos. Projetos ainda não clonados são clonados sozinhos ao abrir ou delegar.
- Se o usuário mudar de projeto ("agora no Stoqmate"), use switch_project.
- Aprovações são sempre decididas pelo usuário no modal; use open_approval para mostrá-lo, nunca aprove sozinha.
- Se a fala parecer transcrição truncada ou ambígua, pergunte só o detalhe que falta.`;

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
    }, ['agent', 'project', 'instruction', 'use_selected_element']),
  },
  {
    type: 'function', name: 'create_routine', strict: true, description: 'Agenda trabalho recorrente de um agente (cron, fuso America/Sao_Paulo).',
    parameters: S({ name: { type: 'string' }, cron: { type: 'string', description: 'expressão cron de 5 campos' }, agent: { type: 'string' }, project: nullableStr('slug'), instruction: { type: 'string' } }, ['name', 'cron', 'agent', 'project', 'instruction']),
  },
  { type: 'function', name: 'list_repos', strict: true, description: 'Busca nos repositórios GitHub do usuário (catálogo completo, clonados ou não).', parameters: S({ query: nullableStr('trecho do nome/descrição; null lista os mais recentes') }, ['query']) },
  { type: 'function', name: 'open_approval', strict: true, description: 'Mostra ao usuário o modal da aprovação pendente mais antiga.', parameters: S({}, []) },
];

function snapshot(): string {
  const ap = activeProject();
  const runs = listRuns(12);
  const lines = [
    `Agora: ${new Date().toLocaleString('pt-BR', { timeZone: config.timezone })}.`,
    `Projeto ativo: ${ap ?? 'nenhum'}.`,
    `Tela atual: ${uiContext.mode === 'center' ? 'Yui ao centro, sem Canvas' : `Canvas com view "${uiContext.view}"${uiContext.params?.project ? ` do projeto ${uiContext.params.project}` : ''}${uiContext.mode === 'focus' ? ' em tela cheia' : ''}`}.`,
    uiContext.selectedElement ? `Elemento selecionado no preview: ${uiContext.selectedElement}.` : '',
    `Projetos no workspace: ${listProjectConfigs().filter((p) => p.cloned).map((p) => `${p.name} (${p.slug})`).join(', ') || 'nenhum'}.`,
    `Outros repositórios no GitHub (clonam sob demanda): ${listProjectConfigs().filter((p) => !p.cloned).map((p) => p.slug).join(', ') || 'nenhum'}.`,
    `Agentes: ${loadAgents().map((a) => `${a.name} [${a.id}] — ${a.description}`).join('; ')}.`,
    `Execuções: ${runs.filter((r) => ['running', 'queued', 'waiting_approval'].includes(r.state)).map((r) => `${r.agent}: ${r.task} (${r.state}, ${r.progress}%)`).join('; ') || 'nenhuma ativa'}.`,
    `Aprovações pendentes: ${pendingApprovals().length}.`,
  ];
  return lines.filter(Boolean).join('\n');
}

async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
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
    case 'open_approval': {
      const a = pendingApprovals()[0];
      if (!a) return { ok: false, error: 'nenhuma aprovação pendente' };
      emit({ type: 'ui.action', action: { type: 'open_approval', approvalId: a.id } });
      return { ok: true, titulo: a.title };
    }
    default:
      return { error: `ferramenta desconhecida ${name}` };
  }
}

export interface ThinkInput {
  request: string; // fala/texto do usuário (ou transcrição recente)
  source: 'text' | 'voice';
}

// Retorna a frase final da Yui. Efeitos de UI já foram emitidos durante o loop.
export async function think({ request }: ThinkInput): Promise<string> {
  if (!config.openaiKey) return 'Ainda não tenho a chave da OpenAI configurada no servidor.';
  setYuiState('thinking');
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
      instructions: INSTRUCTIONS,
      input,
      tools: TOOLS,
      previous_response_id: previous,
      parallel_tool_calls: true,
    });
    previous = res.id;
    const calls = res.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === 'function_call');
    if (!calls.length) return res.output_text.trim() || 'Pronto.';
    const outputs: OpenAI.Responses.ResponseInput = [];
    for (const c of calls) {
      let out: unknown;
      try {
        out = await runTool(c.name, JSON.parse(c.arguments || '{}'));
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
