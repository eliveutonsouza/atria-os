import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Bm25, faqPassages, parseDia, parseDoc, parseFaq, parseFrontmatter, passagesOf, runType, type ParsedDoc } from '../src/helpDocs.ts';

test('frontmatter: valor, lista inline, lista em bloco e aspas', () => {
  const { meta, body } = parseFrontmatter('---\ntitulo: Workflows\nordem: 2\nfrases:\n  - "Yui, cria um workflow"\n  - Roda agora\nrelacionados: [agendamentos, aprovacoes]\n---\n# Workflows\n\n## O que é\nx');
  assert.equal(meta.titulo, 'Workflows');
  assert.deepEqual(meta.frases, ['Yui, cria um workflow', 'Roda agora']);
  assert.deepEqual(meta.relacionados, ['agendamentos', 'aprovacoes']);
  assert.match(body, /^# Workflows/);
});

test('guia: título sai do corpo e página é validada', () => {
  const d = parseDoc('guia', 'workflows', '---\ntitulo: Workflows\npagina: workflows\n---\n# Workflows\n\n## O que é\nUma rotina.');
  assert.equal(d.pagina, 'workflows');
  assert.equal(d.markdown, '## O que é\nUma rotina.');
  assert.equal(parseDoc('guia', 'x', '---\npagina: inexistente\n---\n# X').pagina, null);
});

test('faq e dia', () => {
  const f = parseFaq('# FAQ\n\n## Segurança\n### Os agentes fazem algo sem mim?\nNão: push e deploy pedem aprovação.\n\n### Outra?\nSim.\n\n## Celular\n### Como aprovo?\nPela notificação.');
  assert.deepEqual(f.map((x) => `${x.categoria}|${x.pergunta}`), ['Segurança|Os agentes fazem algo sem mim?', 'Segurança|Outra?', 'Celular|Como aprovo?']);
  const d = parseDia('# Dia\n\n## 08:00 · Comece pela Visão geral\nVeja o que rodou.\n> "Yui, o que aconteceu?"\n\n## 18:00 · Feche o dia\nResumo.');
  assert.deepEqual(d[0], { hora: '08:00', titulo: 'Comece pela Visão geral', texto: 'Veja o que rodou.', frase: '"Yui, o que aconteceu?"' });
  assert.equal(d[1].frase, null);
});

test('classificação das execuções para Resultados', () => {
  assert.equal(runType('backend', 'yui'), 'codigo');
  assert.equal(runType('qa', 'mission'), 'codigo');
  assert.equal(runType('research', 'manual'), 'pesquisa');
  assert.equal(runType('copy', 'yui'), 'textos');
  assert.equal(runType('assistente', 'yui'), 'assistente');
  assert.equal(runType('backend', 'workflow'), 'workflow');
  assert.equal(runType('qa', 'routine'), 'rotina');
});

// ---------- conteúdo real (docs/ajuda) ----------
const DIR = new URL('../../docs/ajuda/', import.meta.url);
const hasContent = existsSync(new URL('guias/', DIR)) && readdirSync(new URL('guias/', DIR)).length > 0;
const load = (sub: string, kind: 'guia' | 'receita'): ParsedDoc[] =>
  existsSync(new URL(`${sub}/`, DIR)) ? readdirSync(new URL(`${sub}/`, DIR)).filter((f) => f.endsWith('.md')).map((f) => parseDoc(kind, f.replace(/\.md$/, ''), readFileSync(new URL(`${sub}/${f}`, DIR), 'utf8'))) : [];

test('guias completos e coerentes', { skip: !hasContent }, () => {
  const guides = load('guias', 'guia');
  const ids = new Set(guides.map((g) => g.id));
  assert.ok(guides.length >= 18, `${guides.length} guias`);
  for (const g of guides) {
    for (const k of ['titulo', 'grupo', 'resumo', 'usar_quando', 'nao_usar_quando']) assert.ok(g.meta[k], `${g.id}: falta ${k}`);
    assert.ok(Array.isArray(g.meta.frases) && g.meta.frases.length >= 2, `${g.id}: frases`);
    assert.ok(Array.isArray(g.meta.dicas) && g.meta.dicas.length >= 1, `${g.id}: dicas`);
    assert.match(g.markdown, /## Passo a passo\n+1\. \*\*/, `${g.id}: passo a passo`);
    if (g.meta.pagina && g.meta.pagina !== 'nenhuma') assert.ok(g.pagina, `${g.id}: página ${g.meta.pagina} inválida`);
    for (const r of (g.meta.relacionados as string[]) ?? []) assert.ok(ids.has(r), `${g.id}: relacionado ${r} não existe`);
  }
  const recipes = load('receitas', 'receita');
  assert.ok(recipes.length >= 10, `${recipes.length} receitas`);
  for (const r of recipes) {
    for (const k of ['titulo', 'categoria', 'ferramentas', 'tempo', 'resultado', 'frase']) assert.ok(r.meta[k], `${r.id}: falta ${k}`);
    assert.match(r.markdown, /## Passo a passo\n+1\. \*\*/, `${r.id}: passos`);
  }
});

test('busca acha o guia certo para perguntas do dia a dia', { skip: !hasContent }, () => {
  const guides = load('guias', 'guia');
  const recipes = load('receitas', 'receita');
  const faq = existsSync(new URL('faq.md', DIR)) ? parseFaq(readFileSync(new URL('faq.md', DIR), 'utf8')) : [];
  const bm = new Bm25([...guides.flatMap(passagesOf), ...recipes.flatMap(passagesOf), ...faqPassages(faq)]);
  const CASES: [string, string[]][] = [
    ['como agendo um workflow toda segunda?', ['workflows', 'agendamentos', 'agendar-relatorio']],
    ['como aprovo um deploy pelo celular?', ['aprovacoes', 'celular', 'aprovar-pelo-celular']],
    ['onde envio a tabela de preços para a IA usar?', ['empresa', 'proposta-comercial', 'responder-cliente-com-documentos']],
    ['quero editar uma nota no VS Code', ['vault']],
    ['ver o agente navegando no site', ['navegador']],
    ['o que é uma missão?', ['missoes']],
    ['trocar a chave da OpenAI', ['configuracoes']],
    ['ver o mapa de conexões das notas', ['cerebro', 'achar-algo-no-cerebro']],
    ['como falo com a yui por voz?', ['falar-com-a-yui']],
    ['o site do cliente caiu, onde vejo os logs?', ['infra', 'checar-sites', 'projetos']],
  ];
  const misses: string[] = [];
  for (const [q, want] of CASES) {
    const top = bm.search(q, 3).map((h) => h.p.source.id);
    if (!top.some((id) => want.includes(id))) misses.push(`${q} → ${top.join(', ')}`);
  }
  assert.ok(misses.length <= 1, `erros de busca:\n${misses.join('\n')}`);
});
