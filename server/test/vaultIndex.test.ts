import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, parseNote, rings, shortestPath, suggest } from '../src/vaultIndex.ts';

test('parseNote: wikilinks com alias, heading, embed, md-link, tags e frontmatter', () => {
  const n = parseNote(
    '01-Projeto/A.md',
    [
      '---',
      'tags: [vault, Cerebro]',
      'status: ok',
      '---',
      '# Título A',
      'Veja [[B|o B]] e [[C#Seção]] e ![[img.png]].',
      'Link md: [d](../02-Decisoes/D.md) e externo [x](https://e.com/x.md).',
      'Texto #ideia e `[[ignorado]]`.',
      '```',
      '[[dentro-do-codigo]]',
      '```',
      '## Cabeçalho não é #tag',
    ].join('\n'),
  );
  assert.equal(n.title, 'Título A');
  assert.deepEqual(n.tags.sort(), ['cerebro', 'ideia', 'vault']);
  assert.equal(n.props.status, 'ok');
  assert.deepEqual(
    n.links.map((l) => `${l.kind}:${l.target}`),
    ['link:B', 'link:C', 'embed:img.png', 'link:../02-Decisoes/D.md'],
  );
  assert.equal(n.links[0].line, 6);
});

test('frontmatter com lista em bloco', () => {
  const n = parseNote('x.md', '---\ntags:\n  - a\n  - b\n---\ntexto');
  assert.deepEqual(n.tags.sort(), ['a', 'b']);
});

const vault = () =>
  buildIndex([
    { path: '01-Projeto/A.md', text: '# A\n[[B]] [[Fantasma]] [[../02-Decisoes/D.md]] #vault cérebro estrelas', mtime: 1 },
    { path: '01-Projeto/B.md', text: '# B\n[[C]]', mtime: 2 },
    { path: '03-Agentes/C.md', text: '# C\n[[D]]', mtime: 3 },
    { path: '02-Decisoes/D.md', text: '# D', mtime: 4 },
    { path: '06-Ideias/B.md', text: '# B duplicado (caminho maior perde)', mtime: 5 },
    { path: '06-Ideias/E.md', text: '# E\n#vault cérebro estrelas universo', mtime: 6 },
  ]);

test('resolução: nome curto, duplicado escolhe caminho mais curto, fantasma vira ghost', () => {
  const idx = vault();
  assert.equal(idx.resolve('B'), '01-Projeto/B.md');
  assert.equal(idx.resolve('06-Ideias/B'), '06-Ideias/B.md');
  assert.ok([...(idx.out.get('01-Projeto/A.md') ?? [])].includes('02-Decisoes/D.md'));
  assert.ok(idx.graph.nodes.some((n) => n.ghost && n.title === 'Fantasma'));
  assert.ok(idx.inc.get('01-Projeto/B.md')?.has('01-Projeto/A.md'));
});

test('caminho mais curto e anéis', () => {
  const idx = vault();
  const p = shortestPath(idx, '01-Projeto/B.md', '02-Decisoes/D.md');
  assert.equal(p?.length, 3);
  assert.equal(p?.[0], '01-Projeto/B.md');
  assert.equal(p?.[2], '02-Decisoes/D.md');
  assert.equal(shortestPath(idx, '01-Projeto/A.md', '06-Ideias/E.md'), null);
  const r = rings(idx, '01-Projeto/A.md', 2);
  assert.equal(r.find((x) => x.id === '01-Projeto/B.md')?.ring, 1);
  assert.equal(r.find((x) => x.id === '03-Agentes/C.md')?.ring, 2);
});

test('sugestões encontram nota parecida não ligada', () => {
  const idx = vault();
  const texts = new Map([...idx.notes.keys()].map((p) => [p, p.includes('A.md') ? '#vault cérebro estrelas' : p.includes('E.md') ? '#vault cérebro estrelas universo' : 'x']));
  const s = suggest(idx, texts, '01-Projeto/A.md');
  assert.equal(s[0]?.id, '06-Ideias/E.md');
});
