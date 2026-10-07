import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseMermaid, parseWorkflowMarkdown, serializeWorkflow, toMermaid, validateWorkflow } from '../../shared/workflowMarkdown.ts';

const SEED = new URL('../../workspace-seed/.atria/workflows/', import.meta.url);
const graph = (d: ReturnType<typeof parseWorkflowMarkdown>) =>
  d.nodes.map((n) => `${n.id}:${n.type}:${n.agent ?? ''}>${(n.next ?? []).join(',')}|${(n.branches ?? []).map((b) => `${b.label}=${b.to}`).join(',')}`).join(' ');

for (const f of readdirSync(SEED).filter((x) => x.endsWith('.md'))) {
  test(`ida e volta com Mermaid: ${f}`, () => {
    const old = parseWorkflowMarkdown(readFileSync(new URL(f, SEED), 'utf8'), f.replace(/\.md$/, ''));
    const md = serializeWorkflow(old);
    assert.match(md, /```mermaid\nflowchart TD\n/);
    assert.doesNotMatch(md, /próximo:|se sim →/);
    const back = parseWorkflowMarkdown(md, old.slug);
    assert.equal(graph(back), graph(old));
    assert.deepEqual(back.nodes.map((n) => n.instruction), old.nodes.map((n) => n.instruction));
    assert.equal(serializeWorkflow(back), md, 'serialização estável');
    assert.deepEqual(validateWorkflow(back), []);
  });
}

test('Mermaid escrito à mão: graph LR, |rótulo|, -- rótulo -->, cadeia, classDef e comentários', () => {
  const g = parseMermaid(`graph LR
  %% comentário
  A["1. Pesquisar<br/>research"] --> B["2. Escrever<br/>copy"] --> C{"3. Ficou bom?"}
  C -->|sim| D{{"4. Aprovar"}}
  C -- não --> B
  D --> E((5. Fim))
  classDef x fill:#000
  class A x`);
  assert.deepEqual(g.nodes.map((n) => `${n.id}:${n.type}`), ['A:task', 'B:task', 'C:decision', 'D:approval', 'E:end']);
  assert.deepEqual(g.edges.map((e) => `${e.from}>${e.to}:${e.label ?? ''}`), ['A>B:', 'B>C:', 'C>D:sim', 'C>B:não', 'D>E:']);
});

test('workflow só em Mermaid cria passos e a validação diz o que falta', () => {
  const d = parseWorkflowMarkdown('```mermaid\nflowchart TD\n  n1["1. Buscar leads<br/>research"] --> n2{"2. Tem lead?"}\n  n2 -->|sim| n3["3. Cadastrar"]\n  n2 -->|não| n4(("4. Fim"))\n  n3 --> n4\n```', 'so-mermaid');
  assert.equal(graph(d), '1:task:research>2| 2:decision:>|sim=3,não=4 3:task:>4| 4:end:>|');
  const errs = validateWorkflow(d);
  assert.ok(errs.some((e) => /passo 1 .*sem instrução/.test(e)));
  assert.ok(errs.some((e) => /passo 3 .*sem agente/.test(e)));
});

test('Mermaid vale sobre "próximo:" e cerca ```markdown com ```mermaid dentro funciona', () => {
  const src = '```markdown\n---\nnome: X\n---\n# X\n\n```mermaid\nflowchart TD\n  n1 --> n3\n```\n\n## 1. A\n- tipo: tarefa\n- agente: qa\n- instrução: a\n- próximo: 2\n\n## 2. B\n- tipo: tarefa\n- agente: qa\n- instrução: b\n\n## 3. Fim\n- tipo: fim\n```';
  const d = parseWorkflowMarkdown(src);
  assert.equal(d.name, 'X');
  assert.deepEqual(d.nodes.find((n) => n.id === '1')?.next, ['3']);
  assert.deepEqual(d.nodes.find((n) => n.id === '2')?.next, ['3'], 'passo fora do diagrama mantém a ligação implícita');
});

test('markdown antigo sem Mermaid continua igual', () => {
  const d = parseWorkflowMarkdown('## 1. A\n- agente: qa\n- instrução: a\n\n## 2. Fim\n- tipo: fim');
  assert.deepEqual(d.nodes[0].next, ['2']);
});

test('rótulos com aspas, acentos e # são escapados; destaque do passo atual', () => {
  const m = toMermaid({ nodes: [{ id: '1', type: 'task', title: 'Diga "oi" #1 à equipe', agent: 'copy', next: ['2'] }, { id: '2', type: 'end', title: 'Fim' }] }, { current: '1', status: { '2': 'done' } });
  assert.match(m, /n1\["1\. Diga #quot;oi#quot; #1 à equipe<br\/>copy"\]/);
  assert.match(m, /class n1 atual/);
  assert.match(m, /class n2 feito/);
  const g = parseMermaid(m);
  assert.equal(g.nodes.length, 2);
  assert.equal(g.edges.length, 1);
});
