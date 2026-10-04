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
//
// Desde 2026-10-04 o fluxo (quem vem depois de quem, ramos das decisões) é desenhado num bloco
// ```mermaid logo abaixo do "# Nome"; as seções "## N." guardam os detalhes de cada passo.
// "próximo:" e "se sim → N" continuam aceitos (arquivos antigos), mas o Mermaid vale quando existe.
// Um workflow só em Mermaid (sem seções ##) também é aceito: os passos saem das caixas.

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
  // diagrama primeiro: um ```mermaid dentro de um ```markdown colado do chat quebraria a cerca externa
  let mermaidSrc: string | null = null;
  const mm = /```mermaid[^\n]*\n([\s\S]*?)\n\s*```/i.exec(text);
  if (mm) {
    mermaidSrc = mm[1];
    text = text.slice(0, mm.index) + text.slice(mm.index + mm[0].length);
  } else if (/^\s*(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i.test(text)) {
    mermaidSrc = text;
    text = '';
  }
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

  const inDiagram = mermaidSrc ? applyMermaid(nodes, parseMermaid(mermaidSrc)) : new Set<string>();

  // Ligações implícitas: passo sem "próximo" segue para o seguinte (exceto decisão/fim e passos do diagrama).
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === 'end' || n.type === 'decision' || inDiagram.has(n.id)) continue;
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
    '',
    '```mermaid',
    toMermaid(def),
    '```',
  ];
  for (const n of def.nodes) {
    out.push('', `## ${n.id}. ${n.title}`, `- tipo: ${TYPE_LABEL[n.type]}`);
    if (n.agent) out.push(`- agente: ${n.agent}`);
    if (n.instruction) out.push(`- instrução: ${n.instruction.replace(/\n+/g, ' ')}`);
    if (n.skills?.length) out.push(`- skills: [${n.skills.join(', ')}]`);
    if (n.mcp?.length) out.push(`- mcp: [${n.mcp.join(', ')}]`);
    if (n.output) out.push(`- saída: ${n.output}`);
    if (n.condition) out.push(`- condição: ${n.condition.replace(/\n+/g, ' ')}`);
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

// ---------- Mermaid ----------

const SHAPE: Record<WorkflowNodeType, [string, string]> = {
  start: ['([', '])'],
  task: ['[', ']'],
  decision: ['{', '}'],
  approval: ['{{', '}}'],
  parallel: ['[/', '/]'],
  end: ['((', '))'],
};

const mermaidText = (s: string) => s.replace(/"/g, '#quot;').replace(/[\r\n]+/g, ' ').trim();
const edgeText = (s: string) => s.replace(/["|]/g, '').replace(/[\r\n]+/g, ' ').trim();

export interface MermaidOpts {
  current?: string | null; // passo em execução (destacado)
  status?: Record<string, 'done' | 'skipped' | 'failed'>;
  compact?: boolean; // sem cores (classDef) — para prompts de agentes
}

// Fluxograma do workflow em Mermaid: formas por tipo, agente na caixa das tarefas, rótulos nos ramos.
export function toMermaid(def: Pick<WorkflowDef, 'nodes'>, opts: MermaidOpts = {}): string {
  const id = (x: string) => `n${x.replace(/[^A-Za-z0-9_]/g, '_')}`;
  const ids = new Set(def.nodes.map((n) => n.id));
  const lines = ['flowchart TD'];
  for (const n of def.nodes) {
    const [o, c] = SHAPE[n.type] ?? SHAPE.task;
    const label = `${n.id}. ${mermaidText(n.title)}${n.type === 'task' && n.agent ? `<br/>${mermaidText(n.agent)}` : ''}`;
    lines.push(`  ${id(n.id)}${o}"${label}"${c}`);
  }
  for (const n of def.nodes) {
    if (n.type === 'decision') {
      for (const b of n.branches ?? []) if (ids.has(b.to)) lines.push(`  ${id(n.id)} -->${edgeText(b.label) ? `|${edgeText(b.label)}|` : ''} ${id(b.to)}`);
    } else {
      for (const t of n.next ?? []) if (ids.has(t)) lines.push(`  ${id(n.id)} --> ${id(t)}`);
    }
  }
  if (opts.compact) {
    const st = opts.status ?? {};
    for (const [k, cls] of [['done', 'feito'], ['skipped', 'pulado'], ['failed', 'falhou']] as const) {
      const g = def.nodes.filter((n) => st[n.id] === k).map((n) => id(n.id));
      if (g.length) lines.push(`  class ${g.join(',')} ${cls}`);
    }
    if (opts.current && ids.has(opts.current)) lines.push(`  class ${id(opts.current)} atual`);
    return lines.join('\n');
  }
  lines.push(
    '  classDef t_start fill:#1b2045,stroke:#8c92ad,color:#e8eaf4',
    '  classDef t_task fill:#0f1f33,stroke:#67d8f2,color:#e8eaf4',
    '  classDef t_decision fill:#2a2110,stroke:#f5b54a,color:#ffe7b8',
    '  classDef t_approval fill:#221a3d,stroke:#a68cf7,color:#e6ddff',
    '  classDef t_parallel fill:#1d1b38,stroke:#cbbcff,color:#e8eaf4',
    '  classDef t_end fill:#1b2045,stroke:#8c92ad,color:#e8eaf4',
  );
  const byType = new Map<WorkflowNodeType, string[]>();
  for (const n of def.nodes) byType.set(n.type, [...(byType.get(n.type) ?? []), id(n.id)]);
  for (const [t, list] of byType) lines.push(`  class ${list.join(',')} t_${t}`);
  const st = opts.status ?? {};
  const group = (k: string) => def.nodes.filter((n) => st[n.id] === k).map((n) => id(n.id));
  if (Object.keys(st).length) {
    lines.push('  classDef feito fill:#0f2a22,stroke:#4fe0b0,color:#c8f7e6', '  classDef pulado fill:#11131f,stroke:#4c5270,color:#6f7590', '  classDef falhou fill:#2c1218,stroke:#f06272,color:#ffd0d6');
    for (const [k, cls] of [['done', 'feito'], ['skipped', 'pulado'], ['failed', 'falhou']] as const) {
      const g = group(k);
      if (g.length) lines.push(`  class ${g.join(',')} ${cls}`);
    }
  }
  if (opts.current && ids.has(opts.current)) {
    lines.push('  classDef atual fill:#67d8f2,stroke:#ffffff,stroke-width:3px,color:#06070d', `  class ${id(opts.current)} atual`);
  }
  return lines.join('\n');
}

export interface MermaidGraph {
  nodes: { id: string; type: WorkflowNodeType | null; label: string | null }[];
  edges: { from: string; to: string; label: string | null }[];
}

// [abre, fecha, tipo] — mais longos primeiro para "([" não virar "(".
const OPENERS: [string, string, WorkflowNodeType][] = [
  ['([', '])', 'start'],
  ['((', '))', 'end'],
  ['{{', '}}', 'approval'],
  ['[/', '/]', 'parallel'],
  ['[\\', '\\]', 'parallel'],
  ['[[', ']]', 'task'],
  ['[(', ')]', 'task'],
  ['[', ']', 'task'],
  ['{', '}', 'decision'],
  ['(', ')', 'task'],
  ['>', ']', 'task'],
];

function readNode(s: string, i: number): { id: string; type: WorkflowNodeType | null; label: string | null; end: number } | null {
  while (s[i] === ' ' || s[i] === '\t') i++;
  const m = /^[A-Za-z0-9_][A-Za-z0-9_-]*/.exec(s.slice(i));
  if (!m) return null;
  const id = m[0];
  let j = i + id.length;
  for (const [o, c, type] of OPENERS) {
    if (!s.startsWith(o, j)) continue;
    let k = j + o.length;
    let label: string;
    if (s[k] === '"') {
      const q = s.indexOf('"', k + 1);
      if (q < 0) return null;
      label = s.slice(k + 1, q);
      k = q + 1;
      const close = s.indexOf(c, k);
      if (close < 0) return null;
      return { id, type, label, end: close + c.length };
    }
    const close = s.indexOf(c, k);
    if (close < 0) return null;
    label = s.slice(k, close);
    return { id, type, label, end: close + c.length };
  }
  return { id, type: null, label: null, end: j };
}

const EDGE = /^\s*(?:(?:--|==|-\.)\s*([^-=.|>][^>]*?)\s*(?:-{2,3}>|={2,3}>|\.->)|(?:-{2,3}>|={2,3}>|-\.+->|-{3}|={3}|~~~))\s*(?:\|([^|]*)\|)?/;

// Quebra em comandos por linha e por ";" fora de aspas (o #quot; dos rótulos tem ";").
function statements(src: string): string[] {
  const out: string[] = [];
  for (const line of src.split('\n')) {
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      if (ch === ';' && !quoted && !/#[a-z0-9]+$/i.test(cur)) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
  }
  return out;
}

// Lê o subconjunto de flowchart que o toMermaid escreve e o que uma IA costuma escrever.
export function parseMermaid(src: string): MermaidGraph {
  const nodes = new Map<string, MermaidGraph['nodes'][number]>();
  const edges: MermaidGraph['edges'] = [];
  const note = (n: { id: string; type: WorkflowNodeType | null; label: string | null }) => {
    const cur = nodes.get(n.id);
    if (!cur) nodes.set(n.id, { id: n.id, type: n.type, label: n.label });
    else if (n.label !== null) Object.assign(cur, { type: n.type, label: n.label });
  };
  for (const raw of statements(src)) {
    const line = raw.replace(/%%.*$/, '').trim();
    if (!line || /^(flowchart|graph)\b/i.test(line)) continue;
    if (/^(classDef|class|style|linkStyle|click|subgraph|end|direction)\b/.test(line) && !/-->|---|==>|-\.->/.test(line)) continue;
    let pos = 0;
    let prev = readNode(line, pos);
    if (!prev) continue;
    note(prev);
    pos = prev.end;
    for (;;) {
      const e = EDGE.exec(line.slice(pos));
      if (!e) break;
      pos += e[0].length;
      const nxt = readNode(line, pos);
      if (!nxt) break;
      note(nxt);
      const label = (e[2] ?? e[1] ?? '').replace(/^["']|["']$/g, '').trim();
      edges.push({ from: prev.id, to: nxt.id, label: label || null });
      pos = nxt.end;
      prev = nxt;
    }
  }
  return { nodes: [...nodes.values()], edges };
}

// Aplica o diagrama aos passos: cria passos que só existem no desenho e define next/branches.
// Devolve os ids dos passos que aparecem no diagrama (não recebem ligação implícita).
function applyMermaid(nodes: WorkflowNode[], g: MermaidGraph): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let maxId = Math.max(0, ...nodes.map((n) => Number(n.id)).filter(Number.isFinite));
  const map = new Map<string, string>();
  const parts = (label: string | null) => (label ?? '').split(/<br\s*\/?>|\\n|\n/i).map((x) => x.replace(/#quot;/g, '"').trim());
  for (const mn of g.nodes) {
    const [first] = parts(mn.label);
    const num = /^(\d+)\s*[.)\-:]\s*/.exec(first ?? '')?.[1] ?? /^n?(\d+)$/.exec(mn.id)?.[1];
    map.set(mn.id, num ?? String(++maxId));
  }
  for (const mn of g.nodes) {
    const id = map.get(mn.id)!;
    const [first, second] = parts(mn.label);
    const title = (first ?? '').replace(/^\d+\s*[.)\-:]\s*/, '').trim() || mn.id;
    let n = byId.get(id);
    if (!n) {
      n = { id, type: mn.type ?? 'task', title };
      if (n.type === 'task' && second) n.agent = second;
      if (n.type === 'decision') n.condition = title;
      nodes.push(n);
      byId.set(id, n);
    }
  }
  const touched = new Set(g.nodes.map((mn) => map.get(mn.id)!));
  const sources = new Set(g.edges.map((e) => map.get(e.from)!));
  for (const id of sources) {
    const n = byId.get(id)!;
    delete n.next;
    delete n.branches;
  }
  for (const e of g.edges) {
    const from = byId.get(map.get(e.from)!)!;
    const to = map.get(e.to)!;
    if (from.type === 'decision') (from.branches ??= []).push({ label: e.label ?? 'senão', to });
    else if (!(from.next ??= []).includes(to)) from.next.push(to);
  }
  nodes.sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id));
  return touched;
}
