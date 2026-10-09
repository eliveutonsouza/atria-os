// atria-updater: atualiza atria/atria-code para uma tag do GHCR a pedido do Atria OS (rede interna do compose).
import { Updater } from './updater.ts';
import { createApi } from './server.ts';
import { exec } from './exec.ts';

const token = process.env.ATRIA_UPDATER_TOKEN ?? '';
const stackDir = process.env.ATRIA_STACK_DIR ?? '';
const port = Number(process.env.PORT ?? 8787);

if (!stackDir) console.warn('[updater] ATRIA_STACK_DIR vazio: sem o diretório do compose não há o que atualizar');
if (!token) console.warn('[updater] ATRIA_UPDATER_TOKEN vazio: API desligada (responde 503)');

const updater = new Updater({
  stackDir: stackDir || '/opt/atria-os',
  project: process.env.ATRIA_PROJECT || 'atria-os',
  statePath: process.env.ATRIA_UPDATER_STATE || '/state/updater.json',
  version: process.env.ATRIA_VERSION || 'dev',
  exec,
});

const server = createApi(updater, token);
server.listen(port, '0.0.0.0', () => console.log(`[updater] ${updater.opts.version} ouvindo em :${port} (projeto ${updater.opts.project}, ${updater.opts.stackDir})`));

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    // Em atualização, o compose espera o job (stop_grace_period); sem job sai na hora.
    if (!updater.running) process.exit(0);
    console.log(`[updater] ${sig} durante atualização; terminando o job antes de sair`);
    void updater.running.finally(() => process.exit(0));
  });
}
