// Lógica do atualizador: troca os arquivos do compose pelos da versão nova (vêm na imagem atria-updater:<tag>),
// troca ATRIA_TAG no .env, puxa as imagens, recria atria/atria-code/atria-browser, espera ficar saudável e
// volta para a tag e os arquivos anteriores se não ficar. Os comandos passam por um executor
// injetável (Exec) para os testes rodarem sem Docker.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface ExecResult { code: number; stdout: string; stderr: string }
export type Exec = (cmd: string, args: string[], opts?: { input?: string; cwd?: string; timeoutMs?: number }) => Promise<ExecResult>;

export type JobResult = 'done' | 'rolled_back' | 'failed';
export interface Job {
  commandId: string;
  jobId: string;
  tag: string;
  fromTag: string | null;
  startedAt: string;
  finishedAt: string | null;
  result: JobResult | null;
  error: string | null;
  reported: boolean;
}
export interface Status {
  status: 'ready' | 'busy' | 'error';
  tag: string | null;
  previousTag: string | null;
  step: string | null;
  version: string;
  job: Job | null;
}
interface State { previousTag: string | null; step: string | null; job: Job | null }

export const TAG_RE = /^v\d+\.\d+\.\d+$/;
// Serviços que a atualização troca de imagem. O próprio atualizador vem por último, por um container auxiliar.
const APP_SERVICES = ['atria', 'atria-code', 'atria-browser'];
const SELF_SERVICE = 'atria-updater';
// Pasta da imagem do atualizador com os arquivos do compose da versão (docker-compose*.yml, Caddyfile, browser/…).
const IMAGE_STACK = '/app/stack';
// Nunca vêm da imagem: são da instalação.
const KEEP_LOCAL = new Set(['.env', '.env.central', '.git']);

export interface UpdaterOptions {
  stackDir: string; // diretório do compose no host, montado no mesmo caminho
  project: string; // nome do projeto compose (ATRIA_PROJECT)
  statePath: string;
  version: string; // versão deste atualizador (ATRIA_VERSION da imagem)
  exec: Exec;
  healthTimeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (msg: string) => void;
  ownStackDir?: string; // arquivos do compose que ESTA imagem carrega (padrão /app/stack)
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Lê uma chave do .env sem executar o arquivo (aceita valor entre aspas simples ou duplas).
export function envGet(text: string, key: string): string | null {
  let val: string | null = null;
  for (const line of text.split('\n')) {
    if (!line.startsWith(key + '=')) continue;
    val = line.slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return val;
}
// Grava/remove uma chave preservando o resto do arquivo (null remove a linha).
export function envSet(text: string, key: string, value: string | null): string {
  const line = `${key}=${value}`;
  const out: string[] = [];
  let placed = false;
  for (const l of text.split('\n')) {
    if (!l.startsWith(key + '=')) { out.push(l); continue; }
    if (value !== null && !placed) { out.push(line); placed = true; }
  }
  if (value !== null && !placed) {
    if (out.length && out[out.length - 1] === '') out.splice(out.length - 1, 0, line);
    else out.push(line);
  }
  return out.join('\n');
}

export class Updater {
  readonly opts: Required<Omit<UpdaterOptions, 'log'>> & { log: (msg: string) => void };
  state: State;
  // promessa do job em andamento (os testes esperam por ela)
  running: Promise<void> | null = null;

  constructor(o: UpdaterOptions) {
    this.opts = {
      healthTimeoutMs: 180_000,
      ownStackDir: IMAGE_STACK,
      pollMs: 3000,
      sleep: realSleep,
      now: () => new Date(),
      log: (m) => console.log(`[updater] ${m}`),
      ...o,
    };
    this.state = this.load();
    // Reiniciou no meio de um job (container morto, VPS reiniciada): não dá para saber onde parou.
    const j = this.state.job;
    if (j && j.result === null) {
      j.result = 'failed';
      j.error = 'o atualizador reiniciou no meio da atualização';
      j.finishedAt = this.iso();
      this.state.step = null;
      this.save();
    }
  }

  get envPath() { return join(this.opts.stackDir, '.env'); }
  // Cópia dos arquivos do compose de antes do job (para o rollback); fica junto do estado, fora da pasta da stack.
  get stackBackupDir() { return join(dirname(this.opts.statePath), 'stack-backup'); }
  private iso() { return this.opts.now().toISOString(); }

  private load(): State {
    try {
      const s = JSON.parse(readFileSync(this.opts.statePath, 'utf8')) as Partial<State>;
      return { previousTag: s.previousTag ?? null, step: s.step ?? null, job: s.job ?? null };
    } catch {
      return { previousTag: null, step: null, job: null };
    }
  }
  private save() {
    mkdirSync(dirname(this.opts.statePath), { recursive: true });
    const tmp = this.opts.statePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.opts.statePath);
  }

  private readEnv(): string { return readFileSync(this.envPath, 'utf8'); }
  // Escreve no próprio arquivo (mantém dono e permissão 600 do .env).
  private writeTag(tag: string | null) { writeFileSync(this.envPath, envSet(this.readEnv(), 'ATRIA_TAG', tag)); }
  currentTag(): string | null {
    try { return envGet(this.readEnv(), 'ATRIA_TAG') || null; } catch { return null; }
  }

  status(): Status {
    const busy = this.running !== null;
    const broken = !existsSync(this.envPath) || this.state.job?.result === 'failed';
    return {
      status: busy ? 'busy' : broken ? 'error' : 'ready',
      tag: this.currentTag(),
      previousTag: this.state.previousTag,
      step: this.state.step,
      version: this.opts.version,
      job: this.state.job,
    };
  }

  ack(commandId: string): boolean {
    const j = this.state.job;
    if (!j || j.commandId !== commandId) return false;
    j.reported = true;
    this.save();
    return true;
  }

  // 'accepted' | 'busy' | 'invalid'. O trabalho segue em segundo plano (this.running).
  start(input: { tag: unknown; commandId: unknown; jobId: unknown }): 'accepted' | 'busy' | 'invalid' {
    const { tag, commandId, jobId } = input;
    if (typeof tag !== 'string' || !TAG_RE.test(tag)) return 'invalid';
    if (typeof commandId !== 'string' || !commandId || commandId.length > 100) return 'invalid';
    if (jobId !== undefined && jobId !== null && (typeof jobId !== 'string' || jobId.length > 100)) return 'invalid';
    if (this.running) return 'busy';
    if (!existsSync(this.envPath)) return 'invalid';
    const fromTag = this.currentTag();
    this.state.previousTag = fromTag;
    this.state.job = { commandId, jobId: (jobId as string) || commandId, tag, fromTag, startedAt: this.iso(), finishedAt: null, result: null, error: null, reported: false };
    this.state.step = 'received';
    this.save();
    // backup de um job anterior não vale para este
    rmSync(this.stackBackupDir, { recursive: true, force: true });
    this.running = this.run(tag, fromTag).finally(() => { this.running = null; });
    return 'accepted';
  }

  private setStep(step: string | null) {
    this.state.step = step;
    this.save();
    if (step) this.opts.log(`etapa: ${step}`);
  }

  private compose(args: string[], timeoutMs = 600_000) {
    return this.opts.exec('docker', ['compose', '-p', this.opts.project, '--project-directory', this.opts.stackDir, ...args], { cwd: this.opts.stackDir, timeoutMs });
  }
  private async must(p: Promise<ExecResult>, what: string) {
    const r = await p;
    if (r.code !== 0) throw new Error(`${what}: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ').slice(0, 300)}`);
    return r;
  }

  private async login() {
    let text = '';
    try { text = this.readEnv(); } catch { /* sem .env: segue sem login */ }
    const user = envGet(text, 'GHCR_USER') || process.env.GHCR_USER || '';
    const token = envGet(text, 'GHCR_TOKEN') || process.env.GHCR_TOKEN || '';
    if (!user || !token) { this.opts.log('sem GHCR_USER/GHCR_TOKEN: usando o login que já existir'); return; }
    const host = (envGet(text, 'ATRIA_REGISTRY') || 'ghcr.io').split('/')[0];
    await this.must(this.opts.exec('docker', ['login', host, '-u', user, '--password-stdin'], { input: token, timeoutMs: 60_000 }), `docker login ${host}`);
  }

  // Espera o container do atria ficar healthy rodando a imagem da tag pedida; null = ok, senão o motivo.
  async waitHealthy(tag: string | null): Promise<string | null> {
    const name = `${this.opts.project}-atria-1`;
    const deadline = this.opts.now().getTime() + this.opts.healthTimeoutMs;
    for (;;) {
      const r = await this.opts.exec('docker', ['inspect', '-f', '{{.Config.Image}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', name], { timeoutMs: 15_000 });
      if (r.code === 0) {
        const [image, health] = r.stdout.trim().split('|');
        const right = !tag || image.endsWith(':' + tag);
        if (right && health === 'healthy') return null;
        if (right && health === 'unhealthy') return 'o healthcheck do atria falhou (unhealthy)';
      }
      if (this.opts.now().getTime() >= deadline) return `não ficou saudável em ${Math.round(this.opts.healthTimeoutMs / 1000)} s`;
      await this.opts.sleep(this.opts.pollMs);
    }
  }

  // Grava na pasta da stack os arquivos do compose que a imagem atria-updater:<tag> carrega, guardando os atuais
  // em stackBackupDir. Instalação a partir do código (.git) fica como está: quem cuida dos arquivos é o git.
  // Imagem sem os arquivos (versão antiga) → mantém os atuais. Devolve true se trocou algo.
  async syncStack(tag: string): Promise<boolean> {
    const dir = this.opts.stackDir;
    if (existsSync(join(dir, '.git'))) { this.opts.log('instalação a partir do código (.git): arquivos do compose ficam com o git'); return false; }
    this.setStep('stack');
    let registry = '';
    try { registry = envGet(this.readEnv(), 'ATRIA_REGISTRY') ?? ''; } catch { /* sem .env */ }
    const image = `${registry || 'ghcr.io/eliveutonsouza'}/atria-updater:${tag}`;
    await this.must(this.opts.exec('docker', ['pull', '-q', image], { timeoutMs: 600_000 }), `docker pull ${image}`);
    const created = await this.must(this.opts.exec('docker', ['create', image], { timeoutMs: 60_000 }), 'docker create');
    const cid = created.stdout.trim().split('\n').pop() ?? '';
    const tmp = mkdtempSync(join(tmpdir(), 'atria-stack-'));
    try {
      const cp = await this.opts.exec('docker', ['cp', '-q', `${cid}:${IMAGE_STACK}/.`, tmp], { timeoutMs: 120_000 });
      if (cp.code !== 0 || !this.applyStack(tmp)) { this.opts.log(`${image} não traz o compose: mantém os arquivos atuais`); return false; }
      this.opts.log(`arquivos do compose de ${tag} gravados`);
      return true;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await this.opts.exec('docker', ['rm', cid], { timeoutMs: 60_000 });
    }
  }

  // Copia os arquivos de src para a pasta da stack, guardando os atuais em stackBackupDir. false = src sem compose.
  private applyStack(src: string): boolean {
    const dir = this.opts.stackDir;
    const names = existsSync(src) ? readdirSync(src).filter((n) => !KEEP_LOCAL.has(n)) : [];
    if (!names.includes('docker-compose.yml')) return false;
    const backup = this.stackBackupDir;
    rmSync(backup, { recursive: true, force: true });
    mkdirSync(join(backup, 'files'), { recursive: true });
    const added: string[] = [];
    for (const n of names) {
      if (existsSync(join(dir, n))) cpSync(join(dir, n), join(backup, 'files', n), { recursive: true });
      else added.push(n);
    }
    writeFileSync(join(backup, 'added.json'), JSON.stringify(added));
    for (const n of names) {
      rmSync(join(dir, n), { recursive: true, force: true });
      cpSync(join(src, n), join(dir, n), { recursive: true });
    }
    return true;
  }

  // Ao subir: se a instalação já está na versão deste atualizador mas o compose da pasta é de outra versão
  // (a atualização foi feita por um atualizador antigo, que não trocava os arquivos), grava os desta imagem e
  // recria os serviços. Erro → volta os arquivos e sobe de novo como estava.
  async reconcileStack(): Promise<boolean> {
    const dir = this.opts.stackDir;
    const own = this.opts.ownStackDir;
    if (this.running || !TAG_RE.test(this.opts.version) || this.currentTag() !== this.opts.version) return false;
    if (existsSync(join(dir, '.git')) || !existsSync(join(own, 'docker-compose.yml'))) return false;
    let current = '';
    try { current = readFileSync(join(dir, 'docker-compose.yml'), 'utf8'); } catch { /* sem compose */ }
    if (current === readFileSync(join(own, 'docker-compose.yml'), 'utf8')) return false;
    const job = (async () => {
      this.opts.log(`compose da pasta difere do da ${this.opts.version}: atualizando os arquivos`);
      this.applyStack(own);
      try {
        await this.must(this.compose(['config', '-q'], 60_000), 'compose da versão inválido');
        await this.compose(['pull', ...APP_SERVICES]);
        await this.must(this.compose(['up', '-d', ...APP_SERVICES]), 'docker compose up');
        rmSync(this.stackBackupDir, { recursive: true, force: true });
        this.opts.log('arquivos do compose em dia');
      } catch (e) {
        this.opts.log(`falhou (${(e as Error).message}); voltando os arquivos anteriores`);
        this.restoreStack();
        await this.compose(['up', '-d', ...APP_SERVICES]);
      }
    })();
    this.running = job.finally(() => { this.running = null; });
    await this.running;
    return true;
  }

  // Volta os arquivos guardados por syncStack (e apaga os que a versão nova acrescentou).
  restoreStack() {
    const backup = this.stackBackupDir;
    if (!existsSync(join(backup, 'added.json'))) return;
    const dir = this.opts.stackDir;
    const added = JSON.parse(readFileSync(join(backup, 'added.json'), 'utf8')) as string[];
    for (const n of added) rmSync(join(dir, n), { recursive: true, force: true });
    for (const n of readdirSync(join(backup, 'files'))) {
      rmSync(join(dir, n), { recursive: true, force: true });
      cpSync(join(backup, 'files', n), join(dir, n), { recursive: true });
    }
    rmSync(backup, { recursive: true, force: true });
    this.opts.log('arquivos do compose anteriores restaurados');
  }

  private async deploy(tag: string | null, tolerantPull: boolean) {
    this.writeTag(tag);
    this.setStep('pulling');
    const pull = await this.compose(['pull', ...APP_SERVICES]);
    if (pull.code !== 0 && !tolerantPull) throw new Error(`docker compose pull: ${(pull.stderr || pull.stdout).trim().split('\n').slice(-2).join(' ').slice(0, 300)}`);
    this.setStep('restarting');
    await this.must(this.compose(['up', '-d', ...APP_SERVICES]), 'docker compose up');
    this.setStep('checking');
    return this.waitHealthy(tag);
  }

  private finish(result: JobResult, error: string | null) {
    const j = this.state.job!;
    j.result = result;
    j.error = error;
    j.finishedAt = this.iso();
    this.state.step = null;
    this.save();
    this.opts.log(`fim: ${result}${error ? ` (${error})` : ''}`);
  }

  private async run(tag: string, fromTag: string | null) {
    let error: string | null;
    try {
      this.setStep('login');
      await this.login();
      if (await this.syncStack(tag)) {
        // compose novo inválido com o .env desta instalação → nem tenta subir
        await this.must(this.compose(['config', '-q'], 60_000), 'compose da versão nova inválido');
      }
      error = await this.deploy(tag, false);
      if (!error) {
        this.finish('done', null);
        await this.selfUpdate().catch((e: Error) => this.opts.log(`autoatualização falhou: ${e.message}`));
        return;
      }
    } catch (e) {
      error = (e as Error).message;
    }
    this.opts.log(`falhou (${error}); voltando para ${fromTag ?? 'latest'}`);
    try {
      this.setStep('rolling_back');
      this.restoreStack();
      const again = await this.deploy(fromTag, true);
      if (!again) this.finish('rolled_back', error);
      else this.finish('failed', `${error}; a versão anterior também não subiu: ${again}`);
    } catch (e) {
      this.finish('failed', `${error}; rollback: ${(e as Error).message}`);
    }
  }

  // Se a imagem do atualizador mudou com a tag nova, um container auxiliar (da imagem nova, com o mesmo
  // socket e diretório) recria este serviço depois que esta resposta já foi gravada no estado.
  async selfUpdate() {
    const pull = await this.compose(['pull', SELF_SERVICE]);
    if (pull.code !== 0) { this.opts.log('imagem nova do atualizador indisponível; mantém a atual'); return; }
    const cfg = await this.must(this.compose(['config', '--format', 'json', SELF_SERVICE], 60_000), 'docker compose config');
    const image = (JSON.parse(cfg.stdout) as { services?: Record<string, { image?: string }> }).services?.[SELF_SERVICE]?.image;
    if (!image) return;
    const ps = await this.compose(['ps', '-q', SELF_SERVICE], 60_000);
    const cid = ps.stdout.trim().split('\n')[0];
    if (!cid) return;
    const running = await this.opts.exec('docker', ['inspect', '-f', '{{.Image}}', cid], { timeoutMs: 15_000 });
    const wanted = await this.opts.exec('docker', ['image', 'inspect', '-f', '{{.Id}}', image], { timeoutMs: 15_000 });
    if (running.code !== 0 || wanted.code !== 0 || running.stdout.trim() === wanted.stdout.trim()) return;
    this.setStep('self_update');
    const dir = this.opts.stackDir;
    const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    await this.must(this.opts.exec('docker', [
      'run', '--rm', '-d', '--name', `${this.opts.project}-updater-self-${Date.now()}`,
      '-v', '/var/run/docker.sock:/var/run/docker.sock', '-v', `${dir}:${dir}`, '-w', dir,
      '--entrypoint', 'sh', image, '-c', `sleep 3; docker compose -p ${q(this.opts.project)} --project-directory ${q(dir)} up -d ${SELF_SERVICE}`,
    ], { timeoutMs: 60_000 }), 'container auxiliar');
    this.setStep(null);
  }
}
