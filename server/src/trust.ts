import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';

// Pré-aceita o "Do you trust this folder?" do Claude Code para o workspace e cada projeto:
// os repositórios são do próprio usuário. Escreve em $HOME/.claude.json (projects[<dir>].hasTrustDialogAccepted).
export function trustDirs(dirs: string[]): void {
  const file = join(process.env.HOME ?? '/data/home', '.claude.json');
  let cfg: { projects?: Record<string, Record<string, unknown>> } = {};
  if (existsSync(file)) {
    try {
      cfg = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return; // arquivo sendo escrito pelo CLI agora; tenta de novo na próxima chamada
    }
  }
  cfg.projects ??= {};
  let changed = false;
  for (const dir of [config.workspaceDir, ...dirs]) {
    const p = (cfg.projects[dir] ??= {});
    if (p.hasTrustDialogAccepted !== true) {
      p.hasTrustDialogAccepted = true;
      changed = true;
    }
  }
  if (!changed) return;
  const tmp = `${file}.yui-tmp`;
  writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}
