// Leitura do JSON do Docling (DoclingDocument) e divisão em trechos para a busca. Puro, sem I/O.

import type { CompanyChunk, CompanyDocBox, CompanyDocPage } from '../../../shared/protocol.ts';

type Ref = { $ref: string };
type Prov = { page_no: number; bbox?: { l: number; t: number; r: number; b: number; coord_origin?: string } };
type DText = { label: string; text?: string; orig?: string; prov?: Prov[]; level?: number; children?: Ref[] };
type DCell = { text: string; start_row_offset_idx: number; start_col_offset_idx: number; column_header?: boolean };
type DTable = { label: string; prov?: Prov[]; data?: { num_rows: number; num_cols: number; table_cells?: DCell[]; grid?: DCell[][] }; children?: Ref[] };
type DGroup = { label: string; children?: Ref[] };
export interface DoclingJson {
  body: { children: Ref[] };
  texts: DText[];
  tables: DTable[];
  pictures?: { label: string; prov?: Prov[]; children?: Ref[] }[];
  groups: DGroup[];
  pages: Record<string, { size: { width: number; height: number }; page_no: number }>;
}

export interface Item {
  kind: 'title' | 'text' | 'table' | 'list' | 'picture';
  text: string;
  page: number | null;
  prov?: Prov;
}

const TITLE = new Set(['title', 'section_header']);
const SKIP = new Set(['page_header', 'page_footer', 'footnote']);

export const estTokens = (s: string) => Math.ceil(s.length / 4);

export function tableToMarkdown(t: DTable): string {
  const d = t.data;
  if (!d) return '';
  let grid = d.grid;
  if (!grid?.length && d.table_cells) {
    grid = Array.from({ length: d.num_rows }, () => Array.from({ length: d.num_cols }, () => ({ text: '' }) as DCell));
    for (const c of d.table_cells) if (grid[c.start_row_offset_idx]) grid[c.start_row_offset_idx][c.start_col_offset_idx] = c;
  }
  if (!grid?.length) return '';
  const rows = grid.map((r) => `| ${r.map((c) => (c?.text ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim()).join(' | ')} |`);
  const sep = `| ${grid[0].map(() => '---').join(' | ')} |`;
  return [rows[0], sep, ...rows.slice(1)].join('\n');
}

// Percorre o documento na ordem de leitura (árvore body → grupos → itens).
export function readingOrder(doc: DoclingJson): Item[] {
  const out: Item[] = [];
  const seen = new Set<string>();
  const resolve = (ref: string): unknown => {
    const [, kind, idx] = ref.split('/');
    const arr = (doc as unknown as Record<string, unknown[]>)[kind];
    return arr?.[Number(idx)];
  };
  const walk = (refs: Ref[] | undefined) => {
    for (const r of refs ?? []) {
      if (seen.has(r.$ref)) continue;
      seen.add(r.$ref);
      const node = resolve(r.$ref) as (DText & DTable & DGroup) | undefined;
      if (!node) continue;
      const kind = r.$ref.split('/')[1];
      if (kind === 'groups') {
        walk(node.children);
        continue;
      }
      const prov = node.prov?.[0];
      const page = prov?.page_no ?? null;
      if (kind === 'tables') {
        const md = tableToMarkdown(node as DTable);
        if (md) out.push({ kind: 'table', text: md, page, prov });
      } else if (kind === 'pictures') {
        out.push({ kind: 'picture', text: '', page, prov });
        walk(node.children);
        continue;
      } else if (kind === 'texts') {
        if (SKIP.has(node.label)) continue;
        const text = (node.text ?? node.orig ?? '').trim();
        if (text) out.push({ kind: TITLE.has(node.label) ? 'title' : node.label === 'list_item' ? 'list' : 'text', text, page, prov });
      }
      walk(node.children);
    }
  };
  walk(doc.body?.children);
  return out;
}

// Páginas com texto e caixas (frações da página, origem no topo à esquerda) para o visualizador.
export function pagesFrom(doc: DoclingJson, items: Item[], ocrPages: Set<number>): CompanyDocPage[] {
  const pages = Object.values(doc.pages ?? {}).sort((a, b) => a.page_no - b.page_no);
  return pages.map((p) => {
    const W = p.size?.width || 1;
    const H = p.size?.height || 1;
    const mine = items.filter((i) => i.page === p.page_no);
    const boxes: CompanyDocBox[] = [];
    for (const i of mine) {
      const b = i.prov?.bbox;
      if (!b) continue;
      const bottomLeft = (b.coord_origin ?? 'BOTTOMLEFT').toUpperCase() === 'BOTTOMLEFT';
      const top = bottomLeft ? H - b.t : b.t;
      const bottom = bottomLeft ? H - b.b : b.b;
      const y = Math.min(top, bottom);
      boxes.push({
        kind: i.kind === 'title' ? 'title' : i.kind,
        x: clamp(b.l / W),
        y: clamp(y / H),
        w: clamp((b.r - b.l) / W),
        h: clamp(Math.abs(bottom - top) / H),
      });
    }
    return {
      page: p.page_no,
      ocr: ocrPages.has(p.page_no),
      width: W,
      height: H,
      text: mine.filter((i) => i.text).map((i) => (i.kind === 'title' ? `## ${i.text}` : i.kind === 'list' ? `- ${i.text}` : i.text)).join('\n\n'),
      boxes,
    };
  });
}

const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

export interface ChunkOpts {
  maxTokens?: number;
  overlapTokens?: number;
  maxTableTokens?: number;
}

type Draft = Omit<CompanyChunk, 'id'>;

// Junta itens em trechos de ~maxTokens. Cabeçalho abre trecho novo (quando o atual já tem corpo),
// tabelas ficam inteiras quando cabem (senão quebram por linhas repetindo o cabeçalho),
// cada trecho leva o caminho de títulos como contexto e um pedaço do anterior como sobreposição.
export function chunkItems(items: Item[], opts: ChunkOpts = {}): Draft[] {
  const MAX = opts.maxTokens ?? 800;
  const OVER = opts.overlapTokens ?? 120;
  const MAXT = opts.maxTableTokens ?? 1200;
  const out: Draft[] = [];
  let heading = '';
  let buf: string[] = [];
  let bufPage: number | null = null;
  let bufKind: Draft['kind'] = 'texto';
  let tail = '';

  const flush = () => {
    const body = buf.join('\n\n').trim();
    if (!body) {
      buf = [];
      return;
    }
    const prefix = heading && !body.startsWith(heading) ? `${heading}\n\n` : '';
    const text = `${prefix}${tail ? `${tail}\n\n` : ''}${body}`.trim();
    out.push({ ord: out.length, page: bufPage, tokens: estTokens(text), kind: bufKind, text });
    tail = bufKind === 'tabela' ? '' : lastTokens(body, OVER);
    buf = [];
    bufPage = null;
    bufKind = 'texto';
  };
  const size = () => estTokens(buf.join('\n\n'));

  for (const it of items) {
    if (it.kind === 'picture' || !it.text) continue;
    if (it.kind === 'title') {
      if (size() > 60) flush();
      heading = it.text.length > 160 ? it.text.slice(0, 160) : it.text;
      buf.push(it.text);
      bufPage ??= it.page;
      continue;
    }
    if (it.kind === 'table') {
      const t = estTokens(it.text);
      if (t <= MAXT) {
        if (size() + t > MAX) flush();
        buf.push(it.text);
        bufPage ??= it.page;
        bufKind = 'tabela';
        if (t > MAX / 2) flush();
      } else {
        flush();
        const [head, sep, ...rows] = it.text.split('\n');
        let part: string[] = [];
        for (const r of rows) {
          part.push(r);
          if (estTokens(part.join('\n')) > MAX) {
            buf = [[head, sep, ...part].join('\n')];
            bufPage = it.page;
            bufKind = 'tabela';
            flush();
            part = [];
          }
        }
        if (part.length) {
          buf = [[head, sep, ...part].join('\n')];
          bufPage = it.page;
          bufKind = 'tabela';
          flush();
        }
      }
      continue;
    }
    const line = it.kind === 'list' ? `- ${it.text}` : it.text;
    const t = estTokens(line);
    if (t > MAX) {
      flush();
      for (const piece of splitLong(line, MAX)) {
        buf = [piece];
        bufPage = it.page;
        flush();
      }
      continue;
    }
    if (size() + t > MAX) flush();
    buf.push(line);
    bufPage ??= it.page;
  }
  flush();
  return out;
}

function lastTokens(s: string, n: number): string {
  const chars = n * 4;
  if (s.length <= chars) return '';
  const cut = s.slice(-chars);
  const sp = cut.indexOf(' ');
  return `…${sp > 0 ? cut.slice(sp + 1) : cut}`;
}

function splitLong(s: string, maxTokens: number): string[] {
  const out: string[] = [];
  const sentences = s.split(/(?<=[.!?;])\s+/);
  let cur = '';
  for (const x of sentences) {
    if (estTokens(`${cur} ${x}`) > maxTokens && cur) {
      out.push(cur.trim());
      cur = '';
    }
    if (estTokens(x) > maxTokens) {
      for (let i = 0; i < x.length; i += maxTokens * 4) out.push(x.slice(i, i + maxTokens * 4));
      continue;
    }
    cur += ` ${x}`;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Fusão por posição recíproca (RRF) entre a lista vetorial e a de palavras.
export function rrf(lists: string[][], k = 60): Map<string, number> {
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return score;
}

// Termos da pergunta para o to_tsquery do Postgres (OR entre palavras, sem caracteres especiais).
export function tsQueryTerms(q: string): string | null {
  const STOP = new Set('a o e de da do das dos em no na nos nas um uma para por com que se os as ao qual quais quanto quanta como onde quando é são tem ser foi nosso nossa nossos nossas the and of to in is for'.split(' '));
  const words = q
    .toLowerCase()
    .normalize('NFC')
    .match(/[a-zà-ú0-9]{2,}/g)
    ?.filter((w) => !STOP.has(w));
  if (!words?.length) return null;
  return [...new Set(words)].slice(0, 16).map((w) => `${w}:*`).join(' | ');
}
