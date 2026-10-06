// Bloqueio do catastrófico: agentes rodam no automático (sem pedir aprovação), mas estes comandos
// são negados direto — apagar a máquina/workspace, formatar disco, derrubar banco inteiro, mexer nos
// stacks de produção de clientes ou reescrever a main com force push.

const PROTECTED_STACKS = ['twenty-qcjv', 'twentycrm-jonyxmidia', 'n8n-with-ai-assistant-wesu'];
const ROOT_TARGETS = new Set(['/', '/*', '~', '~/*', '$HOME', '${HOME}', '$HOME/*', '/workspace', '/workspace/*', '/data', '/data/*', '/root', '/root/*', '/docker', '/docker/*', '/home', '/etc', '/usr', '/var']);

// Divide em comandos simples (;, &&, ||, |, quebras de linha) e tira sudo/env do começo.
function segments(cmd: string): string[][] {
  return cmd
    .split(/;|&&|\|\||\||\n/)
    .map((s) => s.trim().split(/\s+/).filter(Boolean))
    .map((t) => {
      while (t[0] === 'sudo' || t[0] === 'command' || /^[A-Z_][A-Z0-9_]*=/.test(t[0] ?? '')) t.shift();
      return t;
    })
    .filter((t) => t.length > 0);
}

const unquote = (s: string) => s.replace(/^['"]|['"]$/g, '');
const normTarget = (s: string) => {
  const u = unquote(s);
  return u.length > 1 && u.endsWith('/') && !u.endsWith('*/') ? u.slice(0, -1) : u;
};

function rmWipesRoot(tokens: string[]): boolean {
  if (tokens[0] !== 'rm') return false;
  const args = tokens.slice(1);
  const recursive = args.some((a) => a === '--recursive' || (/^-[a-zA-Z]+$/.test(a) && /[rR]/.test(a)));
  if (!recursive) return false;
  return args.filter((a) => !a.startsWith('-')).some((a) => ROOT_TARGETS.has(normTarget(a)));
}

const RULES: [RegExp, string][] = [
  [/\bmkfs(\.\w+)?\b/, 'formatar disco'],
  [/\bdd\b[^;|&\n]*\bof=\/dev\//, 'escrever direto em dispositivo'],
  [/\bDROP\s+DATABASE\b/i, 'apagar um banco de dados inteiro'],
  [/\bdocker\s+(system|volume)\s+prune\b/, 'limpar volumes/containers do Docker inteiro'],
  [/\bgit\s+push\b(?=[^;&|\n]*(\s--force(-with-lease)?\b|\s-f\b|\s\+))(?=[^;&|\n]*\b(main|master)\b)/, 'force push na main/master'],
];

/** Motivo do bloqueio, ou null se o comando pode rodar no automático. */
export function blockedReason(cmd: string): string | null {
  if (segments(cmd).some(rmWipesRoot)) return 'apagar a raiz, o home, o workspace ou /data inteiros';
  for (const [re, why] of RULES) if (re.test(cmd)) return why;
  if (/\bdocker\b/.test(cmd) && PROTECTED_STACKS.some((s) => cmd.includes(s)) && /\b(rm|rmi|stop|kill|down|restart|pause|update|prune|exec)\b/.test(cmd)) {
    return 'mexer em stack de produção protegido (Twenty qcjv, Twenty jonyxmidia, n8n wesu)';
  }
  return null;
}
