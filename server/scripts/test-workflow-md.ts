// Testes do formato markdown de workflow: parse, validação e round-trip estável.
// Uso: npx tsx scripts/test-workflow-md.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { parseWorkflowMarkdown, serializeWorkflow, validateWorkflow } from '../src/workflowMarkdown.ts';

let pass = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    pass++;
    console.log(`ok  ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}\n${(e as Error).message}`);
    process.exitCode = 1;
  }
};

const roundTrip = (md: string) => {
  const a = parseWorkflowMarkdown(md);
  const md2 = serializeWorkflow(a);
  const b = parseWorkflowMarkdown(md2);
  assert.deepEqual(b, a, 'parse(serialize(parse(md))) difere de parse(md)');
  assert.equal(serializeWorkflow(b), md2, 'serialização não é estável');
  return a;
};

const seedDir = new URL('../../workspace-seed/.yui/workflows/', import.meta.url).pathname;
for (const f of readdirSync(seedDir).filter((f) => f.endsWith('.md'))) {
  test(`seed ${f}: válido e round-trip`, () => {
    const def = roundTrip(readFileSync(join(seedDir, f), 'utf8'));
    assert.deepEqual(validateWorkflow(def), []);
    assert.ok(def.nodes.length >= 3);
  });
}

test('post-instagram: estrutura', () => {
  const def = parseWorkflowMarkdown(readFileSync(join(seedDir, 'post-instagram.md'), 'utf8'));
  assert.equal(def.slug, 'post-instagram');
  assert.equal(def.trigger.type, 'manual');
  assert.equal(def.project, null); // seed genérico: sem projeto fixo
  const d = def.nodes.find((n) => n.id === '4')!;
  assert.equal(d.type, 'decision');
  assert.deepEqual(d.branches, [{ label: 'sim', to: '5' }, { label: 'não', to: '2' }]);
  assert.equal(def.nodes.find((n) => n.id === '5')!.type, 'approval');
  assert.equal(def.nodes.at(-1)!.type, 'end');
  assert.deepEqual(def.nodes[0].mcp, ['Firecrawl', 'Apify']);
});

test('leads-diarios: seed manual', () => {
  const def = parseWorkflowMarkdown(readFileSync(join(seedDir, 'leads-diarios.md'), 'utf8'));
  assert.equal(def.trigger.type, 'manual'); // seeds não agendam sozinhos
});

test('tolerante: sem acentos, sem frontmatter, colado de chat, setas ->', () => {
  const md = [
    'Aqui está o workflow:',
    '```markdown',
    '# Relatorio diario',
    '',
    '## 1) Coletar dados',
    '* agente: Research Agent',
    '* instrucao: coletar metricas',
    '* saida: dados',
    '',
    '## 2 - Esta bom?',
    '* condicao: os dados estao completos?',
    '* se sim -> 3',
    '* se nao -> 1',
    '',
    '## 3. Fim',
    '```',
  ].join('\n');
  const def = parseWorkflowMarkdown(md);
  assert.equal(def.name, 'Relatorio diario');
  assert.equal(def.slug, 'relatorio-diario');
  assert.equal(def.nodes[0].agent, 'Research');
  assert.equal(def.nodes[0].instruction, 'coletar metricas');
  assert.deepEqual(def.nodes[0].next, ['2']);
  assert.equal(def.nodes[1].type, 'decision');
  assert.deepEqual(def.nodes[1].branches, [{ label: 'sim', to: '3' }, { label: 'nao', to: '1' }]);
  assert.equal(def.nodes[2].type, 'end');
  assert.deepEqual(validateWorkflow(def), []);
  roundTrip(md);
});

test('paralelo + posições + listas sem colchetes', () => {
  const md = `---
nome: Paralelo
gatilho: cron 30 7 * * *
time: research, copy
---
## 1. Início
- tipo: inicio
- próximos: [2, 3]
- posição: 0,0
## 2. A
- agente: research
- instrução: a
- skills: deep-research, dataviz
- próximo: 4
- posição: -120,140
## 3. B
- agente: copy
- instrução: b
- próximo: 4
## 4. Fim
- tipo: fim
`;
  const def = roundTrip(md);
  assert.equal(def.nodes[0].type, 'start');
  assert.deepEqual(def.nodes[0].next, ['2', '3']);
  assert.deepEqual(def.nodes[1].position, { x: -120, y: 140 });
  assert.deepEqual(def.nodes[1].skills, ['deep-research', 'dataviz']);
  assert.deepEqual(def.team, ['research', 'copy']);
});

test('validação aponta erros', () => {
  const def = parseWorkflowMarkdown('## 1. X\n- tipo: tarefa\n- próximo: 9\n## 2. D\n- tipo: decisão\n- se sim → 1\n');
  const errs = validateWorkflow(def);
  assert.ok(errs.some((e) => e.includes('aponta para 9')));
  assert.ok(errs.some((e) => e.includes('sem agente')));
  assert.ok(errs.some((e) => e.includes('2+ ramos')));
});

console.log(`\n${pass} testes ok`);
