// Índice de links do vault (formato Obsidian). Puro: recebe {path, text, mtime} e devolve o grafo.
// Sem I/O, para ser testado com node --test.

export type LinkKind = 'link' | 'embed';

export interface ParsedNote {
  title: string;
  tags: string[];
  props: Record<string, string>;
  links: { target: string; kind: LinkKind; line: number }[];
  words: number;
}

export interface NoteInput {
  path: string; // relativo à raiz do vault, com "/" e extensão .md
  text: string;
  mtime: number;
}

export interface GraphNode {
  id: string; // = path
  title: string;
  folder: string;
  tags: string[];
  mtime: number;
  words: number;
  ghost?: boolean; // alvo de link que ainda não existe
}

export interface GraphLink {
  s: string;
  t: string;
  kind: LinkKind | 'tag';
}

export interface VaultGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

const FENCE = /^(```|~~~)/;

function parseFrontmatter(text: string): { props: Record<string, string>; body: string; offset: number } {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return { props: {}, body: text, offset: 0 };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { props: {}, body: text, offset: 0 };
  const raw = text.slice(text.indexOf('\n') + 1, end);
  const props: Record<string, string> = {};
  let lastKey = '';
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_\-À-ú]+):\s*(.*)$/);
    if (m) {
      lastKey = m[1];
      props[lastKey] = m[2].trim();
    } else if (lastKey && /^\s*-\s+/.test(line)) {
      // lista YAML em bloco: tags:\n  - a\n  - b
      const v = line.replace(/^\s*-\s+/, '').trim();
      props[lastKey] = props[lastKey] ? `${props[lastKey]}, ${v}` : v;
    }
  }
  const after = text.indexOf('\n', end + 1);
  const body = after < 0 ? '' : text.slice(after + 1);
  const offset = text.slice(0, after < 0 ? text.length : after + 1).split('\n').length - 1;
  return { props, body, offset };
}

function listValue(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .replace(/^\[|\]$/g, '')
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^["']|["']$/g, '').replace(/^#/, ''))
    .filter(Boolean);
}

export function parseNote(path: string, text: string): ParsedNote {
  const { props, body, offset } = parseFrontmatter(text);
  const tags = new Set<string>(listValue(props.tags ?? props.tag).map((t) => t.toLowerCase()));
  const links: ParsedNote['links'] = [];
  let title = '';
  let inFence = false;
  let words = 0;
  body.split(/\r?\n/).forEach((rawLine, i) => {
    if (FENCE.test(rawLine.trim())) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const line = rawLine.replace(/`[^`]*`/g, ''); // código inline não conta
    words += line.split(/\s+/).filter(Boolean).length;
    if (!title) {
      const h = line.match(/^#\s+(.+)$/);
      if (h) title = h[1].trim();
    }
    for (const m of line.matchAll(/(!?)\[\[([^\]\n]+?)\]\]/g)) {
      const target = m[2].split('|')[0].split('#')[0].trim();
      if (target) links.push({ target, kind: m[1] ? 'embed' : 'link', line: offset + i + 1 });
    }
    for (const m of line.matchAll(/(!?)\[[^\]\n]*\]\(([^)\s]+?\.md)(#[^)]*)?\)/g)) {
      if (/^[a-z]+:\/\//i.test(m[2])) continue;
      links.push({ target: decodeURIComponent(m[2]), kind: m[1] ? 'embed' : 'link', line: offset + i + 1 });
    }
    if (/^#{1,6}\s/.test(line)) return; // cabeçalho não é tag
    for (const m of line.matchAll(/(?:^|\s)#([A-Za-zÀ-ú][\wÀ-ú/-]*)/g)) tags.add(m[1].toLowerCase());
  });
  if (props.title) title = props.title.replace(/^["']|["']$/g, '');
  if (!title) title = basename(path);
  return { title, tags: [...tags], props, links, words };
}

export function basename(path: string): string {
  const b = path.split('/').pop() ?? path;
  return b.replace(/\.md$/i, '');
}

export function folderOf(path: string): string {
  const i = path.indexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

const norm = (s: string) => s.normalize('NFC').toLowerCase();

// Resolução como no Obsidian: caminho exato → nome do arquivo (o de caminho mais curto ganha).
export function makeResolver(paths: string[]) {
  const byPath = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const p of paths) {
    byPath.set(norm(p), p);
    byPath.set(norm(p.replace(/\.md$/i, '')), p);
    const n = norm(basename(p));
    byName.set(n, [...(byName.get(n) ?? []), p]);
  }
  for (const list of byName.values()) list.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  return (target: string, from?: string): string | null => {
    let t = target.replace(/^\.?\//, '');
    if (from && (t.startsWith('../') || t.startsWith('./'))) {
      const parts = from.split('/').slice(0, -1);
      for (const seg of t.split('/')) {
        if (seg === '..') parts.pop();
        else if (seg !== '.') parts.push(seg);
      }
      t = parts.join('/');
    }
    const exact = byPath.get(norm(t)) ?? byPath.get(norm(`${t}.md`));
    if (exact) return exact;
    if (from && !t.includes('/')) {
      const rel = folderOf(from) ? `${from.split('/').slice(0, -1).join('/')}/${t}` : t;
      const r = byPath.get(norm(rel)) ?? byPath.get(norm(`${rel}.md`));
      if (r) return r;
    }
    const list = byName.get(norm(basename(t)));
    return list?.[0] ?? null;
  };
}

export interface VaultIndex {
  notes: Map<string, ParsedNote & { mtime: number }>;
  graph: VaultGraph;
  out: Map<string, Set<string>>;
  inc: Map<string, Set<string>>;
  resolve: (target: string, from?: string) => string | null;
}

export function buildIndex(inputs: NoteInput[]): VaultIndex {
  const notes = new Map<string, ParsedNote & { mtime: number }>();
  for (const n of inputs) notes.set(n.path, { ...parseNote(n.path, n.text), mtime: n.mtime });
  const resolve = makeResolver([...notes.keys()]);
  const out = new Map<string, Set<string>>();
  const inc = new Map<string, Set<string>>();
  const links: GraphLink[] = [];
  const ghosts = new Map<string, GraphNode>();
  const seen = new Set<string>();
  for (const [path, n] of notes) {
    for (const l of n.links) {
      let t = resolve(l.target, path);
      if (!t) {
        const gid = `ghost:${norm(basename(l.target))}`;
        if (!ghosts.has(gid)) ghosts.set(gid, { id: gid, title: basename(l.target), folder: '', tags: [], mtime: n.mtime, words: 0, ghost: true });
        t = gid;
      }
      if (t === path) continue;
      const key = `${path}\u0000${t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ s: path, t, kind: l.kind });
      if (!out.has(path)) out.set(path, new Set());
      out.get(path)!.add(t);
      if (!inc.has(t)) inc.set(t, new Set());
      inc.get(t)!.add(path);
    }
  }
  const nodes: GraphNode[] = [...notes].map(([path, n]) => ({ id: path, title: n.title, folder: folderOf(path), tags: n.tags, mtime: n.mtime, words: n.words }));
  return { notes, graph: { nodes: [...nodes, ...ghosts.values()], links }, out, inc, resolve };
}

// Vizinhos ignorando direção.
function neighbors(idx: VaultIndex, id: string): string[] {
  return [...new Set([...(idx.out.get(id) ?? []), ...(idx.inc.get(id) ?? [])])];
}

// Caminho mais curto (BFS, sem direção) entre duas notas.
export function shortestPath(idx: VaultIndex, from: string, to: string, maxDepth = 8): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>([[from, '']]);
  let frontier = [from];
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const nb of neighbors(idx, cur)) {
        if (prev.has(nb)) continue;
        prev.set(nb, cur);
        if (nb === to) {
          const path = [to];
          let p = cur;
          while (p) {
            path.unshift(p);
            p = prev.get(p)!;
          }
          return path;
        }
        next.push(nb);
      }
    }
    frontier = next;
  }
  return null;
}

// Vizinhança em anéis (1º, 2º, 3º grau) para a Constelação.
export function rings(idx: VaultIndex, id: string, depth = 2): { id: string; ring: number; via: string | null; dir: 'out' | 'in' | 'both' | null }[] {
  const res = new Map<string, { ring: number; via: string | null; dir: 'out' | 'in' | 'both' | null }>([[id, { ring: 0, via: null, dir: null }]]);
  let frontier = [id];
  for (let r = 1; r <= depth; r++) {
    const next: string[] = [];
    for (const cur of frontier) {
      const outs = idx.out.get(cur) ?? new Set();
      const ins = idx.inc.get(cur) ?? new Set();
      for (const nb of neighbors(idx, cur)) {
        if (res.has(nb)) continue;
        const dir = outs.has(nb) && ins.has(nb) ? 'both' : outs.has(nb) ? 'out' : 'in';
        res.set(nb, { ring: r, via: cur, dir });
        next.push(nb);
      }
    }
    frontier = next;
  }
  return [...res].map(([k, v]) => ({ id: k, ...v }));
}

const STOP = new Set(
  'a o e de da do das dos em no na nos nas um uma para por com que se não os as ao à é ser foi como mais mas ou já sua seu the and of to in is for on with this that it be are from vai quando onde isso esta este essa esse são tem ter pelo pela sem também todo toda cada'.split(' '),
);

function terms(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of text.toLowerCase().normalize('NFC').match(/[a-zà-ú0-9][a-zà-ú0-9-]{2,}/g) ?? []) {
    if (STOP.has(w)) continue;
    m.set(w, (m.get(w) ?? 0) + 1);
  }
  return m;
}

// Sugestões de link: notas parecidas (tags + TF-IDF do texto) que ainda não estão ligadas.
export function suggest(idx: VaultIndex, texts: Map<string, string>, id: string, limit = 5): { id: string; score: number; reason: string }[] {
  const self = idx.notes.get(id);
  if (!self) return [];
  const df = new Map<string, number>();
  const tfs = new Map<string, Map<string, number>>();
  for (const [p, t] of texts) {
    const tf = terms(`${idx.notes.get(p)?.title ?? ''} ${t}`);
    tfs.set(p, tf);
    for (const w of tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const N = texts.size || 1;
  const vec = (tf: Map<string, number>) => {
    const v = new Map<string, number>();
    for (const [w, c] of tf) v.set(w, (1 + Math.log(c)) * Math.log(1 + N / (df.get(w) ?? 1)));
    return v;
  };
  const a = vec(tfs.get(id) ?? new Map());
  const na = Math.sqrt([...a.values()].reduce((s, x) => s + x * x, 0)) || 1;
  const linked = new Set(neighbors(idx, id));
  const out: { id: string; score: number; reason: string }[] = [];
  for (const [p, n] of idx.notes) {
    if (p === id || linked.has(p)) continue;
    const b = vec(tfs.get(p) ?? new Map());
    let dot = 0;
    for (const [w, x] of a) dot += x * (b.get(w) ?? 0);
    const nbn = Math.sqrt([...b.values()].reduce((s, x) => s + x * x, 0)) || 1;
    const cos = dot / (na * nbn);
    const shared = n.tags.filter((t) => self.tags.includes(t));
    const score = cos + shared.length * 0.15;
    if (score < 0.12) continue;
    out.push({ id: p, score: Math.round(score * 100) / 100, reason: shared.length ? `tags em comum: ${shared.map((t) => `#${t}`).join(', ')}` : 'assunto parecido' });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}
