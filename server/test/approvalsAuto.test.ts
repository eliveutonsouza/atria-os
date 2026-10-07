import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWorkflowMarkdown, serializeWorkflow } from '../../shared/workflowMarkdown.ts';
import { blockedReason } from '../src/safety.ts';

// Aprovações no automático: bloqueio do catastrófico e passo de aprovação de workflow decidido pela Yui.
const root = mkdtempSync(join(tmpdir(), 'atria-apv-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });

const { db } = await import('../src/db.ts');
const wf = await import('../src/workflows.ts');
const { pendingApprovals, resolveApproval } = await import('../src/runs.ts');

test('bloqueio: catastrófico negado, trabalho normal liberado', () => {
  for (const c of [
    'rm -rf /', 'sudo rm -rf /*', 'rm -fr ~', 'rm -r -f /workspace/', 'rm --recursive --force /data', 'cd x && rm -rf "/"',
    'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/sda', 'psql -c "DROP DATABASE prod"', 'docker system prune -af', 'docker volume prune',
    'docker compose -p twenty-qcjv down', 'docker stop twentycrm-jonyxmidia-server-1', 'docker rm -f n8n-with-ai-assistant-wesu-n8n-1',
    'git push --force origin main', 'git push -f origin master', 'git push origin +main',
  ]) assert.ok(blockedReason(c), `devia bloquear: ${c}`);
  for (const c of [
    'git push origin feat/x', 'git push origin main', 'git push --force origin feat/x', 'docker compose -p atria-os logs', 'docker ps',
    'docker logs twenty-qcjv-server-1', 'rm -rf node_modules', 'rm -rf ./dist', 'rm -rf /workspace/proj/dist', 'npm run deploy', 'psql -c "select 1"',
    'curl -X POST https://api.exemplo.com',
  ]) assert.equal(blockedReason(c), null, `não devia bloquear: ${c}`);
});

test('markdown: "perguntar: sim" no passo de aprovação vai e volta', () => {
  const def = parseWorkflowMarkdown('# T\n\n## 1. Revisão\n- tipo: aprovação\n- instrução: legenda ok?\n- perguntar: sim\n- próximo: 2\n\n## 2. Fim\n- tipo: fim\n', 't');
  assert.equal(def.nodes[0].ask, true);
  assert.match(serializeWorkflow(def), /- perguntar: sim/);
  assert.equal(parseWorkflowMarkdown(serializeWorkflow({ ...def, nodes: def.nodes.map((n) => ({ ...n, ask: false })) }), 't').nodes[0].ask, undefined);
});

const save = (slug: string, ask = false) =>
  wf.saveWorkflow({
    def: {
      slug, name: slug, description: '', trigger: { type: 'manual' }, project: null, team: [],
      nodes: [
        { id: '1', type: 'approval', title: 'Revisão', instruction: 'Está ok?', next: ['2'], ...(ask ? { ask: true } : {}) },
        { id: '2', type: 'end', title: 'Fim' },
      ],
    },
  });
const until = async (fn: () => boolean, ms = 8000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
};
const status = (id: string) => wf.getWorkflowRun(id)?.status;
const decisions = (slug: string) => db.prepare('SELECT decided_by, approved FROM workflow_approval_decisions WHERE workflow = ? ORDER BY created_at').all(slug) as { decided_by: string; approved: number }[];

test('confiança alta: Yui aprova sozinha, grava a decisão e usa lições', async () => {
  let seen = -1;
  wf.setApprovalJudge(async (i) => ((seen = i.licoes.length), { aprovar: true, confianca: 0.9, motivo: 'atende o critério' }));
  save('auto-a');
  const r = await wf.runWorkflow('auto-a');
  await until(() => status(r.id) === 'done');
  const n = wf.getWorkflowRun(r.id)!.nodes['1'];
  assert.equal(n.decidedBy, 'yui');
  assert.match(n.result ?? '', /Yui aprovou/);
  assert.deepEqual(decisions('auto-a'), [{ decided_by: 'yui', approved: 1 }]);
  assert.equal(seen, 0);
  assert.equal(pendingApprovals().length, 0);

  // Discordo vira lição do usuário e marca a execução
  const fb = wf.approvalFeedback(r.id, '1', false, 'faltou a hashtag');
  assert.equal(fb?.nodes['1'].feedback, 'disagree');
  assert.equal(wf.buildLessons('auto-a', '1')[0].approved, false);
});

test('confiança baixa: chama o usuário e a resposta vira lição', async () => {
  wf.setApprovalJudge(async () => ({ aprovar: true, confianca: 0.3, motivo: 'sem histórico' }));
  save('auto-b');
  const r = await wf.runWorkflow('auto-b');
  await until(() => pendingApprovals().some((a) => a.runId === r.id));
  const ap = pendingApprovals().find((a) => a.runId === r.id)!;
  assert.ok(ap.rows.some((x) => x.label === 'Por que pergunto'));
  resolveApproval(ap.id, true);
  await until(() => status(r.id) === 'done');
  assert.deepEqual(decisions('auto-b'), [{ decided_by: 'user', approved: 1 }]);
});

test('"sempre me perguntar": nem consulta a Yui', async () => {
  let called = false;
  wf.setApprovalJudge(async () => ((called = true), { aprovar: true, confianca: 1, motivo: 'x' }));
  save('auto-c', true);
  const r = await wf.runWorkflow('auto-c');
  await until(() => pendingApprovals().some((a) => a.runId === r.id));
  assert.equal(called, false);
  resolveApproval(pendingApprovals().find((a) => a.runId === r.id)!.id, false);
  await until(() => status(r.id) === 'cancelled');
  assert.deepEqual(decisions('auto-c'), [{ decided_by: 'user', approved: 0 }]);
});

test('Yui rejeita com confiança: execução para', async () => {
  wf.setApprovalJudge(async () => ({ aprovar: false, confianca: 0.95, motivo: 'contraria decisão anterior' }));
  save('auto-d');
  const r = await wf.runWorkflow('auto-d');
  await until(() => status(r.id) === 'cancelled');
  assert.match(wf.getWorkflowRun(r.id)!.nodes['1'].result ?? '', /Yui rejeitou/);
});

test('lições: mesmo passo primeiro, no máximo 12', () => {
  const ins = db.prepare(`INSERT INTO workflow_approval_decisions(id, workflow, node_id, decided_by, approved, created_at) VALUES(?, 'L', ?, 'user', 1, ?)`);
  for (let i = 0; i < 15; i++) ins.run(`o${i}`, '9', `2026-01-01T00:00:${String(10 + i).padStart(2, '0')}Z`);
  ins.run('same', '1', '2025-01-01T00:00:00Z');
  const l = wf.buildLessons('L', '1');
  assert.equal(l.length, 12);
  assert.equal(l[0].nodeId, '1');
});
