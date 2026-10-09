import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMermaid, parseWorkflowMarkdown, serializeWorkflow, toMermaid, validateWorkflow } from '../../shared/workflowMarkdown.ts';
import type { WorkflowNode } from '../../shared/protocol.ts';

// Passo "Pedir informação" (o run para e espera) e "Avisar": markdown, execução, reinício, transcrição e lembrete.
const root = mkdtempSync(join(tmpdir(), 'atria-wfin-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });

const wf = await import('../src/workflows.ts');
const inputs = await import('../src/workflowInputs.ts');
const { agora } = await import('../src/ambiente.ts');
const { setTranscribeClient, splitAudio } = await import('../src/transcribe.ts');
const { inboxItems } = await import('../src/runs.ts');
const { default: Fastify } = await import('fastify');
const { default: multipart } = await import('@fastify/multipart');
const app = Fastify();
await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024, files: 30, fields: 10, parts: 40 } });
inputs.register(app);
await app.ready();

type Notice = Parameters<Parameters<typeof inputs.setNotifier>[0] & object>[0];
const sent: Notice[] = [];
inputs.setNotifier(async (m) => {
  sent.push(m);
  return m.channels.map((channel) => (channel === 'email' ? { channel, ok: false, error: 'não configurado' } : { channel, ok: true, ...(channel === 'telegram' ? { telegramMessageId: 77 } : {}) }));
});
inputs.setInputAI({
  summarize: async (p) => `Resumo: ${p.transcript.slice(0, 40)}`,
  extract: async (p) => (/fechou sim/i.test(p.text) ? { fechou: 'sim', data: 'hoje' } : {}),
});
let composed: { contexto: string } | null = null;
wf.setNoticeComposer(async (i) => ((composed = i), { titulo: 'Aviso', texto: `Contexto: ${i.contexto}` }));

const until = async (fn: () => boolean, ms = 8000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 30));
  }
};
const status = (id: string) => wf.getWorkflowRun(id)?.status;

const MD = `---
nome: Reunião
gatilho: manual
---

# Reunião

## 1. Avisar o site
- tipo: avisar
- avisar: telegram, email
- mensagem: fixa
- texto: Site pronto: {{entrada}}
- anexar: sim
- próximo: 2

## 2. Gravação da reunião
- tipo: pedir informação
- instrução: Mande a gravação e diga se fechou
- campo: Data | data | obrigatório | padrão hoje
- campo: Fechou | escolha | obrigatório
- opções: sim, talvez, não
- campo: Gravação | áudio | opcional
- campo: Fotos | imagens | opcional
- avisar: telegram, push
- próximo: 3

## 3. Fim
- tipo: fim
`;

test('markdown: pedir informação e avisar vão e voltam (com Mermaid)', () => {
  const def = parseWorkflowMarkdown(MD, 'reuniao');
  const [a, b] = def.nodes;
  assert.equal(a.type, 'notify');
  assert.deepEqual(a.notifyVia, ['telegram', 'email']);
  assert.deepEqual(a.message, { mode: 'template', text: 'Site pronto: {{entrada}}' });
  assert.equal(a.attach, true);
  assert.equal(b.type, 'input');
  assert.deepEqual(b.fields?.map((f) => [f.key, f.kind, f.required, f.default ?? null]), [
    ['data', 'date', true, 'hoje'], ['fechou', 'choice', true, null], ['gravacao', 'audio', false, null], ['fotos', 'images', false, null],
  ]);
  assert.deepEqual(b.fields?.[1].options, ['sim', 'talvez', 'não']);
  assert.deepEqual(b.notifyVia, ['telegram', 'push']);
  assert.deepEqual(validateWorkflow(def), []);

  const md2 = serializeWorkflow(def);
  assert.match(md2, /- campo: Data \| data \| obrigatório \| padrão hoje/);
  assert.match(md2, /- opções: sim, talvez, não/);
  assert.match(md2, /- mensagem: fixa\n- texto: Site pronto/);
  const back = parseWorkflowMarkdown(md2, 'reuniao');
  assert.deepEqual(back.nodes.map(({ position: _p, ...n }) => n), def.nodes.map(({ position: _p, ...n }) => n));

  const mm = toMermaid(def);
  assert.match(mm, /n1>"1\. Avisar o site"\]/);
  assert.match(mm, /n2\[\/"2\. Gravação da reunião"\\\]/);
  assert.match(mm, /class n2 t_input/);
  assert.match(mm, /class n1 t_notify/);
  const g = parseMermaid(mm);
  assert.deepEqual(g.nodes.map((n) => n.type), ['notify', 'input', 'end']);
  // paralelo continua paralelo
  assert.equal(parseMermaid('flowchart TD\n  A[/"x"/] --> B[/y/]').nodes.every((n) => n.type === 'parallel'), true);
  // só Mermaid: as formas viram os tipos
  const only = parseWorkflowMarkdown('flowchart TD\n  n1[/"1. Pedir data"\\] --> n2>"2. Avisar"]\n  n2 --> n3(("3. Fim"))');
  assert.deepEqual(only.nodes.map((n) => n.type), ['input', 'notify', 'end']);
});

test('validação: pedir informação sem campos, escolha sem opções e avisar sem canal', () => {
  const errs = validateWorkflow({
    nodes: [
      { id: '1', type: 'input', title: 'A', next: ['2'] },
      { id: '2', type: 'input', title: 'B', fields: [{ key: 'x', label: 'X', kind: 'choice', required: true }], next: ['3'] },
      { id: '3', type: 'notify', title: 'C', next: ['4'] },
      { id: '4', type: 'end', title: 'Fim' },
    ],
  });
  assert.equal(errs.length, 3);
});

const saveDef = (slug: string, nodes: WorkflowNode[]) =>
  wf.saveWorkflow({ def: { slug, name: slug, description: '', trigger: { type: 'manual' }, project: null, team: [], nodes } });

const askNode = (extra: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id: '1', type: 'input', title: 'Gravação da reunião', instruction: 'Mande a gravação',
  fields: [
    { key: 'data', label: 'Data', kind: 'date', required: true, default: 'hoje' },
    { key: 'fechou', label: 'Fechou', kind: 'choice', required: true, options: ['sim', 'não'] },
    { key: 'gravacao', label: 'Gravação', kind: 'audio', required: false },
  ],
  notifyVia: ['telegram', 'push'],
  next: ['2'],
  ...extra,
});

test('run para em waiting_input, valida, resolve "hoje" e segue com as respostas no contexto', async () => {
  saveDef('pedido-a', [
    askNode(),
    { id: '2', type: 'notify', title: 'Contar', notifyVia: ['push'], message: { mode: 'ai', text: 'diga o que recebeu' }, next: ['3'] },
    { id: '3', type: 'end', title: 'Fim' },
  ]);
  sent.length = 0;
  const r = await wf.runWorkflow('pedido-a');
  await until(() => status(r.id) === 'waiting_input');
  assert.equal(wf.getWorkflowRun(r.id)!.nodes['1'].status, 'waiting_input');
  const req = inputs.listInputRequests({ runId: r.id })[0];
  assert.equal(req.status, 'pending');
  await until(() => sent.length > 0);
  assert.equal(sent[0].kind, 'input');
  assert.equal(sent[0].inputRequestId, req.id);
  assert.match(sent[0].url ?? '', new RegExp(`/app/workflows/pedido/${req.id}$`));
  assert.deepEqual(sent[0].channels, ['telegram', 'push']);
  await until(() => inputs.getInputRequest(req.id)!.notifiedVia.includes('telegram'));
  assert.ok(inboxItems().some((i) => i.id === `input:${req.id}`));

  // obrigatório faltando e opção inválida
  const miss = await inputs.submitInput(req.id, {});
  assert.equal(miss.ok, false);
  assert.deepEqual(!miss.ok && miss.missing, ['Fechou']);
  const bad = await inputs.submitInput(req.id, { fechou: 'quem sabe' });
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.error : '', /escolha uma das opções/);

  const ok = await inputs.submitInput(req.id, { fechou: 'SIM' });
  assert.equal(ok.ok, true);
  await until(() => status(r.id) === 'done');
  const done = inputs.getInputRequest(req.id)!;
  assert.equal(done.status, 'done');
  assert.equal(done.answers.data, agora().data);
  assert.equal(done.answers.fechou, 'sim');
  const run = wf.getWorkflowRun(r.id)!;
  assert.match(run.nodes['1'].result ?? '', /Fechou: sim/);
  assert.match(composed!.contexto, /Fechou: sim/);
  assert.match(composed!.contexto, /fechou = sim/);
  assert.match(run.nodes['2'].result ?? '', /Avisado por push/);
  assert.ok(!inboxItems().some((i) => i.id === `input:${req.id}`));
  // já respondido: 409
  const again = await inputs.submitInput(req.id, { fechou: 'não' });
  assert.equal(!again.ok && again.code, 409);
});

test('avisar: canal com falha vira nota e não trava; texto fixo usa a saída do passo', async () => {
  const f = join(process.env.ATRIA_WORKSPACE_DIR!, 'site', 'proposta.pdf');
  mkdirSync(join(process.env.ATRIA_WORKSPACE_DIR!, 'site'), { recursive: true });
  writeFileSync(f, '%PDF-1.4 teste');
  saveDef('aviso-b', [
    { id: '1', type: 'notify', title: 'Avisar', notifyVia: ['email', 'telegram'], message: { mode: 'template', text: 'Pronto: {{entrada}}' }, attach: true, next: ['2'] },
    { id: '2', type: 'end', title: 'Fim' },
  ]);
  sent.length = 0;
  const r = await wf.runWorkflow('aviso-b', { input: `site em https://x.test e proposta em ${f}` });
  await until(() => status(r.id) === 'done');
  const res = wf.getWorkflowRun(r.id)!.nodes['1'].result ?? '';
  assert.match(res, /Avisado por telegram/);
  assert.match(res, /Não saiu por: email \(não configurado\)/);
  assert.equal(sent[0].text, `Pronto: site em https://x.test e proposta em ${f}`);
  assert.equal(sent[0].kind, 'notice');
});

test('anexar: arquivos citados nas saídas vão no aviso', async () => {
  const f = join(process.env.ATRIA_WORKSPACE_DIR!, 'site', 'proposta.pdf');
  saveDef('aviso-c', [
    askNode({ fields: [{ key: 'link', label: 'Link', kind: 'text', required: true }] }),
    { id: '2', type: 'notify', title: 'Avisar', notifyVia: ['push'], message: { mode: 'template', text: '{{Gravação da reunião}}' }, attach: true, next: ['3'] },
    { id: '3', type: 'end', title: 'Fim' },
  ]);
  const r = await wf.runWorkflow('aviso-c');
  await until(() => status(r.id) === 'waiting_input');
  const req = inputs.listInputRequests({ runId: r.id })[0];
  sent.length = 0;
  assert.equal((await inputs.submitInput(req.id, { link: `veja ${f}` })).ok, true);
  await until(() => status(r.id) === 'done');
  const n = sent.find((m) => m.kind === 'notice')!;
  assert.deepEqual(n.files, [f]);
  assert.match(n.text, /Link: veja/);
});

test('cancelar a execução cancela o pedido', async () => {
  saveDef('pedido-cancel', [askNode(), { id: '2', type: 'end', title: 'Fim' }]);
  const r = await wf.runWorkflow('pedido-cancel');
  await until(() => status(r.id) === 'waiting_input');
  const req = inputs.listInputRequests({ runId: r.id })[0];
  assert.equal(wf.cancelWorkflowRun(r.id), true);
  await until(() => status(r.id) === 'cancelled');
  assert.equal(inputs.getInputRequest(req.id)!.status, 'cancelled');
});

test('lembrete: só depois de 24 h, com relógio injetado', async () => {
  saveDef('pedido-lembrete', [askNode(), { id: '2', type: 'end', title: 'Fim' }]);
  const r = await wf.runWorkflow('pedido-lembrete');
  await until(() => status(r.id) === 'waiting_input');
  const req = inputs.listInputRequests({ runId: r.id })[0];
  await until(() => inputs.getInputRequest(req.id)!.notifiedVia.length > 0);
  sent.length = 0;
  assert.equal(await inputs.remindTick(Date.now() + 3600_000), 0);
  assert.equal(sent.length, 0);
  assert.ok(new Date(inputs.getInputRequest(req.id)!.nextReminderAt!).getTime() > Date.now() + 23 * 3600_000);
  const later = Date.now() + 25 * 3600_000;
  assert.equal(await inputs.remindTick(later), 1);
  assert.equal(sent[0].kind, 'reminder');
  assert.match(sent[0].title, /^Lembrete/);
  assert.equal(inputs.getInputRequest(req.id)!.remindedAt, new Date(later).toISOString());
  assert.equal(await inputs.remindTick(later + 3600_000), 0);
  wf.cancelWorkflowRun(r.id);
});

test('Telegram: texto vira campos (extrator falso), áudio entra no campo e o envio segue o fluxo', async () => {
  let calls = 0;
  setTranscribeClient(async () => ((calls++), { text: 'cliente fechou o plano anual' }));
  saveDef('pedido-tg', [askNode(), { id: '2', type: 'end', title: 'Fim' }]);
  const r = await wf.runWorkflow('pedido-tg');
  await until(() => status(r.id) === 'waiting_input');
  const req = inputs.listInputRequests({ runId: r.id })[0];
  const a = await inputs.applyPart(req.id, { kind: 'text', text: 'fechou sim, foi hoje' });
  assert.equal(a.complete, true);
  assert.match(a.summary, /Fechou: sim/);
  // áudio: ffmpeg real se existir; senão só confere que o arquivo foi para o campo
  const tmp = join(root, 'voz.ogg');
  const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
  if (hasFfmpeg) spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', '-c:a', 'libopus', tmp]);
  else writeFileSync(tmp, 'x');
  const b = await inputs.applyPart(req.id, { kind: 'audio', tmpPath: tmp, name: 'voz.ogg', mime: 'audio/ogg', size: 10 });
  assert.match(b.summary, /Gravação \(1 áudio\)/);
  assert.equal(existsSync(tmp), false);
  if (!hasFfmpeg) return void wf.cancelWorkflowRun(r.id);
  const bridgeSubmit = await inputs.submitInput(req.id, {}, [], 'telegram');
  assert.equal(bridgeSubmit.ok, true);
  await until(() => status(r.id) === 'done');
  const done = inputs.getInputRequest(req.id)!;
  const dir = join(process.env.ATRIA_WORKSPACE_DIR!, '.atria', 'inputs', r.id, '1', 'gravacao');
  assert.match(readFileSync(join(dir, 'transcricao.md'), 'utf8'), /cliente fechou o plano anual/);
  assert.match(readFileSync(join(dir, 'resumo.md'), 'utf8'), /Resumo: cliente fechou/);
  assert.match(wf.getWorkflowRun(r.id)!.nodes['1'].result ?? '', /pelo Telegram[\s\S]*Transcrição completa: .*transcricao\.md/);
  assert.equal(done.status, 'done');
  assert.equal(calls, 1);
  setTranscribeClient(null);
});

test('transcrição: ffmpeg corta 25 min em 3 partes', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 ? 'ffmpeg ausente' : false }, async () => {
  const src = join(root, 'longo.mp3');
  const g = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=1500:a=0.05', '-ac', '1', '-ar', '8000', '-b:a', '16k', src]);
  assert.equal(g.status, 0, g.stderr?.toString());
  const out = mkdtempSync(join(tmpdir(), 'atria-parts-'));
  const { parts, seconds } = await splitAudio(src, out);
  assert.equal(parts.length, 3);
  assert.ok(Math.abs(seconds - 1500) < 2, `duração ${seconds}`);
  const { transcribe } = await import('../src/transcribe.ts');
  const seen: string[] = [];
  const progress: string[] = [];
  setTranscribeClient(async (file, model) => {
    seen.push(model);
    if (model === 'gpt-4o-transcribe' && seen.length === 1) throw new Error('falhou');
    return { text: `parte ${file.slice(-7, -4)}` };
  });
  const t = await transcribe(src, (d, n) => progress.push(`${d}/${n}`));
  assert.equal(t.parts, 3);
  assert.equal(t.text, 'parte 000\n\nparte 001\n\nparte 002');
  assert.deepEqual(seen, ['gpt-4o-transcribe', 'whisper-1', 'gpt-4o-transcribe', 'gpt-4o-transcribe']);
  assert.deepEqual(progress, ['0/3', '1/3', '2/3', '3/3']);
  setTranscribeClient(null);
});

// ---------- reinício ----------

const child = (code: string, dir: string) =>
  spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, ATRIA_DATA_DIR: join(dir, 'data'), ATRIA_WORKSPACE_DIR: join(dir, 'ws'), ATRIA_SEED_DIR: join(dir, 'seed') },
    encoding: 'utf8',
    timeout: 30_000,
  });

test('reinício com pedido pendente: o run volta a esperar e conclui depois', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atria-wfin-restart-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  const prelude = `
    const wf = await import('./src/workflows.ts');
    const inputs = await import('./src/workflowInputs.ts');
    inputs.setNotifier(async (m) => m.channels.map((channel) => ({ channel, ok: true })));
    wf.setNoticeComposer(async (i) => ({ titulo: 't', texto: i.contexto }));
    const until = async (fn) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > 8000) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 30)); } };
  `;
  const a = child(`${prelude}
    wf.saveWorkflow({ def: { slug: 'r', name: 'R', description: '', trigger: { type: 'manual' }, project: null, team: [], nodes: [
      { id: '1', type: 'parallel', title: 'Dois', next: ['2', '3'] },
      { id: '2', type: 'input', title: 'Data', fields: [{ key: 'data', label: 'Data', kind: 'date', required: true }], next: ['4'] },
      { id: '3', type: 'notify', title: 'Avisar', notifyVia: ['push'], message: { mode: 'template', text: 'oi' }, next: ['4'] },
      { id: '4', type: 'notify', title: 'Depois', notifyVia: ['push'], message: { mode: 'ai', text: 'x' }, next: ['5'] },
      { id: '5', type: 'end', title: 'Fim' },
    ] } });
    const r = await wf.runWorkflow('r');
    await until(() => wf.getWorkflowRun(r.id).status === 'waiting_input' && wf.getWorkflowRun(r.id).nodes['3'].status === 'done');
    console.log(JSON.stringify({ id: r.id }));
    process.exit(0);
  `, dir);
  assert.equal(a.status, 0, a.stderr);
  const { id } = JSON.parse(a.stdout.trim().split('\n').at(-1)!);
  const b = child(`${prelude}
    wf.recoverWorkflowRuns();
    const run0 = wf.getWorkflowRun('${id}');
    const req = inputs.listInputRequests({ runId: '${id}' })[0];
    const res = await inputs.submitInput(req.id, { data: '09/10/2026' });
    await until(() => wf.getWorkflowRun('${id}').status === 'done');
    const run = wf.getWorkflowRun('${id}');
    console.log(JSON.stringify({ before: run0.status, res, nodes: run.nodes }));
    process.exit(0);
  `, dir);
  assert.equal(b.status, 0, b.stderr);
  const out = JSON.parse(b.stdout.trim().split('\n').at(-1)!);
  assert.equal(out.before, 'waiting_input');
  assert.deepEqual(out.res, { ok: true });
  assert.equal(out.nodes['2'].status, 'done');
  assert.equal(out.nodes['4'].status, 'done');
  assert.match(out.nodes['4'].result, /Data: 2026-10-09/);
  assert.match(out.nodes['4'].result, /Avisado por push/);
});

test('reinício com agente rodando continua falhando como antes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atria-wfin-fail-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  const r = child(`
    const { db } = await import('./src/db.ts');
    const wf = await import('./src/workflows.ts');
    db.prepare("INSERT INTO workflow_runs(id, workflow, status, current, nodes, started_at) VALUES('x', 'nao-existe', 'running', '1', '{\\"1\\":{\\"status\\":\\"running\\"}}', '2026-01-01')").run();
    wf.recoverWorkflowRuns();
    console.log(JSON.stringify(wf.getWorkflowRun('x')));
    process.exit(0);
  `, dir);
  assert.equal(r.status, 0, r.stderr);
  const run = JSON.parse(r.stdout.trim().split('\n').at(-1)!);
  assert.equal(run.status, 'failed');
  assert.equal(run.nodes['1'].status, 'failed');
});

test('HTTP: formulário multipart com respostas + imagem; 400 com missing; 409 depois de enviado', async () => {
  saveDef('pedido-http', [
    askNode({ fields: [
      { key: 'nome', label: 'Nome', kind: 'text', required: true },
      { key: 'fotos', label: 'Fotos', kind: 'images', required: true },
    ] }),
    { id: '2', type: 'end', title: 'Fim' },
  ]);
  const r = await wf.runWorkflow('pedido-http');
  await until(() => status(r.id) === 'waiting_input');
  const list = (await app.inject({ method: 'GET', url: '/api/workflow-inputs' })).json() as { id: string; runId: string }[];
  const req = list.find((x) => x.runId === r.id)!;
  assert.ok(req);
  const form = (parts: { name: string; value: string; filename?: string; type?: string }[]) => {
    const b = '----atria' + Math.random().toString(16).slice(2);
    const body = parts.map((p) => `--${b}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"\r\nContent-Type: ${p.type}` : ''}\r\n\r\n${p.value}\r\n`).join('') + `--${b}--\r\n`;
    return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
  };
  const miss = await app.inject({ method: 'POST', url: `/api/workflow-inputs/${req.id}`, ...form([{ name: 'answers', value: JSON.stringify({ nome: 'Ana' }) }]) });
  assert.equal(miss.statusCode, 400);
  assert.deepEqual(miss.json().missing, ['Fotos']);
  const wrong = await app.inject({ method: 'POST', url: `/api/workflow-inputs/${req.id}`, ...form([{ name: 'fotos', value: 'x', filename: 'nota.txt', type: 'text/plain' }]) });
  assert.equal(wrong.statusCode, 400);
  const ok = await app.inject({
    method: 'POST', url: `/api/workflow-inputs/${req.id}`,
    ...form([{ name: 'answers', value: JSON.stringify({ nome: 'Ana' }) }, { name: 'fotos', value: 'PNGDATA', filename: 'frente.png', type: 'image/png' }]),
  });
  assert.equal(ok.statusCode, 200, ok.body);
  await until(() => status(r.id) === 'done');
  const res = wf.getWorkflowRun(r.id)!.nodes['1'].result ?? '';
  const img = join(process.env.ATRIA_WORKSPACE_DIR!, '.atria', 'inputs', r.id, '1', 'fotos', 'frente.png');
  assert.equal(readFileSync(img, 'utf8'), 'PNGDATA');
  assert.match(res, /Nome: Ana/);
  assert.ok(res.includes(img));
  const again = await app.inject({ method: 'POST', url: `/api/workflow-inputs/${req.id}`, payload: { answers: { nome: 'B' } } });
  assert.equal(again.statusCode, 409);
  assert.equal((await app.inject({ method: 'GET', url: `/api/workflow-inputs/${req.id}` })).json().status, 'done');
});
