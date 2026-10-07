import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config } from './config.ts';
import { activeProject, ensureProject, findProject } from './projects.ts';
import { claudeEnv } from './runs.ts';
import { trustDirs } from './trust.ts';

// Terminal web: sessões tmux persistentes no container (fechar a aba só desanexa).
// kind=claude abre o Claude Code interativo no projeto; kind=shell abre bash.

const run = promisify(execFile);

export function initTerminal() {
  const home = process.env.HOME ?? '/data/home';
  writeFileSync(
    join(home, '.tmux.conf'),
    ['set -g mouse on', 'set -g history-limit 20000', 'set -g status off', 'set -g default-terminal "xterm-256color"', 'set -g escape-time 10', 'set -g set-clipboard on'].join('\n') + '\n',
  );
}

const sessionName = (kind: string, slug: string) => `atria-${kind}-${slug}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60);

async function listSessions(): Promise<{ name: string; created: string; attached: boolean }[]> {
  const out = await run('tmux', ['ls', '-F', '#{session_name}\t#{session_created}\t#{session_attached}']).then((r) => r.stdout).catch(() => '');
  return out
    .split('\n')
    .filter((l) => l.startsWith('atria-'))
    .map((l) => {
      const [name, created, attached] = l.split('\t');
      return { name, created: new Date(Number(created) * 1000).toISOString(), attached: attached !== '0' };
    });
}

export function registerTerminal(app: FastifyInstance) {
  app.get('/api/terminal', { websocket: true }, async (socket, req) => {
    const origin = req.headers.origin;
    if (origin && config.domain !== 'localhost' && origin !== `https://${config.domain}`) {
      socket.close(4403, 'origin');
      return;
    }
    const q = req.query as { kind?: string; project?: string; cols?: string; rows?: string };
    const kind = q.kind === 'shell' ? 'shell' : 'claude';
    const found = findProject(q.project || activeProject());
    const project = found ? await ensureProject(found).catch(() => found) : undefined;
    const dir = project?.cloned ? project.dir : config.workspaceDir;
    const slug = project?.cloned ? project.slug : 'workspace';
    const name = sessionName(kind, slug);
    trustDirs([dir]);
    // Ao sair do Claude a sessão cai num bash, para não fechar o terminal na sua cara.
    const cmd = kind === 'claude' ? 'claude; exec bash -l' : 'exec bash -l';
    const pty = (await import('node-pty')).default; // nativo: só carrega quando um terminal abre
    const term = pty.spawn('tmux', ['new-session', '-A', '-s', name, '-c', dir, 'bash', '-lc', cmd], {
      name: 'xterm-256color',
      cols: Math.max(20, Math.min(400, Number(q.cols) || 120)),
      rows: Math.max(5, Math.min(200, Number(q.rows) || 32)),
      cwd: dir,
      env: { ...claudeEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'C.UTF-8' },
    });

    term.onData((d) => {
      if (socket.readyState === socket.OPEN) socket.send(d);
    });
    term.onExit(() => {
      if (socket.readyState === socket.OPEN) socket.close(1000, 'exit');
    });
    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      const s = raw.toString('utf8');
      if (!isBinary && s.startsWith('{"type":"resize"')) {
        try {
          const { cols, rows } = JSON.parse(s) as { cols: number; rows: number };
          term.resize(Math.max(20, Math.min(400, cols | 0)), Math.max(5, Math.min(200, rows | 0)));
        } catch {
          /* ignora */
        }
        return;
      }
      term.write(s);
    });
    // Fechar o WebSocket só desanexa o cliente tmux; a sessão segue viva.
    socket.on('close', () => term.kill());
  });

  app.get('/api/terminal/sessions', () => listSessions());

  app.delete('/api/terminal/sessions/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!name.startsWith('atria-')) return reply.code(400).send({ error: 'name' });
    await run('tmux', ['kill-session', '-t', name]).catch(() => {});
    return reply.code(204).send();
  });
}
