import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type OpenAI from 'openai';
import type { InputField, NotifyChannel, WorkflowInputRequest, WorkflowNode } from '../../shared/protocol.ts';
import { FIELD_LABEL } from '../../shared/workflowMarkdown.ts';
import { config } from './config.ts';
import { db, now, uid } from './db.ts';
import { emit } from './bus.ts';
import { openai } from './brain.ts';
import { agora } from './ambiente.ts';
import { addInboxSource, inboxItems } from './runs.ts';
import { registerBrain } from './extensions.ts';
import { getSetting } from './settings.ts';
import { trackOpenAI } from './usage.ts';
import { transcribe } from './transcribe.ts';
import { cleanName } from './company/files.ts';
import { publicUrl, registerInputBridge, sendNotice, type NoticeMsg, type SendResult } from './notify.ts';

// Passo "Pedir informação" dos workflows: o fluxo para, o usuário é avisado (push/Telegram/e-mail) e responde
// pelo formulário do Atria OS, pelo Telegram ou ditando para a Yui. Áudio é transcrito e resumido; imagens e
// arquivos ficam em /workspace/.atria/inputs/<run>/<passo>/<campo>/ e os caminhos vão para o próximo passo.
// O pedido vive no banco: um reinício do servidor não perde a espera (workflows.ts reconstrói a execução).

db.exec(`
CREATE TABLE IF NOT EXISTS workflow_inputs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  workflow TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  title TEXT NOT NULL,
  instruction TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL,
  notify_via TEXT NOT NULL DEFAULT '[]',
  notified_via TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  answers TEXT NOT NULL DEFAULT '{}',
  via TEXT,
  progress TEXT,
  error TEXT,
  output TEXT,
  vars TEXT,
  created_at TEXT NOT NULL,
  reminded_at TEXT,
  answered_at TEXT,
  tg_message_id INTEGER
);
CREATE INDEX IF NOT EXISTS workflow_inputs_run ON workflow_inputs(run_id, node_id);
CREATE INDEX IF NOT EXISTS workflow_inputs_status ON workflow_inputs(status);
`);

interface Row {
  id: string; run_id: string; node_id: string; workflow: string; workflow_name: string; title: string; instruction: string;
  fields: string; notify_via: string; notified_via: string; status: WorkflowInputRequest['status']; answers: string; via: string | null;
  progress: string | null; error: string | null; output: string | null; vars: string | null;
  created_at: string; reminded_at: string | null; answered_at: string | null; tg_message_id: number | null;
}

export interface FileRef { name: string; path: string; size: number }
export type Via = 'form' | 'telegram' | 'yui';
export type InputOutcome = { status: 'done'; output: string; vars: Record<string, unknown> } | { status: 'cancelled' };

const FILE_KINDS = new Set<InputField['kind']>(['audio', 'images', 'files']);
const isFileKind = (f: InputField) => FILE_KINDS.has(f.kind);
const MAX_FIELD_FILES = 20;
const remindHours = () => Math.max(1, Number(getSetting('notify.remindHours')) || 24);
const inputsDir = () => join(config.metaDir, 'inputs');
const fieldDir = (r: Pick<Row, 'run_id' | 'node_id'>, key: string) => join(inputsDir(), r.run_id, r.node_id, key);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const formUrl = (id: string) => publicUrl(`/app/workflows/pedido/${id}`);

const getRow = (id: string) => db.prepare('SELECT * FROM workflow_inputs WHERE id = ?').get(id) as Row | undefined;

function nextReminder(r: Row): string | null {
  if (r.status !== 'pending') return null;
  return new Date(new Date(r.reminded_at ?? r.created_at).getTime() + remindHours() * 3600_000).toISOString();
}

function toInfo(r: Row): WorkflowInputRequest {
  return {
    id: r.id, runId: r.run_id, nodeId: r.node_id, workflow: r.workflow, workflowName: r.workflow_name, title: r.title, instruction: r.instruction,
    fields: JSON.parse(r.fields), status: r.status, answers: JSON.parse(r.answers), progress: r.progress, error: r.error,
    createdAt: r.created_at, remindedAt: r.reminded_at, nextReminderAt: nextReminder(r), answeredAt: r.answered_at, notifiedVia: JSON.parse(r.notified_via),
  };
}

export function getInputRequest(id: string): WorkflowInputRequest | null {
  const r = getRow(id);
  return r ? toInfo(r) : null;
}

/** Pedidos esperando resposta ou sendo processados (mais antigos primeiro). */
export function listInputRequests(opts: { runId?: string } = {}): WorkflowInputRequest[] {
  const rows = opts.runId
    ? (db.prepare(`SELECT * FROM workflow_inputs WHERE run_id = ? ORDER BY created_at`).all(opts.runId) as Row[])
    : (db.prepare(`SELECT * FROM workflow_inputs WHERE status IN ('pending','processing') ORDER BY created_at`).all() as Row[]);
  return rows.map(toInfo);
}

function update(id: string, set: Partial<Omit<Row, 'id'>>) {
  const keys = Object.keys(set);
  if (keys.length) db.prepare(`UPDATE workflow_inputs SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...set, id });
  const r = getRow(id);
  if (r) emit({ type: 'workflow.input.updated', request: toInfo(r) });
  if ('status' in set) emit({ type: 'inbox.updated', inbox: inboxItems() });
  return r;
}

// ---------- dependências trocáveis (testes) ----------

type Notifier = (m: NoticeMsg) => Promise<SendResult[]>;
let notifier: Notifier = sendNotice;
/** Troca o envio de avisos (testes). null volta ao notify.ts. */
export function setNotifier(n: Notifier | null) {
  notifier = n ?? sendNotice;
}
/** Envia um aviso sem nunca lançar (usado também pelo passo Avisar). */
export async function notice(m: NoticeMsg): Promise<SendResult[]> {
  try {
    return await notifier(m);
  } catch (e) {
    return m.channels.map((channel) => ({ channel, ok: false, error: (e as Error).message }));
  }
}

export interface InputAI {
  // resumo estruturado de uma transcrição (markdown)
  summarize(p: { workflow: string; title: string; instruction: string; transcript: string }): Promise<string>;
  // texto livre ("fechou sim, reunião hoje") → valores dos campos não-arquivo (null = não mencionado)
  extract(p: { fields: InputField[]; text: string; today: string }): Promise<Record<string, string | null>>;
}

const openaiAI: InputAI = {
  async summarize(p) {
    const res = await openai.responses.create({
      model: config.brainModel,
      instructions:
        'Você resume a transcrição de uma gravação (normalmente uma reunião com um cliente) para os próximos passos de um workflow. Em português, fiel ao que foi dito, sem inventar. Valores com moeda e prazos com datas quando citados. Listas vazias quando não houver.',
      input: `Workflow: ${p.workflow}\nPedido: ${p.title}${p.instruction ? `\nO que foi pedido: ${p.instruction}` : ''}\n\nTranscrição:\n${clip(p.transcript, 400_000)}`,
      text: {
        format: {
          type: 'json_schema',
          name: 'resumo_reuniao',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['resumo', 'topicos', 'decisoes', 'valores', 'prazos', 'objecoes', 'proximos_passos'],
            properties: {
              resumo: { type: 'string', description: '3 a 6 frases' },
              topicos: { type: 'array', items: { type: 'string' } },
              decisoes: { type: 'array', items: { type: 'string' } },
              valores: { type: 'array', items: { type: 'string' } },
              prazos: { type: 'array', items: { type: 'string' } },
              objecoes: { type: 'array', items: { type: 'string' } },
              proximos_passos: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    });
    trackOpenAI('workflow-pedido', res.model, res.usage);
    const o = JSON.parse(res.output_text) as Record<string, string | string[]>;
    const sec = (t: string, k: string) => ((o[k] as string[])?.length ? `\n\n### ${t}\n${(o[k] as string[]).map((x) => `- ${x}`).join('\n')}` : '');
    return `${o.resumo}${sec('Tópicos', 'topicos')}${sec('Decisões', 'decisoes')}${sec('Valores', 'valores')}${sec('Prazos', 'prazos')}${sec('Objeções', 'objecoes')}${sec('Próximos passos', 'proximos_passos')}`;
  },
  async extract(p) {
    const fs = p.fields.filter((f) => !isFileKind(f));
    if (!fs.length) return {};
    const res = await openai.responses.create({
      model: config.brainModel,
      instructions: `Você preenche um formulário a partir de uma mensagem do usuário. Hoje é ${p.today}. Datas em AAAA-MM-DD ("hoje", "ontem" e dias da semana viram datas), horas em HH:MM, números só com dígitos e ponto, sim/não como "sim" ou "não", escolha exatamente uma das opções. null quando a mensagem não fala do campo. Texto: copie o que o usuário disse para aquele campo.`,
      input: `Campos:\n${fs.map((f) => `- ${f.key}: ${f.label} (${FIELD_LABEL[f.kind]}${f.options?.length ? `; opções: ${f.options.join(' | ')}` : ''})`).join('\n')}\n\nMensagem:\n${clip(p.text, 8000)}`,
      text: {
        format: {
          type: 'json_schema',
          name: 'campos',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: fs.map((f) => f.key),
            properties: Object.fromEntries(fs.map((f) => [f.key, { type: ['string', 'null'], description: f.label }])),
          },
        },
      },
    });
    trackOpenAI('workflow-pedido', res.model, res.usage);
    return JSON.parse(res.output_text) as Record<string, string | null>;
  },
};
let ai: InputAI = openaiAI;
/** Troca a IA de resumo/extração (testes). null volta ao modelo. */
export function setInputAI(a: Partial<InputAI> | null) {
  ai = a ? { ...openaiAI, ...a } : openaiAI;
}

// ---------- valores ----------

function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Normaliza um valor de campo não-arquivo. Devolve undefined quando vazio; lança Error com mensagem para o usuário. */
export function normalizeValue(f: InputField, raw: unknown, today = agora()): string | number | boolean | undefined {
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) return undefined;
  const s = typeof raw === 'string' ? raw.trim() : String(raw);
  const low = strip(s);
  switch (f.kind) {
    case 'text':
      return clip(s, 2000);
    case 'longtext':
      return clip(s, 50_000);
    case 'date': {
      if (low === 'hoje') return today.data;
      if (low === 'ontem') return shiftDate(today.data, -1);
      if (low === 'amanha') return shiftDate(today.data, 1);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))) return s;
      const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
      if (m) {
        const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.data.slice(0, 4));
        const v = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        if (!Number.isNaN(Date.parse(v))) return v;
      }
      throw new Error(`"${f.label}": data inválida (${s})`);
    }
    case 'time': {
      if (low === 'agora' || low === 'hoje') return today.hora;
      const m = /^(\d{1,2})(?::|h)(\d{2})?$/.exec(low);
      if (m && Number(m[1]) < 24 && Number(m[2] ?? 0) < 60) return `${m[1].padStart(2, '0')}:${m[2] ?? '00'}`;
      throw new Error(`"${f.label}": hora inválida (${s})`);
    }
    case 'number': {
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      const n = Number(s.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || !/\d/.test(s)) throw new Error(`"${f.label}": número inválido (${s})`);
      return n;
    }
    case 'boolean':
      if (raw === true || /^(sim|s|yes|true|1|fechou|ok)$/.test(low)) return true;
      if (raw === false || /^(nao|n|no|false|0)$/.test(low)) return false;
      throw new Error(`"${f.label}": responda sim ou não`);
    case 'choice': {
      const opt = (f.options ?? []).find((o) => strip(o) === low);
      if (!opt) throw new Error(`"${f.label}": escolha uma das opções (${(f.options ?? []).join(', ')})`);
      return opt;
    }
    default:
      return undefined;
  }
}

const show = (f: InputField, v: unknown) =>
  v === undefined || v === null ? '—' : f.kind === 'boolean' ? (v ? 'sim' : 'não') : Array.isArray(v) ? `${v.length} arquivo(s)` : String(v);

interface Checked { values: Record<string, unknown>; missing: string[]; errors: string[] }

/** Aplica padrões ("hoje"), normaliza e lista obrigatórios faltando (rótulos). */
export function checkAnswers(fields: InputField[], answers: Record<string, unknown>, today = agora()): Checked {
  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  const errors: string[] = [];
  for (const f of fields) {
    let v = answers[f.key];
    if (isFileKind(f)) {
      const list = Array.isArray(v) ? (v as FileRef[]) : [];
      if (list.length) values[f.key] = list;
      else if (f.required) missing.push(f.label);
      continue;
    }
    if ((v === undefined || v === null || v === '') && f.default) v = f.default;
    try {
      const n = normalizeValue(f, v, today);
      if (n === undefined) {
        if (f.required) missing.push(f.label);
      } else values[f.key] = n;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { values, missing, errors };
}

// ---------- arquivos ----------

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.oga', '.opus', '.webm', '.aac', '.flac', '.mp4', '.mov', '.mkv', '.amr', '.3gp', '.mpeg', '.mpga', '.wma']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.bmp']);

function acceptsFile(f: InputField, name: string, mime = ''): boolean {
  const ext = extname(name).toLowerCase();
  if (f.kind === 'audio') return AUDIO_EXT.has(ext) || /^(audio|video)\//.test(mime);
  if (f.kind === 'images') return IMAGE_EXT.has(ext) || /^image\//.test(mime);
  return f.kind === 'files';
}

function uniquePath(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const clean = cleanName(name).replace(/^\.+/, '') || 'arquivo';
  let p = join(dir, clean);
  for (let i = 2; existsSync(p); i++) p = join(dir, `${basename(clean, extname(clean))}-${i}${extname(clean)}`);
  return p;
}

function moveInto(tmp: string, dest: string) {
  try {
    renameSync(tmp, dest);
  } catch {
    copyFileSync(tmp, dest); // outro sistema de arquivos (tmp do Telegram)
    unlinkSync(tmp);
  }
}

// ---------- ciclo do pedido ----------

const waiters = new Map<string, (o: InputOutcome) => void>();
const processingHooks = new Map<string, () => void>();
const busy = new Set<string>();

function noticeFor(r: Row, kind: 'input' | 'reminder'): NoticeMsg {
  const fields = JSON.parse(r.fields) as InputField[];
  const lines = [
    r.instruction || r.title,
    '',
    `O que preciso: ${fields.map((f) => `${f.label}${f.required ? '' : ' (opcional)'}`).join(', ')}.`,
  ];
  return {
    title: kind === 'reminder' ? `Lembrete · ${r.workflow_name}: ${r.title}` : `${r.workflow_name}: ${r.title}`,
    text: lines.join('\n'),
    url: formUrl(r.id),
    channels: JSON.parse(r.notify_via),
    inputRequestId: r.id,
    kind,
  };
}

async function sendRequestNotice(id: string, kind: 'input' | 'reminder'): Promise<SendResult[]> {
  const r = getRow(id);
  if (!r || r.status !== 'pending') return [];
  const res = await notice(noticeFor(r, kind));
  const tg = res.find((x) => x.ok && x.telegramMessageId)?.telegramMessageId;
  const ok = [...new Set([...(JSON.parse(r.notified_via) as NotifyChannel[]), ...res.filter((x) => x.ok).map((x) => x.channel)])];
  update(id, { notified_via: JSON.stringify(ok), ...(tg ? { tg_message_id: tg } : {}), ...(kind === 'reminder' ? { reminded_at: now() } : {}) });
  return res;
}

/**
 * Abre (ou reabre, depois de um reinício) o pedido do passo `node` na execução `runId`.
 * `done` resolve quando o usuário respondeu e o processamento terminou, ou quando a execução foi cancelada.
 */
export function requestInput(p: {
  runId: string; node: WorkflowNode; workflow: string; workflowName: string; onProcessing?: () => void; resume?: boolean;
}): { request: WorkflowInputRequest; done: Promise<InputOutcome> } {
  // resume (execução reconstruída depois de um reinício): reaproveita o último pedido do passo; senão (inclusive
  // passo revisitado num laço) abre um pedido novo
  let r = p.resume
    ? (db
        .prepare(`SELECT * FROM workflow_inputs WHERE run_id = ? AND node_id = ? AND status IN ('pending','processing','done') ORDER BY created_at DESC LIMIT 1`)
        .get(p.runId, p.node.id) as Row | undefined)
    : undefined;
  const reused = !!r;
  if (r && r.status === 'done') {
    // resposta já processada antes do reinício: segue sem perguntar de novo
    const out = r.output ?? '';
    const vars = JSON.parse(r.vars ?? '{}') as Record<string, unknown>;
    return { request: toInfo(r), done: Promise.resolve({ status: 'done', output: out, vars }) };
  }
  if (!r) {
    const id = uid();
    db.prepare(
      `INSERT INTO workflow_inputs(id, run_id, node_id, workflow, workflow_name, title, instruction, fields, notify_via, status, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(id, p.runId, p.node.id, p.workflow, p.workflowName, p.node.title, p.node.instruction ?? '', JSON.stringify(p.node.fields ?? []), JSON.stringify(p.node.notifyVia?.length ? p.node.notifyVia : ['push']), now());
    r = update(id, {})!;
    emit({ type: 'inbox.updated', inbox: inboxItems() });
  }
  const id = r.id;
  const done = new Promise<InputOutcome>((resolve) => waiters.set(id, resolve));
  if (p.onProcessing) processingHooks.set(id, p.onProcessing);
  if (!reused) void sendRequestNotice(id, 'input');
  // processamento interrompido por reinício: refaz (transcrições prontas são reaproveitadas)
  if (r.status === 'processing') void processRequest(id);
  return { request: toInfo(r), done };
}

/** Cancela os pedidos abertos de uma execução (cancelar o workflow). */
export function cancelInputsForRun(runId: string): number {
  const rows = db.prepare(`SELECT id FROM workflow_inputs WHERE run_id = ? AND status IN ('pending','processing')`).all(runId) as { id: string }[];
  for (const { id } of rows) {
    update(id, { status: 'cancelled', progress: null });
    settle(id, { status: 'cancelled' });
  }
  return rows.length;
}

function settle(id: string, o: InputOutcome) {
  const w = waiters.get(id);
  waiters.delete(id);
  processingHooks.delete(id);
  w?.(o);
}

/**
 * Recebe respostas (formulário, Telegram ou Yui). `answers` = valores não-arquivo; `files` = arquivos já em disco
 * (temporários; são movidos para a pasta do pedido). No formulário os arquivos de um campo substituem os anteriores.
 */
export async function submitInput(
  id: string,
  answers: Record<string, unknown>,
  files: { key: string; tmpPath: string; name: string; mime?: string; size: number }[] = [],
  via: Via = 'form',
): Promise<{ ok: true } | { ok: false; code: number; error: string; missing?: string[] }> {
  const r = getRow(id);
  const drop = () => files.forEach((f) => rmSync(f.tmpPath, { force: true }));
  if (!r) return drop(), { ok: false, code: 404, error: 'pedido não encontrado' };
  if (r.status !== 'pending') return drop(), { ok: false, code: 409, error: r.status === 'processing' ? 'já estou processando a resposta' : 'esse pedido não está mais esperando resposta' };
  const fields = JSON.parse(r.fields) as InputField[];
  const merged: Record<string, unknown> = { ...JSON.parse(r.answers) };
  for (const f of fields) if (!isFileKind(f) && f.key in answers) merged[f.key] = answers[f.key];
  // arquivos: valida tudo antes de mover
  for (const file of files) {
    const f = fields.find((x) => x.key === file.key);
    if (!f || !isFileKind(f)) return drop(), { ok: false, code: 400, error: `campo de arquivo desconhecido: ${file.key}` };
    if (!acceptsFile(f, file.name, file.mime)) return drop(), { ok: false, code: 400, error: `"${f.label}" não aceita ${file.name}` };
  }
  const replaced = new Set<string>();
  for (const file of files) {
    let list = (merged[file.key] as FileRef[] | undefined) ?? [];
    if (via === 'form' && !replaced.has(file.key)) {
      replaced.add(file.key);
      for (const old of list) rmSync(old.path, { force: true });
      list = [];
    }
    if (list.length >= MAX_FIELD_FILES) {
      rmSync(file.tmpPath, { force: true });
      continue;
    }
    const dest = uniquePath(fieldDir(r, file.key), file.name);
    moveInto(file.tmpPath, dest);
    merged[file.key] = [...list, { name: basename(dest), path: dest, size: file.size }];
  }
  const chk = checkAnswers(fields, merged);
  if (chk.errors.length || chk.missing.length) {
    update(id, { answers: JSON.stringify(merged), error: chk.errors[0] ?? null });
    return { ok: false, code: 400, error: chk.errors.length ? chk.errors.join('; ') : `falta: ${chk.missing.join(', ')}`, missing: chk.missing };
  }
  update(id, { answers: JSON.stringify(chk.values), status: 'processing', via, error: null, progress: 'Recebi. Organizando as respostas…' });
  void processRequest(id);
  return { ok: true };
}

async function processRequest(id: string): Promise<void> {
  if (busy.has(id)) return;
  busy.add(id);
  try {
    const r = getRow(id);
    if (!r || r.status !== 'processing') return;
    processingHooks.get(id)?.();
    const fields = JSON.parse(r.fields) as InputField[];
    const answers = JSON.parse(r.answers) as Record<string, unknown>;
    const lines: string[] = [];
    const vars: Record<string, unknown> = {};
    for (const f of fields) {
      const v = answers[f.key];
      if (v === undefined) continue;
      if (f.kind === 'audio') {
        const list = v as FileRef[];
        const dir = fieldDir(r, f.key);
        const chunks: string[] = [];
        let seconds = 0;
        for (let i = 0; i < list.length; i++) {
          const file = list[i];
          const cache = join(dir, `.${file.name}.txt`);
          if (existsSync(cache)) {
            const c = JSON.parse(readFileSync(cache, 'utf8')) as { text: string; seconds: number };
            chunks.push(list.length > 1 ? `## ${file.name}\n\n${c.text}` : c.text);
            seconds += c.seconds;
            continue;
          }
          const label = list.length > 1 ? `«${file.name}» (${i + 1} de ${list.length})` : 'a gravação';
          update(id, { progress: `Transcrevendo ${label}…` });
          const t = await transcribe(file.path, (done, total) => {
            if (done < total) update(id, { progress: `Transcrevendo ${label} · parte ${done + 1} de ${total}` });
          });
          writeFileSync(cache, JSON.stringify({ text: t.text, seconds: t.seconds }));
          chunks.push(list.length > 1 ? `## ${file.name}\n\n${t.text}` : t.text);
          seconds += t.seconds;
        }
        const transcript = chunks.join('\n\n');
        const trPath = join(dir, 'transcricao.md');
        writeFileSync(trPath, `# Transcrição · ${f.label}\n\n${r.workflow_name} · ${r.title}\n\n${transcript}\n`);
        update(id, { progress: 'Resumindo a conversa…' });
        let resumo: string;
        try {
          resumo = await ai.summarize({ workflow: r.workflow_name, title: r.title, instruction: r.instruction, transcript });
        } catch (e) {
          console.error('pedido: resumo', (e as Error).message);
          resumo = `(não consegui resumir: ${(e as Error).message}; leia a transcrição completa)`;
        }
        const rsPath = join(dir, 'resumo.md');
        writeFileSync(rsPath, `# Resumo · ${f.label}\n\n${resumo}\n`);
        const min = Math.round(seconds / 60);
        lines.push(`- ${f.label}: ${list.length} gravação(ões)${min ? `, ${min} min` : ''}. Transcrição completa: ${trPath} · Resumo: ${rsPath}\n\n${resumo.split('\n').map((l) => `  ${l}`).join('\n')}\n`);
        vars[f.key] = resumo;
        vars[`${f.key}.transcricao`] = trPath;
      } else if (isFileKind(f)) {
        const list = v as FileRef[];
        lines.push(`- ${f.label}: ${list.map((x) => x.path).join(', ')}${f.kind === 'images' ? ' (imagens: abra com a ferramenta Read para ver)' : ' (abra com Read para ler)'}`);
        vars[f.key] = list.map((x) => x.path);
      } else {
        lines.push(`- ${f.label}: ${show(f, v)}`);
        vars[f.key] = f.kind === 'boolean' ? (v ? 'sim' : 'não') : v;
      }
    }
    const when = agora();
    const via = r.via === 'telegram' ? 'pelo Telegram' : r.via === 'yui' ? 'ditadas para a Yui' : 'pelo formulário';
    const output = `Respostas de "${r.title}" (${via}, ${when.data} ${when.hora}):\n${lines.join('\n')}`;
    update(id, { status: 'done', progress: null, error: null, output, vars: JSON.stringify(vars), answered_at: now() });
    settle(id, { status: 'done', output, vars });
  } catch (e) {
    // volta a esperar: as respostas e os arquivos ficam; o usuário reenvia (ou tenta de novo mais tarde)
    console.error('pedido: processamento', (e as Error).message);
    if (getRow(id)?.status === 'processing') update(id, { status: 'pending', progress: null, error: `Não consegui processar: ${(e as Error).message}. Envie de novo.` });
  } finally {
    busy.delete(id);
  }
}

// ---------- lembretes ----------

/** Reenvia os pedidos sem resposta há notify.remindHours (padrão 24 h). Exportado com relógio injetável para teste. */
export async function remindTick(nowMs = Date.now()): Promise<number> {
  const rows = db.prepare(`SELECT * FROM workflow_inputs WHERE status = 'pending'`).all() as Row[];
  let n = 0;
  for (const r of rows) {
    const due = new Date(r.reminded_at ?? r.created_at).getTime() + remindHours() * 3600_000;
    if (nowMs < due) continue;
    await sendRequestNotice(r.id, 'reminder');
    db.prepare('UPDATE workflow_inputs SET reminded_at = ? WHERE id = ?').run(new Date(nowMs).toISOString(), r.id);
    n++;
  }
  return n;
}

/** Pedidos de uma execução que não existe mais em memória (reinício que não deu para retomar). */
export function orphanInputs(activeRunIds: Set<string>): number {
  const rows = db.prepare(`SELECT id, run_id FROM workflow_inputs WHERE status IN ('pending','processing')`).all() as { id: string; run_id: string }[];
  let n = 0;
  for (const r of rows) {
    if (activeRunIds.has(r.run_id) || waiters.has(r.id)) continue;
    update(r.id, { status: 'cancelled', progress: null, error: 'a execução do workflow foi encerrada' });
    n++;
  }
  return n;
}

// ---------- Telegram (ponte com notify.ts) ----------

function partSummary(r: Row): { summary: string; missing: string[]; complete: boolean } {
  const fields = JSON.parse(r.fields) as InputField[];
  const answers = JSON.parse(r.answers) as Record<string, unknown>;
  const chk = checkAnswers(fields, answers);
  const got = fields
    .filter((f) => chk.values[f.key] !== undefined)
    .map((f) => {
      const v = chk.values[f.key];
      if (Array.isArray(v)) return `${f.label} (${v.length} ${f.kind === 'audio' ? 'áudio' : f.kind === 'images' ? 'imagem(ns)' : 'arquivo(s)'})`;
      return `${f.label}: ${show(f, v)}`;
    });
  const summary = `${got.length ? `Recebi: ${got.join(', ')}` : 'Ainda não recebi nada'}${chk.errors.length ? `\nNão entendi: ${chk.errors.join('; ')}` : ''}`;
  return { summary, missing: chk.missing, complete: !chk.missing.length && !chk.errors.length };
}

const bridgeKind: Record<'audio' | 'image' | 'file', InputField['kind'][]> = { audio: ['audio', 'files'], image: ['images', 'files'], file: ['files', 'images', 'audio'] };

export async function applyPart(
  requestId: string,
  part: { kind: 'audio' | 'image' | 'file'; tmpPath: string; name: string; mime: string; size: number } | { kind: 'text'; text: string },
): Promise<{ summary: string; missing: string[]; complete: boolean }> {
  const r = getRow(requestId);
  if (!r || r.status !== 'pending') {
    if (part.kind !== 'text') rmSync(part.tmpPath, { force: true });
    return { summary: 'Esse pedido não está mais esperando resposta.', missing: [], complete: false };
  }
  const fields = JSON.parse(r.fields) as InputField[];
  const answers = JSON.parse(r.answers) as Record<string, unknown>;
  if (part.kind === 'text') {
    let vals: Record<string, string | null> = {};
    try {
      vals = await ai.extract({ fields, text: part.text, today: agora().texto });
    } catch (e) {
      console.error('pedido: extrair do texto', (e as Error).message);
    }
    for (const f of fields) {
      if (isFileKind(f)) continue;
      const v = vals[f.key];
      if (v !== null && v !== undefined && String(v).trim()) answers[f.key] = v;
    }
    // um único campo de texto e nada entendido: o texto inteiro vai para ele
    const texts = fields.filter((f) => f.kind === 'text' || f.kind === 'longtext');
    if (!Object.values(vals).some((v) => v) && texts.length === 1 && answers[texts[0].key] === undefined) answers[texts[0].key] = part.text;
    update(requestId, { answers: JSON.stringify(answers) });
  } else {
    const f = bridgeKind[part.kind].map((k) => fields.find((x) => x.kind === k && acceptsFile(x, part.name, part.mime))).find(Boolean);
    if (!f) {
      rmSync(part.tmpPath, { force: true });
      const s = partSummary(r);
      return { ...s, summary: `Este pedido não tem campo para ${part.kind === 'audio' ? 'áudio' : part.kind === 'image' ? 'imagem' : 'arquivo'}.\n${s.summary}` };
    }
    const list = (answers[f.key] as FileRef[] | undefined) ?? [];
    const dest = uniquePath(fieldDir(r, f.key), part.name);
    moveInto(part.tmpPath, dest);
    answers[f.key] = [...list, { name: basename(dest), path: dest, size: part.size }];
    update(requestId, { answers: JSON.stringify(answers) });
  }
  return partSummary(getRow(requestId)!);
}

// ---------- HTTP ----------

async function readMultipart(req: FastifyRequest, id: string) {
  const answers: Record<string, unknown> = {};
  const files: { key: string; tmpPath: string; name: string; mime: string; size: number }[] = [];
  const tmp = join(inputsDir(), '.tmp');
  mkdirSync(tmp, { recursive: true });
  let tooBig: string | null = null;
  for await (const part of req.parts()) {
    if (part.type === 'field') {
      if (part.fieldname === 'answers' && typeof part.value === 'string') {
        try {
          Object.assign(answers, JSON.parse(part.value));
        } catch {
          /* answers inválido: tratado como vazio */
        }
      }
      continue;
    }
    const p = join(tmp, `${id}-${randomUUID()}`);
    let size = 0;
    part.file.on('data', (c: Buffer) => (size += c.length));
    await pipeline(part.file, createWriteStream(p));
    if (part.file.truncated) {
      rmSync(p, { force: true });
      tooBig = part.filename;
      continue;
    }
    files.push({ key: part.fieldname, tmpPath: p, name: part.filename || 'arquivo', mime: part.mimetype, size });
  }
  return { answers, files, tooBig };
}

export function register(app: FastifyInstance): void {
  addInboxSource({
    prefixes: ['input:'],
    items: () =>
      listInputRequests()
        .filter((r) => r.status === 'pending')
        .map((r) => ({
          id: `input:${r.id}`,
          tag: 'Pedido',
          label: `${r.workflowName}: ${r.title}`,
          tone: 'warn' as const,
          action: { type: 'view' as const, view: 'workflow' as const, params: { workflowId: r.workflow, workflowRunId: r.runId } },
        })),
    dismiss: () => false,
  });
  registerInputBridge({
    pending: () =>
      (db.prepare(`SELECT * FROM workflow_inputs WHERE status = 'pending' ORDER BY created_at`).all() as Row[]).map((r) => ({
        id: r.id, title: r.title, workflowName: r.workflow_name, tgMessageId: r.tg_message_id,
      })),
    applyPart,
    async submit(requestId, via) {
      const res = await submitInput(requestId, {}, [], via);
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    },
  });
  setInterval(() => void remindTick().catch((e) => console.error('pedidos: lembrete', e.message)), 10 * 60_000).unref();

  app.get('/api/workflow-inputs', (req) => listInputRequests({ runId: (req.query as { runId?: string }).runId || undefined }));
  app.get('/api/workflow-inputs/:id', async (req, reply) => getInputRequest((req.params as { id: string }).id) ?? reply.code(404).send({ error: 'pedido não encontrado' }));
  app.post('/api/workflow-inputs/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = getRow(id);
    if (!r) return reply.code(404).send({ error: 'pedido não encontrado' });
    if (r.status !== 'pending') return reply.code(409).send({ error: 'esse pedido não está mais esperando resposta' });
    let answers: Record<string, unknown> = {};
    let files: Awaited<ReturnType<typeof readMultipart>>['files'] = [];
    if (req.isMultipart()) {
      const m = await readMultipart(req, id);
      if (m.tooBig) {
        m.files.forEach((f) => rmSync(f.tmpPath, { force: true }));
        return reply.code(413).send({ error: `${m.tooBig}: arquivo grande demais (máx. 500 MB)` });
      }
      answers = m.answers;
      files = m.files;
    } else {
      const b = (req.body ?? {}) as { answers?: unknown };
      if (b.answers && typeof b.answers === 'object') answers = b.answers as Record<string, unknown>;
    }
    const res = await submitInput(id, answers, files, 'form');
    if (res.ok) return { ok: true };
    return reply.code(res.code).send({ error: res.error, ...(res.missing?.length ? { missing: res.missing } : {}) });
  });
  app.post('/api/workflow-inputs/:id/remind', async (req, reply) => {
    const r = getRow((req.params as { id: string }).id);
    if (!r) return reply.code(404).send({ error: 'pedido não encontrado' });
    if (r.status !== 'pending') return reply.code(409).send({ error: 'esse pedido não está mais esperando resposta' });
    const results = await sendRequestNotice(r.id, 'reminder');
    return { ok: results.some((x) => x.ok), results };
  });

  registerBrain({
    name: 'workflow-inputs',
    instructions:
      '- Pedidos de informação: um workflow pode parar num passo "Pedir informação" esperando o usuário (data, texto, gravação para transcrever, fotos, arquivos). "Tem algo esperando por mim?" → pedidos_pendentes. Para responder com áudio, foto ou arquivo, abra o formulário com abrir_pedido (ou ele responde a mensagem do bot no Telegram). Quando ele ditar respostas de texto, data, escolha, número ou sim/não na conversa, use responder_pedido; confirme antes de enviar se ficou ambíguo.',
    snapshot: () => {
      const p = listInputRequests().filter((r) => r.status === 'pending');
      return p.length ? `Pedidos esperando o usuário: ${p.map((r) => `${r.workflowName} — ${r.title} [${r.id}]`).join('; ')}.` : '';
    },
    tools: [
      {
        type: 'function',
        name: 'pedidos_pendentes',
        strict: true,
        description: 'Lista os pedidos de informação de workflows que estão esperando o usuário (campos, o que já foi recebido).',
        parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
      },
      {
        type: 'function',
        name: 'abrir_pedido',
        strict: true,
        description: 'Abre na tela a execução do workflow com o formulário do pedido (para enviar gravação, fotos ou arquivos).',
        parameters: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', description: 'id do pedido (ou parte do título)' } } },
      },
      {
        type: 'function',
        name: 'responder_pedido',
        strict: true,
        description: 'Responde um pedido com o que o usuário ditou (só campos de texto, data, hora, escolha, número e sim/não; "hoje" vale para data). Envia e o workflow continua se os obrigatórios estiverem completos.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'respostas'],
          properties: {
            id: { type: 'string', description: 'id do pedido (ou parte do título)' },
            respostas: {
              type: 'array',
              items: { type: 'object', additionalProperties: false, required: ['campo', 'valor'], properties: { campo: { type: 'string', description: 'chave ou rótulo do campo' }, valor: { type: 'string' } } },
            },
          },
        },
      },
    ] satisfies OpenAI.Responses.FunctionTool[],
    run(tool, args) {
      const find = (q: unknown) => {
        const k = strip(String(q ?? ''));
        const all = listInputRequests().filter((r) => r.status === 'pending');
        return all.find((r) => r.id === String(q)) ?? all.find((r) => strip(`${r.workflowName} ${r.title}`).includes(k)) ?? (all.length === 1 ? all[0] : undefined);
      };
      switch (tool) {
        case 'pedidos_pendentes':
          return Promise.resolve(
            listInputRequests().map((r) => ({
              id: r.id, workflow: r.workflowName, pedido: r.title, instrucao: r.instruction, status: r.status, progresso: r.progress, erro: r.error,
              campos: r.fields.map((f) => ({ chave: f.key, rotulo: f.label, tipo: FIELD_LABEL[f.kind], obrigatorio: f.required, opcoes: f.options ?? null, recebido: r.answers[f.key] !== undefined })),
              desde: r.createdAt,
            })),
          );
        case 'abrir_pedido': {
          const r = find(args.id);
          if (!r) return Promise.resolve({ ok: false, error: 'pedido não encontrado' });
          emit({ type: 'ui.action', action: { type: 'show_view', view: 'workflow', params: { workflowId: r.workflow, workflowRunId: r.runId } } });
          return Promise.resolve({ ok: true, link: formUrl(r.id) });
        }
        case 'responder_pedido':
          return (async () => {
            const r = find(args.id);
            if (!r) return { ok: false, error: 'pedido não encontrado' };
            const answers: Record<string, unknown> = {};
            for (const a of (args.respostas as { campo: string; valor: string }[]) ?? []) {
              const f = r.fields.find((x) => x.key === a.campo || strip(x.label) === strip(a.campo));
              if (!f) return { ok: false, error: `campo desconhecido: ${a.campo}`, campos: r.fields.map((x) => x.label) };
              if (isFileKind(f)) return { ok: false, error: `"${f.label}" é ${FIELD_LABEL[f.kind]}: use abrir_pedido para o usuário enviar pelo formulário` };
              answers[f.key] = a.valor;
            }
            const res = await submitInput(r.id, answers, [], 'yui');
            return res.ok ? { ok: true, status: 'processando; o workflow continua' } : { ok: false, error: res.error, falta: res.missing ?? [] };
          })();
        default:
          return undefined;
      }
    },
  });
}
