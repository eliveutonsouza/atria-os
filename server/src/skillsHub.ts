import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import type { HubSkill, HubSkillDetail, InstalledSkill, SkillAudit, SkillHubView } from '../../shared/protocol.ts';
import { kvGet, kvSet, now } from './db.ts';
import { findAgent, loadAllAgents } from './agents.ts';
import { askApproval } from './runs.ts';
import { registerAgentOptions, registerBrain, registerRunPrompt } from './extensions.ts';

// Loja de skills (https://skills.sh): ranking, busca, ficha com auditorias e instalação com 1 clique.
// Plataforma = ~/.claude/skills/<nome> (Yui, todos os agentes e o terminal enxergam).
// Agente = plugin local só dele em ~/.atria/skill-packs/<agente>/skills/<nome>, passado nas execuções
// daquele agente via `plugins` — os outros agentes não carregam o pacote.
// A cópia baixada fica em ~/.atria/skills-lib/<nome>; o registro em kv `skills_installed`.

const SITE = 'https://www.skills.sh';
const API = 'https://skills.sh/api';
const UA = 'Mozilla/5.0 (AtriaOS skills)';
const MAX_FILES = 300;
const MAX_BYTES = 5 * 1024 * 1024;

const atriaHome = () => join(homedir(), '.atria');
export const libDir = () => join(atriaHome(), 'skills-lib');
export const packDir = (agentId: string) => join(atriaHome(), 'skill-packs', agentId);
export const platformDir = () => join(homedir(), '.claude', 'skills');

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SOURCE_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const validName = (n: string) => NAME_RE.test(n) && !n.includes('..');
export const isGithubSource = (s: string) => SOURCE_RE.test(s) && !s.includes('..');

// ---------- registro ----------

export function listInstalled(): InstalledSkill[] {
  try {
    const raw = kvGet('skills_installed');
    const list = raw ? (JSON.parse(raw) as InstalledSkill[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function saveInstalled(list: InstalledSkill[]) {
  kvSet('skills_installed', JSON.stringify(list));
}
export const agentSkills = (agentId: string) => listInstalled().filter((s) => s.scope === 'agents' && s.agents.includes(agentId));

// ---------- skills.sh ----------

const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttlMs) return c.data as T;
  try {
    const data = await fn();
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (c) return c.data as T; // falhou: devolve o último bom
    throw e;
  }
}

async function getText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const r = await fetch(url, { headers: { 'user-agent': UA, ...headers }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.text();
}

// O HTML do ranking embute os objetos das skills no payload do Next (aspas escapadas).
export function parseLeaderboard(html: string): { skills: HubSkill[]; total: number | null } {
  const out: HubSkill[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/\{\\"source\\":[^{}]*\}/g)) {
    try {
      const o = JSON.parse(m[0].replace(/\\"/g, '"')) as Record<string, unknown>;
      const source = String(o.source ?? ''), skillId = String(o.skillId ?? '');
      if (!source || !skillId || seen.has(`${source}/${skillId}`)) continue;
      seen.add(`${source}/${skillId}`);
      out.push({
        source,
        skillId,
        name: String(o.name ?? skillId),
        installs: Number(o.installs) || 0,
        ...(Array.isArray(o.weeklyInstalls) ? { weekly: (o.weeklyInstalls as unknown[]).map(Number) } : {}),
        ...(typeof o.change === 'number' ? { change: o.change } : {}),
        ...(o.isOfficial === true ? { official: true } : {}),
      });
    } catch {
      /* objeto truncado: ignora */
    }
  }
  const t = html.match(/All Time \(([\d,.]+)\)/);
  return { skills: out, total: t ? Number(t[1].replace(/[,.]/g, '')) : null };
}

export function leaderboard(view: SkillHubView) {
  const path = view === 'trending' ? '/trending' : view === 'hot' ? '/hot' : '/';
  return cached(`lb:${view}`, 3600_000, async () => parseLeaderboard(await getText(SITE + path)));
}

export function searchHub(q: string): Promise<HubSkill[]> {
  const query = q.trim().slice(0, 80);
  if (query.length < 2) return Promise.resolve([]);
  return cached(`q:${query.toLowerCase()}`, 600_000, async () => {
    const r = JSON.parse(await getText(`${API}/search?q=${encodeURIComponent(query)}&limit=60`)) as { skills?: Record<string, unknown>[] };
    return (r.skills ?? []).map((s) => ({ source: String(s.source), skillId: String(s.skillId), name: String(s.name ?? s.skillId), installs: Number(s.installs) || 0 }));
  });
}

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function parseDetailPage(html: string): { description: string; audits: SkillAudit[] } {
  const d = html.match(/<meta name="description" content="([^"]*)"/);
  const audits: SkillAudit[] = [];
  for (const m of html.matchAll(/truncate">([^<]{2,60})<\/span><span class="text-xs font-mono uppercase[^"]*">([A-Za-z]+)<\/span>/g)) {
    const r = m[2].toLowerCase();
    if (audits.some((a) => a.name === m[1])) continue;
    audits.push({ name: decode(m[1]), result: r === 'pass' || r === 'warn' || r === 'fail' ? r : 'unknown' });
  }
  return { description: d ? decode(d[1]) : '', audits };
}

// ---------- GitHub ----------

let ghToken: Promise<string | null> | null = null;
function githubToken(): Promise<string | null> {
  ghToken ??= promisify(execFile)('gh', ['auth', 'token'], { timeout: 5000 })
    .then((r) => r.stdout.trim() || null)
    .catch(() => null);
  return ghToken;
}

interface TreeEntry { path: string; type: 'blob' | 'tree' | 'commit'; sha: string; size?: number }

async function repoTree(source: string): Promise<{ sha: string; tree: TreeEntry[] }> {
  const token = await githubToken();
  const r = await fetch(`https://api.github.com/repos/${source}/git/trees/HEAD?recursive=1`, {
    headers: { 'user-agent': UA, accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (r.status === 404) throw new Error(`repositório ${source} não encontrado no GitHub`);
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status} para ${source}`);
  return (await r.json()) as { sha: string; tree: TreeEntry[] };
}

const raw = (source: string, path: string) => getText(`https://raw.githubusercontent.com/${source}/HEAD/${path.split('/').map(encodeURIComponent).join('/')}`);

export function frontmatterName(md: string): string | null {
  const fm = md.match(/^---\s*\n([\s\S]*?)\n---/);
  const n = fm?.[1].match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m);
  return n ? n[1].trim() : null;
}

// Pasta da skill dentro do repositório: a que tem SKILL.md com `name` = skillId (ou pasta = skillId).
export async function locateSkill(source: string, skillId: string, tree: TreeEntry[]): Promise<{ dir: string; md: string } | null> {
  const mds = tree.filter((t) => t.type === 'blob' && (t.path === 'SKILL.md' || t.path.endsWith('/SKILL.md')));
  const dirOf = (p: string) => (p === 'SKILL.md' ? '' : p.slice(0, -'/SKILL.md'.length));
  const base = (d: string) => d.split('/').pop() ?? '';
  const byDir = mds.filter((t) => base(dirOf(t.path)) === skillId).sort((a, b) => a.path.length - b.path.length);
  for (const t of byDir.slice(0, 3)) {
    const md = await raw(source, t.path);
    const n = frontmatterName(md);
    if (!n || n === skillId) return { dir: dirOf(t.path), md };
  }
  for (const t of mds.slice(0, 40)) {
    const md = await raw(source, t.path);
    if (frontmatterName(md) === skillId) return { dir: dirOf(t.path), md };
  }
  if (byDir[0]) return { dir: dirOf(byDir[0].path), md: await raw(source, byDir[0].path) };
  return null;
}

function skillFiles(tree: TreeEntry[], dir: string) {
  const prefix = dir ? `${dir}/` : '';
  // skill na raiz do repositório: não leva pastas de outras skills nem arquivos de infraestrutura
  return tree.filter((t) => t.type === 'blob' && t.path.startsWith(prefix) && !t.path.slice(prefix.length).split('/').some((seg) => seg === '..' || seg.startsWith('.git')));
}
const dirSha = (tree: TreeEntry[], rootSha: string, dir: string) => (dir ? tree.find((t) => t.type === 'tree' && t.path === dir)?.sha ?? rootSha : rootSha);

export function detail(source: string, skillId: string): Promise<HubSkillDetail> {
  return cached(`d:${source}/${skillId}`, 6 * 3600_000, async () => {
    const page = await getText(`${SITE}/${source}/${encodeURIComponent(skillId)}`).catch(() => '');
    const { description, audits } = parseDetailPage(page);
    const base: HubSkillDetail = { source, skillId, name: skillId, installs: 0, description, audits, skillMd: '', files: 0, bytes: 0, installable: false };
    if (!isGithubSource(source)) return { ...base, reason: 'Esta skill não vem de um repositório GitHub; a instalação automática ainda não cobre esse caso.' };
    try {
      const { tree } = await repoTree(source);
      const loc = await locateSkill(source, skillId, tree);
      if (!loc) return { ...base, reason: 'Não achei o SKILL.md dessa skill no repositório.' };
      const files = skillFiles(tree, loc.dir);
      const bytes = files.reduce((n, f) => n + (f.size ?? 0), 0);
      const tooBig = files.length > MAX_FILES || bytes > MAX_BYTES;
      return {
        ...base,
        name: frontmatterName(loc.md) ?? skillId,
        description: description || (loc.md.match(/^description:\s*(.+)$/m)?.[1] ?? '').replace(/^["']|["']$/g, ''),
        skillMd: loc.md,
        files: files.length,
        bytes,
        installable: !tooBig,
        ...(tooBig ? { reason: `Skill grande demais (${files.length} arquivos, ${Math.round(bytes / 1024)} KB).` } : {}),
      };
    } catch (e) {
      return { ...base, reason: (e as Error).message };
    }
  });
}

// ---------- instalação ----------

function atomicCopy(src: string, dest: string) {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  cpSync(src, tmp, { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  renameSync(tmp, dest);
}

function ensurePack(agentId: string) {
  const manifest = join(packDir(agentId), '.claude-plugin', 'plugin.json');
  if (existsSync(manifest)) return;
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(manifest, `${JSON.stringify({ name: `atria-${agentId}`, version: '1.0.0', description: `Skills do agente ${agentId} instaladas pelo Atria OS (skills.sh)` }, null, 2)}\n`);
}

function removePlacements(s: InstalledSkill) {
  rmSync(join(platformDir(), s.name), { recursive: true, force: true });
  for (const a of s.agents) rmSync(join(packDir(a), 'skills', s.name), { recursive: true, force: true });
}

function applyPlacements(s: InstalledSkill) {
  const src = join(libDir(), s.name);
  if (s.scope === 'platform') atomicCopy(src, join(platformDir(), s.name));
  else
    for (const a of s.agents) {
      ensurePack(a);
      atomicCopy(src, join(packDir(a), 'skills', s.name));
    }
}

async function download(source: string, files: TreeEntry[], dir: string, dest: string) {
  const prefix = dir ? `${dir}/` : '';
  const tmp = `${dest}.dl-${process.pid}-${Date.now()}`;
  try {
    for (const f of files) {
      const rel = f.path.slice(prefix.length);
      const token = await githubToken();
      const r = await fetch(`https://raw.githubusercontent.com/${source}/HEAD/${f.path.split('/').map(encodeURIComponent).join('/')}`, {
        headers: { 'user-agent': UA, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) throw new Error(`falha ao baixar ${rel} (HTTP ${r.status})`);
      const out = join(tmp, rel);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    }
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(tmp, dest);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Nome livre: não pisa em skill de outra origem nem nas do Claude/plugins já presentes.
function pickName(wanted: string, source: string, existing: InstalledSkill[]): string {
  const clean = wanted.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64) || 'skill';
  const mine = existing.find((s) => s.name === clean);
  if (mine && mine.source === source) return clean;
  const taken = (n: string) => existing.some((s) => s.name === n) || (!mine && existsSync(join(platformDir(), n)));
  if (!taken(clean)) return clean;
  const owner = source.split('/')[0].toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const alt = `${clean}-${owner}`.slice(0, 64);
  return taken(alt) ? `${alt.slice(0, 58)}-${Date.now().toString(36).slice(-5)}` : alt;
}

export interface InstallInput {
  source: string;
  skillId: string;
  scope: 'platform' | 'agents';
  agents?: string[];
}

let onPlatformChange: () => void = () => {};
export function setPlatformChangeHook(fn: () => void) {
  onPlatformChange = fn;
}

const queue: { p: Promise<unknown> } = { p: Promise.resolve() };
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = queue.p.then(fn, fn);
  queue.p = next.catch(() => {});
  return next;
};

function resolveAgents(ids: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of ids ?? []) {
    const a = findAgent(String(raw)) ?? loadAllAgents().find((x) => x.id === raw);
    if (!a) throw new Error(`agente "${raw}" não existe`);
    if (!out.includes(a.id)) out.push(a.id);
  }
  return out;
}

export function installSkill(input: InstallInput): Promise<InstalledSkill> {
  return serial(async () => {
    const source = String(input.source ?? '').trim();
    const skillId = String(input.skillId ?? '').trim();
    if (!isGithubSource(source)) throw new Error('origem inválida: use dono/repositório do GitHub');
    if (!skillId || skillId.length > 120 || /[/\\]|\.\./.test(skillId)) throw new Error('skill inválida');
    const scope = input.scope === 'agents' ? 'agents' : 'platform';
    const agents = scope === 'agents' ? resolveAgents(input.agents) : [];
    if (scope === 'agents' && !agents.length) throw new Error('escolha pelo menos um agente');

    const { sha: rootSha, tree } = await repoTree(source);
    const loc = await locateSkill(source, skillId, tree);
    if (!loc) throw new Error('não achei o SKILL.md dessa skill no repositório');
    const files = skillFiles(tree, loc.dir);
    const bytes = files.reduce((n, f) => n + (f.size ?? 0), 0);
    if (files.length > MAX_FILES || bytes > MAX_BYTES) throw new Error(`skill grande demais (${files.length} arquivos, ${Math.round(bytes / 1024)} KB)`);

    const list = listInstalled();
    const prev = list.find((s) => s.source === source && s.skillId === skillId);
    const name = prev?.name ?? pickName(frontmatterName(loc.md) ?? skillId, source, list);
    if (!validName(name)) throw new Error(`nome de skill inválido: ${name}`);

    await download(source, files, loc.dir, join(libDir(), name));
    const info = await detail(source, skillId).catch(() => null);
    const rec: InstalledSkill = {
      name,
      source,
      skillId,
      scope,
      agents,
      description: info?.description ?? '',
      treeSha: dirSha(tree, rootSha, loc.dir),
      audits: info?.audits ?? [],
      installedAt: prev?.installedAt ?? now(),
      ...(prev ? { updatedAt: now() } : {}),
    };
    if (prev) removePlacements(prev);
    applyPlacements(rec);
    saveInstalled([...list.filter((s) => s !== prev), rec]);
    if (scope === 'platform' || prev?.scope === 'platform') onPlatformChange();
    return rec;
  });
}

// Muda o alcance sem baixar de novo (plataforma ⇄ agentes).
export function setScope(name: string, scope: 'platform' | 'agents', agentIds: string[] = []): InstalledSkill {
  const list = listInstalled();
  const s = list.find((x) => x.name === name);
  if (!s) throw new Error('skill não instalada');
  const agents = scope === 'agents' ? resolveAgents(agentIds) : [];
  if (scope === 'agents' && !agents.length) throw new Error('escolha pelo menos um agente');
  const wasPlatform = s.scope === 'platform';
  removePlacements(s);
  const rec = { ...s, scope, agents, updatedAt: now() };
  applyPlacements(rec);
  saveInstalled(list.map((x) => (x === s ? rec : x)));
  if (wasPlatform || scope === 'platform') onPlatformChange();
  return rec;
}

// Remove de um agente só (`agentId`) ou de tudo.
export function uninstallSkill(name: string, agentId?: string): { removed: boolean; left: InstalledSkill | null } {
  const list = listInstalled();
  const s = list.find((x) => x.name === name);
  if (!s) return { removed: false, left: null };
  if (agentId && s.scope === 'agents' && s.agents.length > 1) {
    rmSync(join(packDir(agentId), 'skills', s.name), { recursive: true, force: true });
    const rec = { ...s, agents: s.agents.filter((a) => a !== agentId) };
    saveInstalled(list.map((x) => (x === s ? rec : x)));
    return { removed: true, left: rec };
  }
  removePlacements(s);
  rmSync(join(libDir(), s.name), { recursive: true, force: true });
  saveInstalled(list.filter((x) => x !== s));
  if (s.scope === 'platform') onPlatformChange();
  return { removed: true, left: null };
}

export async function checkUpdates(): Promise<InstalledSkill[]> {
  const list = listInstalled();
  const trees = new Map<string, { sha: string; tree: TreeEntry[] }>();
  for (const s of list) {
    try {
      if (!trees.has(s.source)) trees.set(s.source, await repoTree(s.source));
      const { sha, tree } = trees.get(s.source)!;
      const loc = await locateSkill(s.source, s.skillId, tree);
      s.updateAvailable = !!loc && dirSha(tree, sha, loc.dir) !== s.treeSha;
    } catch {
      /* sem rede ou repositório sumiu: mantém o estado anterior */
    }
  }
  // grava sobre a lista atual para não perder instalações feitas durante a checagem
  const cur = listInstalled();
  saveInstalled(cur.map((c) => {
    const u = list.find((s) => s.name === c.name);
    return u && u.updateAvailable !== undefined ? { ...c, updateAvailable: u.updateAvailable } : c;
  }));
  kvSet('skills_checked_at', now());
  return listInstalled();
}

// Agente excluído: some do registro e o pacote dele vai embora (arquivado continua).
export function pruneAgents() {
  const ids = new Set(loadAllAgents().map((a) => a.id));
  const list = listInstalled();
  let changed = false;
  const next: InstalledSkill[] = [];
  for (const s of list) {
    if (s.scope !== 'agents') {
      next.push(s);
      continue;
    }
    const keep = s.agents.filter((a) => ids.has(a));
    if (keep.length === s.agents.length) next.push(s);
    else {
      changed = true;
      if (keep.length) next.push({ ...s, agents: keep });
      else rmSync(join(libDir(), s.name), { recursive: true, force: true });
    }
  }
  const packs = join(atriaHome(), 'skill-packs');
  if (existsSync(packs)) for (const d of readdirSync(packs)) if (!ids.has(d)) rmSync(join(packs, d), { recursive: true, force: true });
  if (changed) saveInstalled(next);
}

// Referência colada pelo usuário: URL do skills.sh, do GitHub ou `npx skills add dono/repo --skill x`.
export function parseRef(text: string): { source: string; skillId: string } | null {
  const t = text.trim();
  const sk = t.match(/--skill[= ]+([^\s]+)/)?.[1];
  const gh = t.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:[/\s]|$)/)?.[1];
  if (gh && sk) return { source: gh, skillId: sk };
  const ss = t.match(/skills\.sh\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/([A-Za-z0-9_.:-]+)/);
  if (ss) return { source: ss[1], skillId: ss[2] };
  const add = t.match(/(?:add\s+)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\s+--skill/);
  if (add && sk) return { source: add[1], skillId: sk };
  const short = t.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/([A-Za-z0-9_.:-]+)$/);
  if (short) return { source: short[1], skillId: short[2] };
  return null;
}

// ---------- rotas, execuções e Yui ----------

const err = (e: unknown) => ({ error: (e as Error).message });

export function register(app: FastifyInstance): void {
  app.get('/api/skills/catalog', async (req, reply) => {
    const v = String((req.query as { view?: string }).view ?? 'all');
    const view: SkillHubView = v === 'trending' || v === 'hot' ? v : 'all';
    try {
      return await leaderboard(view);
    } catch (e) {
      return reply.code(502).send(err(e));
    }
  });
  app.get('/api/skills/search', async (req, reply) => {
    try {
      return { skills: await searchHub(String((req.query as { q?: string }).q ?? '')) };
    } catch (e) {
      return reply.code(502).send(err(e));
    }
  });
  app.get('/api/skills/detail', async (req, reply) => {
    const q = req.query as { source?: string; skill?: string };
    if (!q.source || !q.skill) return reply.code(400).send({ error: 'source e skill obrigatórios' });
    try {
      return await detail(q.source, q.skill);
    } catch (e) {
      return reply.code(502).send(err(e));
    }
  });
  app.post('/api/skills/resolve', async (req, reply) => {
    const r = parseRef(String((req.body as { text?: string })?.text ?? ''));
    return r ?? reply.code(400).send({ error: 'Não reconheci o link. Use a URL do skills.sh ou "dono/repo --skill nome".' });
  });
  app.get('/api/skills/installed', async () => {
    pruneAgents();
    return { skills: listInstalled(), checkedAt: kvGet('skills_checked_at') };
  });
  app.post('/api/skills/install', async (req, reply) => {
    try {
      return await installSkill(req.body as InstallInput);
    } catch (e) {
      return reply.code(400).send(err(e));
    }
  });
  app.put('/api/skills/:name/scope', async (req, reply) => {
    const b = req.body as { scope?: string; agents?: string[] };
    try {
      return setScope((req.params as { name: string }).name, b?.scope === 'agents' ? 'agents' : 'platform', b?.agents ?? []);
    } catch (e) {
      return reply.code(400).send(err(e));
    }
  });
  app.post('/api/skills/:name/update', async (req, reply) => {
    const s = listInstalled().find((x) => x.name === (req.params as { name: string }).name);
    if (!s) return reply.code(404).send({ error: 'skill não instalada' });
    try {
      return await installSkill({ source: s.source, skillId: s.skillId, scope: s.scope, agents: s.agents });
    } catch (e) {
      return reply.code(400).send(err(e));
    }
  });
  app.post('/api/skills/check-updates', async () => ({ skills: await checkUpdates(), checkedAt: kvGet('skills_checked_at') }));
  app.delete('/api/skills/:name', async (req, reply) => {
    const agent = (req.query as { agent?: string }).agent;
    const r = uninstallSkill((req.params as { name: string }).name, agent || undefined);
    return r.removed ? reply.code(200).send(r) : reply.code(404).send({ error: 'skill não instalada' });
  });

  // Pacote do agente entra só nas execuções dele.
  registerAgentOptions((agentId) => {
    if (!agentSkills(agentId).length || !existsSync(join(packDir(agentId), '.claude-plugin', 'plugin.json'))) return {};
    return { plugins: [{ type: 'local' as const, path: packDir(agentId) }] };
  });
  registerRunPrompt(({ agentId }) => {
    const mine = agentSkills(agentId);
    if (!mine.length) return null;
    return `- Skills instaladas só para você (skills.sh; também valem se a lista acima restringir): ${mine.map((s) => `atria-${agentId}:${s.name}`).join(', ')}. Use via Skill quando a tarefa pedir.`;
  });

  registerBrain({
    name: 'skills-hub',
    tools: [
      {
        type: 'function',
        name: 'skills_buscar',
        strict: true,
        description: 'Busca skills (conhecimento pronto para o Claude) no skills.sh. Devolve origem, nome, instalações e se já está instalada.',
        parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', description: 'assunto em inglês de preferência (ex.: tdd, react, seo, pdf)' } } },
      },
      {
        type: 'function',
        name: 'skill_instalar',
        strict: true,
        description: 'Instala uma skill do skills.sh na plataforma toda ou só em agentes escolhidos. Pede aprovação ao usuário no modal; só instala se ele aprovar.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['source', 'skill', 'escopo', 'agentes'],
          properties: {
            source: { type: 'string', description: 'dono/repositório, como veio de skills_buscar' },
            skill: { type: 'string', description: 'skillId, como veio de skills_buscar' },
            escopo: { type: 'string', enum: ['plataforma', 'agentes'] },
            agentes: { type: 'array', items: { type: 'string' }, description: 'ids ou nomes dos agentes quando escopo = agentes; [] para plataforma' },
          },
        },
      },
      {
        type: 'function',
        name: 'open_skills',
        strict: true,
        description: 'Abre a loja de skills (skills.sh) no painel.',
        parameters: { type: 'object', additionalProperties: false, required: ['tab'], properties: { tab: { type: 'string', enum: ['all', 'trending', 'hot', 'installed'] } } },
      },
    ],
    run(tool, args, ctx) {
      if (tool === 'skills_buscar') {
        if (ctx.dryRun) return Promise.resolve({ ok: true, skills: [] });
        const inst = listInstalled();
        return searchHub(String(args.query ?? '')).then((list) =>
          list.slice(0, 8).map((s) => {
            const i = inst.find((x) => x.source === s.source && x.skillId === s.skillId);
            return { source: s.source, skill: s.skillId, instalacoes: s.installs, instalada: i ? (i.scope === 'platform' ? 'plataforma' : i.agents.join(', ')) : null };
          }),
        );
      }
      if (tool === 'skill_instalar') {
        if (ctx.dryRun) return Promise.resolve({ ok: true, status: 'aguardando_aprovacao' });
        const source = String(args.source ?? ''), skill = String(args.skill ?? '');
        const scope = args.escopo === 'agentes' ? 'agents' : 'platform';
        let agents: string[] = [];
        try {
          if (!isGithubSource(source)) throw new Error('origem não é um repositório GitHub (dono/repo)');
          if (scope === 'agents') agents = resolveAgents((args.agentes as string[]) ?? []);
          if (scope === 'agents' && !agents.length) throw new Error('diga em quais agentes instalar');
        } catch (e) {
          return Promise.resolve({ ok: false, error: (e as Error).message });
        }
        const where = scope === 'platform' ? 'plataforma toda (Yui e todos os agentes)' : agents.map((a) => findAgent(a)?.name ?? a).join(', ');
        const say = (t: string) => import('./live.ts').then(({ narrate }) => narrate(t, { speak: true })).catch(() => {});
        void detail(source, skill)
          .catch(() => null)
          .then((d) =>
            askApproval(`skills:install:${source}/${skill}`, `Instalar a skill "${skill}"?`, [
              { label: 'Origem', value: `${source} (skills.sh)` },
              { label: 'Onde', value: where },
              ...(d?.description ? [{ label: 'O que ensina', value: d.description.slice(0, 200) }] : []),
              ...(d?.audits.length ? [{ label: 'Auditorias', value: d.audits.map((a) => `${a.name}: ${a.result}`).join(' · '), tone: d.audits.some((a) => a.result === 'fail') ? ('crit' as const) : d.audits.some((a) => a.result === 'warn') ? ('warn' as const) : ('ok' as const) }] : []),
            ]),
          )
          .then(async (ok) => {
            if (!ok) return say(`Ok, não instalei a skill ${skill}.`);
            try {
              const r = await installSkill({ source, skillId: skill, scope, agents });
              await say(`Skill ${r.name} instalada em ${scope === 'platform' ? 'toda a plataforma' : where}.`);
            } catch (e) {
              await say(`Não consegui instalar a skill ${skill}: ${(e as Error).message}.`);
            }
          });
        return Promise.resolve({ ok: true, status: 'aguardando_aprovacao', skill, onde: where, aviso: 'Nada foi instalado ainda: só instala se o usuário aprovar no modal.' });
      }
      if (tool === 'open_skills') {
        if (ctx.dryRun) return Promise.resolve({ ok: true });
        return import('./bus.ts').then(({ emit }) => {
          emit({ type: 'ui.action', action: { type: 'show_view', view: 'skills', params: { tab: String(args.tab) } } });
          return { ok: true };
        });
      }
      return undefined;
    },
    snapshot() {
      const list = listInstalled();
      if (!list.length) return '';
      return `Skills do skills.sh instaladas: ${list.map((s) => `${s.name} (${s.scope === 'platform' ? 'plataforma' : s.agents.join('/')})`).join('; ')}.`;
    },
    instructions: [
      '- Skills (skills.sh) ensinam o Claude a fazer algo melhor. "Instala/ensina a skill X (no agente Y)" => skills_buscar e depois skill_instalar (abre aprovação; não diga que instalou antes do usuário aprovar). "Mostra as skills/loja de skills" => open_skills.',
    ].join('\n'),
  });
}
