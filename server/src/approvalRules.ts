import type { FastifyInstance } from 'fastify';
import type { ApprovalRule, ApprovalRuleInfo } from '../../shared/protocol.ts';
import { db, now, uid } from './db.ts';
import { registerBrain } from './extensions.ts';

// Regras "sempre permitir / sempre bloquear" das aprovações de agentes (ideia do Paperclip: aprovar uma vez
// ou salvar uma regra revogável). Sempre presas a um agente e a um projeto, e só para chaves estreitas:
// uma ferramenta MCP exata ou um comando + subcomando ("git push"). Nunca valem para o que safety.ts bloqueia
// nem para as aprovações vermelhas (exclusões), que não passam por aqui.

db.exec(`CREATE TABLE IF NOT EXISTS approval_rules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  project TEXT,
  mode TEXT NOT NULL,
  created_at TEXT NOT NULL
)`);

// Encadeamento, redirecionamento ou substituição: "git push && rm -rf x" não pode herdar a regra de "git push".
const COMPOUND = /[;&|`<>\n]|\$\(/;
const TOKEN = /^[\w][\w.:/@=+-]*$/;

/** Chave estreita da ação, ou null quando não dá para criar regra segura. */
export function ruleKey(kind: ApprovalRule['kind'], raw: string): string | null {
  if (kind === 'mcp') {
    // mcp__<servidor>__<ferramenta>, sem curinga
    return /^mcp__[\w-]+__[\w-]+$/.test(raw) ? raw : null;
  }
  const cmd = raw.trim();
  if (!cmd || COMPOUND.test(cmd)) return null;
  const [bin, sub] = cmd.split(/\s+/);
  if (!bin || !sub || !TOKEN.test(bin) || !TOKEN.test(sub) || sub.startsWith('-') || bin.includes('=')) return null;
  if (['sudo', 'env', 'bash', 'sh', 'xargs', 'eval', 'exec', 'nohup', 'timeout'].includes(bin)) return null;
  return `${bin} ${sub}`;
}

const toInfo = (r: { id: string; kind: string; key: string; agent_id: string; project: string | null; mode: string; created_at: string }): ApprovalRuleInfo => ({
  id: r.id, kind: r.kind as ApprovalRule['kind'], key: r.key, agentId: r.agent_id, project: r.project, mode: r.mode as ApprovalRuleInfo['mode'], createdAt: r.created_at,
});

/** Regra salva para esta ação deste agente neste projeto. */
export function matchRule(kind: ApprovalRule['kind'], raw: string, agentId: string, project: string | null): 'allow' | 'deny' | null {
  const key = ruleKey(kind, raw);
  if (!key) return null;
  const row = db.prepare(`SELECT mode FROM approval_rules WHERE kind = ? AND key = ? AND agent_id = ? AND project IS ? ORDER BY created_at DESC LIMIT 1`)
    .get(kind, key, agentId, project) as { mode: string } | undefined;
  return row?.mode === 'allow' || row?.mode === 'deny' ? row.mode : null;
}

export function addRule(rule: ApprovalRule, mode: 'allow' | 'deny'): ApprovalRuleInfo | null {
  if (rule.key !== ruleKey(rule.kind, rule.key)) return null;
  db.prepare(`DELETE FROM approval_rules WHERE kind = ? AND key = ? AND agent_id = ? AND project IS ?`).run(rule.kind, rule.key, rule.agentId, rule.project);
  const id = uid();
  db.prepare(`INSERT INTO approval_rules(id, kind, key, agent_id, project, mode, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)`)
    .run(id, rule.kind, rule.key, rule.agentId, rule.project, mode, now());
  return listRules().find((r) => r.id === id) ?? null;
}

export const listRules = (): ApprovalRuleInfo[] =>
  (db.prepare(`SELECT * FROM approval_rules ORDER BY created_at DESC`).all() as Parameters<typeof toInfo>[0][]).map(toInfo);

export const deleteRule = (id: string) => db.prepare(`DELETE FROM approval_rules WHERE id = ?`).run(id).changes > 0;

// Por voz: "o que eu deixei liberado?" / "volta a pedir aprovação para o git push do Dev".
registerBrain({
  name: 'regras-aprovacao',
  instructions: '- "O que eu liberei para os agentes?", "volta a me pedir aprovação para X" => regras_aprovacao (listar ou remover; 1–2 frases).',
  tools: [
    {
      type: 'function', name: 'regras_aprovacao', strict: true,
      description: 'Lista as regras salvas de aprovação (sempre permitir/bloquear por agente e projeto) ou remove uma.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { remover: { type: ['string', 'null'], description: 'id da regra, ou o texto da ação (ex.: "git push"); null = só listar' } },
        required: ['remover'],
      },
    },
  ],
  run(tool, args, ctx) {
    if (tool !== 'regras_aprovacao') return undefined;
    const rules = listRules();
    const q = typeof args.remover === 'string' ? args.remover.trim().toLowerCase() : '';
    if (!q) return Promise.resolve({ regras: rules.map((r) => ({ id: r.id, acao: r.key, agente: r.agentId, projeto: r.project ?? 'Geral', modo: r.mode === 'allow' ? 'sempre permitir' : 'sempre bloquear' })) });
    const hit = rules.filter((r) => r.id === q || r.key.toLowerCase().includes(q));
    if (!hit.length) return Promise.resolve({ ok: false, error: 'nenhuma regra com esse texto' });
    if (!ctx.dryRun) for (const r of hit) deleteRule(r.id);
    return Promise.resolve({ ok: true, removidas: hit.map((r) => `${r.key} (${r.agentId})`) });
  },
});

export function register(app: FastifyInstance): void {
  app.get('/api/approval-rules', () => listRules());
  app.delete('/api/approval-rules/:id', (req, reply) => reply.code(deleteRule((req.params as { id: string }).id) ? 204 : 404).send());
}
