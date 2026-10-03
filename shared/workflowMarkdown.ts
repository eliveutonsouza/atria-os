import type { WorkflowDef, WorkflowNode, WorkflowNodeType } from './protocol.ts';

// Formato canônico de workflow em markdown (copiável/colável, legível por agentes):
//
// ---
// nome: Post Instagram
// descricao: Cria e publica um post
// gatilho: cron 0 9 * * 1      (ou: manual)
// projeto: eliveuton-instagram (opcional)
// time: [Research, Copy, Designer]
// ---
//
// ## 1. Pesquisar tendências
// - tipo: tarefa
// - agente: research
// - instrução: Pesquise ...
// - saída: tendencias
// - próximo: 2
//
// ## 2. Tem tema forte?
// - tipo: decisão
// - condição: Há pelo menos um tema com potencial alto?
// - se sim → 3
// - se não → 5
//
// O parser é tolerante: sem acentos, maiúsculas, "->" ou "→", listas com ou sem colchetes,
// texto colado de chat (blocos ``` em volta) e campos desconhecidos (ignorados).

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const TYPE_ALIASES: Record<string, WorkflowNodeType> = {
  inicio: 'start', start: 'start', comeco: 'start', gatilho: 'start',
  tarefa: 'task', task: 'task', acao: 'task', etapa: 'task', passo: 'task',
  decisao: 'decision', decision: 'decision', condicao: 'decision', se: 'decision',
  aprovacao: 'approval', approval: 'approval', 'aprovacao humana': 'approval', revisao: 'approval',
  paralelo: 'parallel', parallel: 'parallel', 'em paralelo': 'parallel',
  fim: 'end', end: 'end', final: 'end', encerrar: 'end',
};

const TYPE_LABEL: Record<WorkflowNodeType, string> = {
  start: 'início', task: 'tarefa', decision: 'decisão', approval: 'aprovação', parallel: 'paralelo', end: 'fim',
};

export function slugify(s: string): string {
  return strip(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'workflow';
}

function parseList(v: string): string[] {
  const inner = v.trim().replace(/^\[|\]$/g, '');
  if (!inner.trim()) return [];
  return inner.split(/\s*[,;]\s*|\s+e\s+/).map((x) => x.trim().replace(/^["'`]|["'`]$/g, '')).filter(Boolean);
}

function stepRef(v: string): string {
  // "3", "passo 3", "#3", "3. Publicar" -> "3"
  const m = /(\d+)/.exec(v);
  return m ? m[1] : v.trim();
}

function parseTrigger(v: string): WorkflowDef['trigger'] {
  const t = v.trim().replace(/^["']|["']$/g, '');
  const low = strip(t);
  if (!t || low === 'manual') return { type: 'manual' };
  const cronPart = t.replace(/^cron\s*[:=]?\s*/i, '').trim();
  if (/^([\d*/,-]+\s+){4}[\d*/,-a-zA-Z]+$/.test(cronPart)) return { type: 'cron', cron: cronPart };
  return { type: 'manual' };
}

export function parseWorkflowMarkdown(src: string, fallbackSlug?: string): Omit<WorkflowDef, 'markdown' | 'updatedAt'> {
  let text = src.replace(/\r\n/g, '\n');
  // remove cerca de código de chat (```markdown ... ```)
  const fence = /```(?:markdown|md)?\s*\n([\s\S]*?)\n```/.exec(text);
  if (fence && fence[1].includes('##')) text = fence[1];

  const meta: Record<string, string> = {};
  const fm = /^\s*---\n([\s\S]*?)\n---\s*\n?/.exec(text);
  let body = text;
  if (fm) {
    body = text.slice(fm[0].length);
    for (const line of fm[1].split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) meta[strip(line.slice(0, i))] = line.slice(i + 1).trim();
    }
  }

  // título "# Nome" opcional quando não há frontmatter
  const h1 = /^#\s+(.+)$/m.exec(body);
  const name = (meta.nome || meta.name || meta.titulo || h1?.[1] || fallbackSlug || 'Workflow').trim();

  const nodes: WorkflowNode[] = [];
  const sections = body.split(/^##\s+/m).slice(1);
  for (const sec of sections) {
    const [headLine, ...rest] = sec.split('\n');
    const hm = /^(?:passo\s+)?(\d+)\s*[.)\-:]?\s*(.*)$/i.exec(headLine.trim());
    const id = hm ? hm[1] : String(nodes.length + 1);
    const title = (hm ? hm[2] : headLine).trim() || `Passo ${id}`;
    const node: WorkflowNode = { id, type: 'task', title };
    const branches: { label: string; to: string }[] = [];
    const freeText: string[] = [];
    let typeSet = false;

    for (const raw of rest) {
      const line = raw.replace(/^\s*[-*•]\s*/, '').trim();
      if (!line) continue;
      // ramos: "se sim → 3", "se não -> 5", "sim: 3", "caso contrário → 6"
      const br = /^(?:se\s+|caso\s+)?(.+?)\s*(?:→|->|=>|:)\s*(?:passo\s*|#)?(\d+)\s*$/i.exec(line);
      const kv = /^([^:→]+?)\s*:\s*(.*)$/.exec(line);
      const key = kv ? strip(kv[1]) : '';
      if (kv && ['tipo', 'type'].includes(key)) {
        node.type = TYPE_ALIASES[strip(kv[2])] ?? 'task';
        typeSet = true;
      } else if (kv && ['agente', 'agent', 'responsavel'].includes(key)) node.agent = kv[2].trim();
      else if (kv && ['instrucao', 'instrucoes', 'instruction', 'descricao', 'tarefa'].includes(key)) node.instruction = kv[2].trim();
      else if (kv && ['skills', 'skill'].includes(key)) node.skills = parseList(kv[2]);
      else if (kv && ['mcp', 'mcps', 'conectores', 'ferramentas'].includes(key)) node.mcp = parseList(kv[2]);
      else if (kv && ['saida', 'output', 'resultado'].includes(key)) node.output = kv[2].trim();
      else if (kv && ['condicao', 'condition', 'pergunta'].includes(key)) {
        node.condition = kv[2].trim();
        if (!typeSet) node.type = 'decision';
      } else if (kv && ['proximo', 'proximos', 'next', 'depois', 'segue'].includes(key)) node.next = parseList(kv[2]).map(stepRef);
      else if (kv && ['posicao', 'position', 'pos'].includes(key)) {
        const [x, y] = kv[2].split(/[,;\s]+/).map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) node.position = { x, y };
      } else if (br && /^(sim|nao|não|yes|no|caso|senao|senão|outro|contrario|contrário|.{1,40})$/i.test(br[1].trim()) && /→|->|=>/.test(line)) {
        branches.push({ label: br[1].replace(/^se\s+/i, '').trim(), to: br[2] });
      } else if (!kv && !/^>/.test(line)) freeText.push(line);
    }
    if (branches.length) {
      node.branches = branches;
      if (!typeSet) node.type = 'decision';
    }
    if (!node.instruction && freeText.length && node.type !== 'decision') node.instruction = freeText.join(' ');
    if (!typeSet && !node.agent && !node.instruction && !branches.length && /^(fim|end|concluir|encerrar)\b/i.test(strip(title))) node.type = 'end';
    if (node.agent) node.agent = node.agent.replace(/\s*agent$/i, '').trim();
    nodes.push(node);
  }

  // Ligações implícitas: passo sem "próximo" segue para o seguinte (exceto decisão/fim).
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === 'end' || n.type === 'decision') continue;
    if (!n.next?.length && nodes[i + 1]) n.next = [nodes[i + 1].id];
  }

  const projeto = (meta.projeto || meta.project || '').trim();
  return {
    slug: slugify(meta.slug || fallbackSlug || name),
    name,
    description: (meta.descricao || meta.description || '').trim(),
    trigger: parseTrigger(meta.gatilho || meta.trigger || 'manual'),
    project: projeto && strip(projeto) !== 'nenhum' ? projeto : null,
    team: (() => {
      const t = parseList(meta.time || meta.team || meta.agentes || '');
      return t.length ? t : [...new Set(nodes.map((n) => n.agent).filter((a): a is string => !!a))];
    })(),
    nodes,
  };
}

export function serializeWorkflow(def: Pick<WorkflowDef, 'name' | 'description' | 'trigger' | 'project' | 'team' | 'nodes'>): string {
  const team = def.team.length ? def.team : [...new Set(def.nodes.map((n) => n.agent).filter((a): a is string => !!a))];
  const out: string[] = [
    '---',
    `nome: ${def.name}`,
    ...(def.description ? [`descricao: ${def.description.replace(/\n+/g, ' ')}`] : []),
    `gatilho: ${def.trigger.type === 'cron' && def.trigger.cron ? `cron ${def.trigger.cron}` : 'manual'}`,
    ...(def.project ? [`projeto: ${def.project}`] : []),
    `time: [${team.join(', ')}]`,
    '---',
    '',
    `# ${def.name}`,
  ];
  for (const n of def.nodes) {
    out.push('', `## ${n.id}. ${n.title}`, `- tipo: ${TYPE_LABEL[n.type]}`);
    if (n.agent) out.push(`- agente: ${n.agent}`);
    if (n.instruction) out.push(`- instrução: ${n.instruction.replace(/\n+/g, ' ')}`);
    if (n.skills?.length) out.push(`- skills: [${n.skills.join(', ')}]`);
    if (n.mcp?.length) out.push(`- mcp: [${n.mcp.join(', ')}]`);
    if (n.output) out.push(`- saída: ${n.output}`);
    if (n.condition) out.push(`- condição: ${n.condition.replace(/\n+/g, ' ')}`);
    for (const b of n.branches ?? []) out.push(`- se ${b.label} → ${b.to}`);
    if (n.type !== 'decision' && n.type !== 'end' && n.next?.length) {
      out.push(n.next.length === 1 ? `- próximo: ${n.next[0]}` : `- próximos: [${n.next.join(', ')}]`);
    }
    if (n.position) out.push(`- posição: ${Math.round(n.position.x)},${Math.round(n.position.y)}`);
  }
  return `${out.join('\n')}\n`;
}

// Erros estruturais que impedem execução (referências quebradas, decisão sem ramos…).
export function validateWorkflow(def: Pick<WorkflowDef, 'nodes'>): string[] {
  const errs: string[] = [];
  const ids = new Set(def.nodes.map((n) => n.id));
  if (!def.nodes.length) errs.push('workflow sem passos');
  if (ids.size !== def.nodes.length) errs.push('números de passo repetidos');
  for (const n of def.nodes) {
    for (const t of [...(n.next ?? []), ...(n.branches ?? []).map((b) => b.to)]) {
      if (!ids.has(t)) errs.push(`passo ${n.id} aponta para ${t}, que não existe`);
    }
    if (n.type === 'task' && !n.agent) errs.push(`passo ${n.id} (tarefa) sem agente`);
    if (n.type === 'task' && !n.instruction) errs.push(`passo ${n.id} (tarefa) sem instrução`);
    if (n.type === 'decision' && (n.branches?.length ?? 0) < 2) errs.push(`passo ${n.id} (decisão) precisa de 2+ ramos`);
  }
  return errs;
}
