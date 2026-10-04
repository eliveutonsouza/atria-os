import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chunkItems, estTokens, pagesFrom, readingOrder, rrf, tsQueryTerms, type DoclingJson, type Item } from '../src/company/chunk.ts';
import { checkFile, cleanName } from '../src/company/files.ts';

const doc = JSON.parse(readFileSync(new URL('./fixtures/docling-precos.json', import.meta.url), 'utf8')) as DoclingJson;

test('ordem de leitura do Docling: títulos, texto e tabela em markdown com página', () => {
  const items = readingOrder(doc);
  assert.equal(items[0].kind, 'title');
  assert.equal(items[0].page, 1);
  const table = items.find((i) => i.kind === 'table');
  assert.ok(table, 'tabela encontrada');
  assert.match(table.text, /\| Site institucional \| R\$ 4\.900 \| 15 dias \|/);
  assert.match(table.text.split('\n')[1], /^\| --- \|/);
});

test('páginas com caixas em frações e origem no topo', () => {
  const items = readingOrder(doc);
  const pages = pagesFrom(doc, items, new Set());
  assert.equal(pages.length, 1);
  const title = pages[0].boxes.find((b) => b.kind === 'title')!;
  assert.ok(title.y < 0.2, `título perto do topo (y=${title.y})`);
  for (const b of pages[0].boxes) for (const v of [b.x, b.y, b.w, b.h]) assert.ok(v >= 0 && v <= 1);
  assert.match(pages[0].text, /ZEBRA-4471/);
});

test('trechos: pequeno documento vira poucos trechos com título como contexto', () => {
  const chunks = chunkItems(readingOrder(doc));
  assert.ok(chunks.length >= 1 && chunks.length <= 3);
  assert.ok(chunks.some((c) => c.text.includes('ZEBRA-4471')));
  assert.ok(chunks.every((c) => c.page === 1));
});

test('trechos: respeita limite, sobrepõe e quebra tabela grande repetindo cabeçalho', () => {
  const para = (n: number) => `Parágrafo ${n}. ` + 'palavra '.repeat(150);
  const items: Item[] = [{ kind: 'title', text: 'Seção A', page: 1 }, ...Array.from({ length: 12 }, (_, i) => ({ kind: 'text' as const, text: para(i), page: 1 + Math.floor(i / 4) }))];
  const rows = Array.from({ length: 400 }, (_, i) => `| item ${i} | R$ ${i},00 |`).join('\n');
  items.push({ kind: 'table', text: `| Serviço | Preço |\n| --- | --- |\n${rows}`, page: 4 });
  const chunks = chunkItems(items, { maxTokens: 400, overlapTokens: 60, maxTableTokens: 600 });
  for (const c of chunks.filter((x) => x.kind === 'texto')) assert.ok(c.tokens <= 400 + 60 + 20, `trecho com ${c.tokens} tokens`);
  assert.ok(chunks.filter((c) => c.kind === 'texto').slice(1).some((c) => c.text.includes('…')), 'tem sobreposição');
  assert.ok(chunks.filter((c) => c.kind === 'texto').every((c) => c.text.startsWith('Seção A')), 'título como contexto');
  const tables = chunks.filter((c) => c.kind === 'tabela');
  assert.ok(tables.length > 1);
  assert.ok(tables.every((t) => t.text.includes('| Serviço | Preço |\n| --- | --- |')));
  assert.equal(chunks.map((c) => c.ord).join(), chunks.map((_, i) => i).join());
  assert.ok(estTokens('abcd') === 1);
});

test('RRF favorece quem aparece bem nas duas listas', () => {
  const s = rrf([['a', 'b', 'c'], ['c', 'a', 'd']]);
  const order = [...s].sort((x, y) => y[1] - x[1]).map(([k]) => k);
  assert.equal(order[0], 'a');
  assert.ok(order.indexOf('c') < order.indexOf('b'));
});

test('termos da busca por palavra', () => {
  assert.equal(tsQueryTerms('Quanto custa um site institucional?'), 'custa:* | site:* | institucional:*');
  assert.equal(tsQueryTerms('?? de a'), null);
  assert.equal(tsQueryTerms("x'); DROP TABLE"), 'drop:* | table:*');
});

test('arquivos: assinatura real, extensão e nome', () => {
  assert.equal(checkFile('a.pdf', Buffer.from('%PDF-1.7 ...')).ok, true);
  const fake = checkFile('a.pdf', Buffer.from('<html>'));
  assert.equal(fake.ok, false);
  assert.equal(checkFile('a.exe', Buffer.from('MZ')).ok, false);
  assert.equal(checkFile('n.md', Buffer.from('# oi')).ok, true);
  assert.equal(checkFile('b.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])).ok, true);
  assert.equal(cleanName('../../etc/pass<wd>.pdf'), 'pass wd .pdf');
});
