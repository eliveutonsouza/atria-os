// Executor real: roda o comando sem shell, com tempo limite e saída limitada. Ambiente mínimo: o compose
// interpola só o .env do projeto (variáveis deste container, como ATRIA_VERSION, não vazam para lá).
import { spawn } from 'node:child_process';
import type { Exec } from './updater.ts';

const MAX_OUT = 64 * 1024;

export const exec: Exec = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/root' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 600_000);
    child.stdout.on('data', (c: Buffer) => { if (stdout.length < MAX_OUT) stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { if (stderr.length < MAX_OUT) stderr += c.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, stdout, stderr: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
    child.stdin.end(opts.input ?? '');
  });
