// Documentação de uso (docs/ajuda): parser dos guias/receitas/FAQ/dia e busca BM25. Puro, sem I/O.

import type { AppPage, HelpGuideMeta, HelpIndex, HelpRecipeMeta, HelpSource } from '../../shared/protocol.ts';

export type Meta = Record<string, string | string[]>;

// Frontmatter YAML simples: "chave: valor", "chave: [a, b]" e listas em bloco ("  - item").
export function parseFrontmatter(src: string): { meta: Meta; body: string } {
  const text = src.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Meta = {};
  let listKey: string | null = null;
  for (const line of m[1].split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (meta[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, k, v] = kv;
    if (!v.trim()) {
      meta[k] = [];
      listKey = k;
    } else if (/^\[.*\]$/.test(v.trim())) {
      meta[k] = v.trim().slice(1, -1).split(',').map((x) => unquote(x)).filter(Boolean);
      listKey = null;
    } else {
      meta[k] = unquote(v);
      listKey = null;
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
export const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(' ') : (v ?? ''));
export const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

// Corpo sem o "# Título" inicial.
export function stripTitle(body: string): { title: string | null; rest: string } {
  const m = /^\s*#\s+(.+)\n?/.exec(body);
  return m ? { title: m[1].trim(), rest: body.slice(m[0].length).trimStart() } : { title: null, rest: body };
}

export interface ParsedDoc {
  kind: 'guia' | 'receita';
  id: string;
  titulo: string;
  meta: Meta;
  markdown: string;
  pagina: AppPage | null;
}

const PAGES = new Set<AppPage>(['overview', 'ops', 'agents', 'runs', 'missions', 'workflows', 'schedule', 'projects', 'browser', 'terminal', 'claude', 'tools', 'inbox', 'infra', 'settings', 'vault', 'brain', 'company', 'help', 'usage', 'reminders', 'skills']);
export const asPage = (v: string | string[] | undefined): AppPage | null => {
  const s = str(v).trim();
  return PAGES.has(s as AppPage) ? (s as AppPage) : null;
};

export function parseDoc(kind: 'guia' | 'receita', id: string, src: string): ParsedDoc {
  const { meta, body } = parseFrontmatter(src);
  const { title, rest } = stripTitle(body);
  return { kind, id, titulo: str(meta.titulo) || title || id, meta, markdown: rest.trim(), pagina: kind === 'guia' ? asPage(meta.pagina) : null };
}

export function parseFaq(src: string): HelpIndex['faq'] {
  const out: HelpIndex['faq'] = [];
  let cat = 'Geral';
  let q: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (q) out.push({ categoria: cat, pergunta: q, resposta: buf.join('\n').trim() });
    q = null;
    buf = [];
  };
  for (const line of src.replace(/\r\n/g, '\n').split('\n')) {
    const h2 = /^##\s+(.+)$/.exec(line);
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      flush();
      q = h3[1].trim();
    } else if (h2) {
      flush();
      cat = h2[1].trim();
    } else if (q) buf.push(line);
  }
  flush();
  return out;
}

export function parseDia(src: string): HelpIndex['dia'] {
  const out: HelpIndex['dia'] = [];
  const parts = src.replace(/\r\n/g, '\n').split(/^##\s+/m).slice(1);
  for (const p of parts) {
    const [head, ...rest] = p.split('\n');
    const m = /^(.+?)\s*[·\-–—|]\s*(.+)$/.exec(head.trim());
    const lines = rest.map((l) => l.trim()).filter(Boolean);
    const quote = lines.find((l) => l.startsWith('>'));
    out.push({
      hora: m ? m[1].trim() : '',
      titulo: m ? m[2].trim() : head.trim(),
      texto: lines.filter((l) => !l.startsWith('>')).join(' '),
      frase: quote ? quote.replace(/^>\s*/, '').trim() : null,
    });
  }
  return out;
}

export function guideMeta(d: ParsedDoc): HelpGuideMeta {
  return { id: d.id, titulo: d.titulo, grupo: str(d.meta.grupo) || 'Geral', pagina: d.pagina, ordem: Number(str(d.meta.ordem)) || 99, resumo: str(d.meta.resumo) };
}

export function recipeMeta(d: ParsedDoc): HelpRecipeMeta {
  return { id: d.id, titulo: d.titulo, categoria: str(d.meta.categoria) || 'Geral', ferramentas: str(d.meta.ferramentas), tempo: str(d.meta.tempo) };
}

// ---------- busca ----------

const STOP = new Set(
  'a o e de da do das dos em no na nos nas um uma para por com que se os as ao à é ser foi como mais mas ou já eu meu minha você voce vc isso esse essa este esta tem ter qual quais quando onde porque pra pro the and of to in is for posso faço fazer consigo usar uso'.split(' '),
);

export function tokens(s: string): string[] {
  return (s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{2,}/g) ?? [])
    .filter((w) => !STOP.has(w))
    .map(stem);
}

// Radical bem simples para português (plural e algumas terminações comuns).
function stem(w: string): string {
  if (w.length > 5) for (const suf of ['amentos', 'amento', 'acoes', 'acao', 'mente', 'ados', 'adas', 'ando', 'endo', 'ado', 'ada', 'ar', 'er', 'ir']) if (w.endsWith(suf) && w.length - suf.length >= 4) return w.slice(0, -suf.length);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}

export interface Passage {
  source: HelpSource;
  section: string;
  text: string;
  boost: number; // título/resumo pesam mais
}

export function passagesOf(doc: ParsedDoc): Passage[] {
  const source: HelpSource = { kind: doc.kind, id: doc.id, titulo: doc.titulo, pagina: doc.pagina };
  const head = [doc.titulo, str(doc.meta.resumo), str(doc.meta.usar_quando), list(doc.meta.frases).join(' '), str(doc.meta.antes), str(doc.meta.resultado)].filter(Boolean).join('\n');
  const out: Passage[] = [{ source, section: 'Resumo', text: head, boost: 1.6 }];
  for (const sec of doc.markdown.split(/^##\s+/m)) {
    const [h, ...rest] = sec.split('\n');
    const body = rest.join('\n').trim();
    if (!body) continue;
    out.push({ source, section: h.trim(), text: `${doc.titulo} — ${h.trim()}\n${body}`, boost: 1 });
  }
  const extra = [...list(doc.meta.dicas), ...list(doc.meta.erros), str(doc.meta.nao_usar_quando)].filter(Boolean).join('\n');
  if (extra) out.push({ source, section: 'Dicas', text: `${doc.titulo} — dicas\n${extra}`, boost: 0.8 });
  return out;
}

export function faqPassages(faq: HelpIndex['faq']): Passage[] {
  return faq.map((f, i) => ({ source: { kind: 'faq', id: String(i), titulo: f.pergunta, pagina: null }, section: f.categoria, text: `${f.pergunta}\n${f.resposta}`, boost: 1.3 }));
}

export class Bm25 {
  private docs: { p: Passage; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avg = 1;
  constructor(passages: Passage[]) {
    for (const p of passages) {
      const t = tokens(p.text);
      const tf = new Map<string, number>();
      for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
      for (const w of tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
      this.docs.push({ p, tf, len: t.length || 1 });
    }
    this.avg = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }
  search(q: string, k = 4): { p: Passage; score: number }[] {
    const qt = [...new Set(tokens(q))];
    const N = this.docs.length || 1;
    const k1 = 1.4;
    const b = 0.7;
    const scored = this.docs.map((d) => {
      let s = 0;
      for (const w of qt) {
        const f = d.tf.get(w);
        if (!f) continue;
        const idf = Math.log(1 + (N - (this.df.get(w) ?? 0) + 0.5) / ((this.df.get(w) ?? 0) + 0.5));
        s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / this.avg)));
      }
      return { p: d.p, score: s * d.p.boost };
    });
    return scored.filter((x) => x.score > 0).sort((a, b2) => b2.score - a.score).slice(0, k);
  }
}

// ---------- resultados: tipo de tarefa por execução ----------

const CODE = new Set(['backend', 'frontend', 'qa', 'devops', 'security']);
const TEXT = new Set(['copy', 'designer', 'report']);

export function runType(agentId: string, origin: string): 'codigo' | 'pesquisa' | 'textos' | 'assistente' | 'workflow' | 'rotina' {
  if (origin === 'workflow') return 'workflow';
  if (origin === 'routine') return 'rotina';
  if (CODE.has(agentId)) return 'codigo';
  if (agentId === 'research') return 'pesquisa';
  if (TEXT.has(agentId)) return 'textos';
  return 'assistente';
}
