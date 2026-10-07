import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config.ts';
import { kvGet, kvSet } from './db.ts';

// Produto renomeado de "Yui Console" para "Atria OS" (a assistente continua sendo a Yui).
// Uma vez por instância: troca o nome nos agentes e nas notas que vieram da semente, com cópia antes
// em .atria/backup/rename_atria_v1. Notas e agentes criados pelo usuário só têm o link [[Yui Console]] ajustado.
const KEY = 'rename_atria_v1';

const brand = (s: string) =>
  s
    .replaceAll('Yui Console', 'Atria OS')
    .replaceAll('/workspace/.yui/', '/workspace/.atria/')
    .replaceAll('yui.json', 'atria.json');
const links = (s: string) => s.replace(/\[\[Yui Console(?=[\]|#])/g, '[[Atria OS');

function mdFiles(dir: string, base = '', out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) mdFiles(join(dir, e.name), rel, out);
    else if (e.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

export function migrateBrandContent() {
  if (kvGet(KEY)) return;
  const backup = join(config.metaDir, 'backup', KEY);
  let n = 0;
  const rewrite = (root: string, rel: string, fn: (s: string) => string, area: string) => {
    const f = join(root, rel);
    if (!existsSync(f)) return;
    const cur = readFileSync(f, 'utf8');
    const next = fn(cur);
    if (next === cur) return;
    mkdirSync(dirname(join(backup, area, rel)), { recursive: true });
    cpSync(f, join(backup, area, rel));
    writeFileSync(f, next);
    n++;
  };

  // agentes semeados (mesmos nomes de arquivo do seed)
  const agents = join(config.workspaceDir, '.claude', 'agents');
  for (const rel of mdFiles(join(config.seedDir, '.claude', 'agents'))) rewrite(agents, rel, brand, 'agents');

  // vault: a nota do produto muda de nome; as notas semeadas trocam o nome; as demais só o link
  const vault = join(config.metaDir, 'vault');
  const oldNote = '01-Projeto/Yui Console.md';
  const newNote = '01-Projeto/Atria OS.md';
  if (existsSync(join(vault, oldNote)) && !existsSync(join(vault, newNote))) {
    mkdirSync(dirname(join(backup, 'vault', oldNote)), { recursive: true });
    cpSync(join(vault, oldNote), join(backup, 'vault', oldNote));
    renameSync(join(vault, oldNote), join(vault, newNote));
  }
  const seeded = new Set<string>(JSON.parse(kvGet('vault_seeded') ?? '[]'));
  if (seeded.has(oldNote)) {
    seeded.add(newNote); // apagada pelo usuário antes = continua apagada
    kvSet('vault_seeded', JSON.stringify([...seeded]));
  }
  const seedNotes = new Set(mdFiles(join(config.seedDir, '.atria', 'vault')));
  for (const rel of mdFiles(vault)) rewrite(vault, rel, seedNotes.has(rel) ? (s) => links(brand(s)) : links, 'vault');

  kvSet(KEY, new Date().toISOString());
  if (n) console.log(`rename Atria OS: ${n} arquivo(s) atualizados (cópias em ${backup})`);
}
