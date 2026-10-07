// Bateria de avaliação do cérebro da Yui: pedidos reais em pt-BR → tool(s) esperada(s).
// Roda think({dryRun:true}) — nenhuma tool executa de verdade. Use com ATRIA_DATA_DIR/ATRIA_WORKSPACE_DIR isolados.
//   cd server && ATRIA_DATA_DIR=/tmp/x ATRIA_WORKSPACE_DIR=/tmp/ws OPENAI_API_KEY=... npx tsx scripts/eval-brain.ts [filtro]
import { think } from '../src/brain.ts';
import * as missions from '../src/missions.ts';
import * as customViews from '../src/customViews.ts';
import * as toolbox from '../src/toolbox.ts';
import * as agentsAdmin from '../src/agentsAdmin.ts';
import * as workflows from '../src/workflows.ts';
import '../src/ambiente.ts';
import '../src/lembretes.ts';

// Módulos registram tools do cérebro em register(app); aqui um app falso só para isso (rotas ignoradas).
const noop = () => fakeApp;
const fakeApp = new Proxy({}, { get: () => noop }) as never;
for (const m of [missions, customViews, toolbox, agentsAdmin, workflows]) {
  try {
    m.register(fakeApp);
  } catch (e) {
    console.error('register falhou', (e as Error).message);
  }
}

interface Case {
  q: string;
  // passa se QUALQUER tool chamada estiver em `any`; `args` checa um valor (substring, sem caixa) em algum argumento
  any: string[];
  args?: Record<string, string>;
  pending?: string; // depende de outra frente
  say?: RegExp; // resposta direta: o texto precisa bater
}

const show = (view: string) => ({ any: ['show_view'], args: { view } });

const CASES: Case[] = [
  // telas
  { q: 'abre o terminal', ...show('terminal') },
  { q: 'Yui, abre o Terminal', ...show('terminal') },
  { q: 'Quero que abra o terminal para mim', ...show('terminal') },
  { q: 'me mostra meus agentes', ...show('agents') },
  { q: 'Me mostra meus agentes agora', ...show('agents') },
  { q: 'mostra o que está acontecendo agora', ...show('runs') },
  { q: 'abre o dashboard', ...show('dashboard') },
  { q: 'como está minha VPS?', any: ['get_infra', 'show_view', 'suggest_view'] },
  { q: 'me mostra a infraestrutura', ...show('infra') },
  { q: 'abre o projeto stoqmate', any: ['show_view'], args: { project: 'stoqmate' } },
  { q: 'mostra os logs do companyos', any: ['show_view', 'get_logs'], args: { project: 'companyos' } },
  { q: 'consegue mostrar meu site pessoal', any: ['show_view', 'list_repos', 'delegate_task', 'plan_mission'] },
  { q: 'me mostra o relatório', ...show('report') },
  { q: 'abre o resumo da noite', ...show('brief') },
  { q: 'volta', any: ['close_canvas'] },
  { q: 'fecha isso', any: ['close_canvas'] },
  { q: 'tela cheia', any: ['set_focus'] },
  { q: 'abre a lista de ferramentas e conectores', any: ['show_view', 'open_tools'] },
  { q: 'mostra meus workflows', ...show('workflows') },
  { q: 'abre o mapa do claude code', ...show('claude') },
  { q: 'mostra as rotinas agendadas', ...show('routines') },
  // status
  { q: 'como estão meus projetos?', any: ['get_overview'] },
  { q: 'que está agendado agora', any: ['show_view', 'delegate_task', 'get_runs', 'list_routines'] },
  { q: 'o que os agentes estão fazendo?', any: ['get_runs', 'show_view'] },
  { q: 'o que o agente de QA fez?', any: ['get_runs', 'get_run_result'] },
  { q: 'tem alguma aprovação pendente?', any: ['open_approval', 'get_runs'] },
  { q: 'o stoqmate está saudável?', any: ['get_project'] },
  // projeto
  { q: 'agora vamos trabalhar no jonyxmidia', any: ['switch_project'] },
  { q: 'muda pro projeto stocksync', any: ['switch_project'] },
  { q: 'você consegue acessar meus projetos no github?', any: ['list_repos'] },
  { q: 'tem algum repositório de crm?', any: ['list_repos'] },
  // contas pessoais (Assistente)
  { q: 'Cria pra mim na minha agenda um horário de uma hora amanhã às 19 horas chamado Reunião Yui', any: ['delegate_task'], args: { agent: 'assistente' } },
  { q: 'qual minha agenda de amanhã?', any: ['delegate_task'], args: { agent: 'assistente' } },
  { q: 'mostra meus e-mails não lidos de hoje', any: ['delegate_task'], args: { agent: 'assistente' } },
  { q: 'responde o último e-mail do cliente dizendo que amanhã envio o orçamento', any: ['delegate_task'], args: { agent: 'assistente' } },
  { q: 'quais issues do Linear estão abertas pra mim?', any: ['delegate_task'], args: { agent: 'assistente' } },
  { q: 'como está o último deploy na Vercel?', any: ['delegate_task'] },
  { q: 'procura no meu Drive a proposta da Fisioforma', any: ['delegate_task'], args: { agent: 'assistente' } },
  // trabalho simples
  { q: 'pede pro backend ler o README do stoqmate e resumir', any: ['delegate_task'], args: { agent: 'backend' } },
  { q: 'corrige os erros dos logs do companyos', any: ['delegate_task', 'plan_mission'] },
  { q: 'faz uma revisão de segurança no stoqmate', any: ['delegate_task'], args: { agent: 'security' } },
  { q: 'roda os testes do stocksync', any: ['delegate_task'], args: { agent: 'qa' } },
  { q: 'pesquisa 10 clínicas odontológicas em São Paulo sem site', any: ['delegate_task', 'plan_mission'], args: { agent: 'research' } },
  { q: 'escreve uma legenda para um post sobre IA para pequenas empresas', any: ['delegate_task'], args: { agent: 'copy' } },
  { q: 'prepara meu relatório da semana', any: ['delegate_task'], args: { agent: 'report' } },
  { q: 'abre meu portfólio no navegador e tira um print', any: ['delegate_task'] },
  // missões
  { q: 'cria uma landing page pra uma clínica odontológica no teste-yui', any: ['plan_mission'] },
  { q: 'quero um site completo para uma pizzaria, com pesquisa, textos e testes', any: ['plan_mission'] },
  { q: 'faz uma auditoria completa do stoqmate: segurança, testes e performance', any: ['plan_mission'] },
  { q: 'pausa a missão', any: ['mission_control', 'get_mission'] },
  // telas sob medida
  { q: 'faz um gráfico das execuções por agente', any: ['show_custom'] },
  { q: 'monta uma tabela com meus projetos e a saúde de cada um', any: ['show_custom'] },
  { q: 'me mostra num gráfico as execuções das últimas 24 horas', any: ['show_custom', 'show_view'] },
  // design
  { q: 'faz um deck no Claude Design sobre o Stoqmate', any: ['delegate_task', 'plan_mission'], args: { agent: 'designer' } },
  { q: 'cria um protótipo da tela de login do stocksync no Claude Design', any: ['delegate_task'], args: { agent: 'designer' } },
  // rotinas / workflows
  { q: 'todo dia às 8h verifica se meus sites estão no ar', any: ['create_routine', 'create_workflow'] },
  { q: 'cria um workflow de post pro instagram toda segunda 9h', any: ['create_workflow'], pending: 'frente C' },
  { q: 'roda o workflow de post do instagram agora', any: ['run_workflow'], pending: 'frente C' },
  // agentes
  { q: 'cria um agente especialista em SEO', any: ['create_agent'] },
  // small talk
  { q: 'oi Yui, tudo bem?', any: [] },
  { q: 'obrigado', any: [] },
  // agora / dia a dia (resposta direta pelo bloco "Agora")
  { q: 'que horas são?', any: [], say: /\d{1,2}(:\d{2}| ?h)/ },
  { q: 'que dia é hoje?', any: [], say: /(segunda|terça|quarta|quinta|sexta|sábado|domingo)/i },
  { q: 'é de manhã ou de tarde agora?', any: [], say: /(manhã|tarde|noite|madrugada)/i },
  { q: 'quando é o próximo feriado?', any: ['ambiente_feriados'] },
  { q: 'vai chover essa semana em Goiânia?', any: ['ambiente_clima'] },
  { q: 'que horas são em Tóquio?', any: ['ambiente_hora'] },
  { q: 'quanto tá o dólar hoje?', any: ['ambiente_cotacoes'] },
  { q: 'me lembra daqui 10 minutos de tirar o café', any: ['lembrete_criar'] },
  { q: 'me avisa amanhã às 9h de ligar pro contador', any: ['lembrete_criar'] },
  { q: 'quais lembretes eu tenho?', any: ['lembrete_listar'] },
];

function pass(c: Case, calls: { name: string; args: Record<string, unknown> }[], text = ''): boolean {
  if (c.say && !c.say.test(text)) return false;
  if (!c.any.length) return calls.filter((x) => !x.name.startsWith('get_') && !x.name.startsWith('list_')).length === 0;
  const hits = calls.filter((x) => c.any.includes(x.name));
  if (!hits.length) return false;
  if (!c.args) return true;
  return hits.some((h) =>
    Object.entries(c.args!).every(([k, v]) => String(h.args[k] ?? '').toLowerCase().includes(v.toLowerCase())),
  );
}

const filter = process.argv[2]?.toLowerCase();
const cases = CASES.filter((c) => !filter || c.q.toLowerCase().includes(filter));
let ok = 0;
let counted = 0;
const fails: string[] = [];
const conc = Number(process.env.EVAL_CONC ?? 3);
const results: { c: Case; calls: { name: string; args: Record<string, unknown> }[]; text: string; good: boolean }[] = [];
for (let i = 0; i < cases.length; i += conc) {
  const batch = cases.slice(i, i + conc);
  const out = await Promise.all(
    batch.map(async (c) => {
      const calls: { name: string; args: Record<string, unknown> }[] = [];
      let text = '';
      try {
        text = await think({ request: c.q, source: 'text', dryRun: true, calls });
      } catch (e) {
        text = `ERRO ${(e as Error).message}`;
      }
      return { c, calls, text, good: pass(c, calls, text) };
    }),
  );
  results.push(...out);
}
for (const r of results) {
  const tools = r.calls.map((x) => `${x.name}(${Object.entries(x.args).filter(([, v]) => v !== null && v !== '' && typeof v !== 'boolean').map(([k, v]) => `${k}=${String(v).slice(0, 24)}`).join(',')})`).join(' ');
  const mark = r.c.pending ? (r.good ? 'OK ' : 'PEN') : r.good ? 'OK ' : 'XX ';
  console.log(`${mark} ${r.c.q.slice(0, 60).padEnd(60)} → ${tools || '(nenhuma)'}${r.good ? '' : `   [esperado: ${r.c.any.join('|') || 'nenhuma'}${r.c.args ? ' ' + JSON.stringify(r.c.args) : ''}] «${r.text.slice(0, 160)}»`}`);
  if (!r.c.pending) {
    counted++;
    if (r.good) ok++;
    else fails.push(r.c.q);
  }
}
console.log(`\nAcerto: ${ok}/${counted} = ${Math.round((ok / Math.max(1, counted)) * 100)}% (pendentes de outras frentes não contam)`);
process.exit(0);
