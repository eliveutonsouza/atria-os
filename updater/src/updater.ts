// Lógica do atualizador: troca ATRIA_TAG no .env do compose, puxa as imagens, recria atria/atria-code,
// espera ficar saudável e volta para a tag anterior se não ficar. Os comandos passam por um executor
// injetável (Exec) para os testes rodarem sem Docker.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
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
const APP_SERVICES = ['atria', 'atria-code'];
const SELF_SERVICE = 'atria-updater';

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
