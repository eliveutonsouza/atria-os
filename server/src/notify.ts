import type { FastifyInstance } from 'fastify';
import { randomInt } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import type { NotifyChannel, NotifyStatus } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { db, kvGet, kvSet } from './db.ts';
import { getSetting, onSettingsChange, setRaw } from './settings.ts';
import { sendPush } from './push.ts';

// Avisos fora do app: Telegram (bot do usuário, long polling — sem webhook público), e-mail (Resend) e push.
// O Telegram também recebe respostas aos pedidos de informação dos workflows (InputBridge, de workflowInputs.ts).

export interface NoticeMsg {
  title: string;
  text: string;
  url?: string;
  files?: string[];
  channels: NotifyChannel[];
  inputRequestId?: string;
  kind?: 'input' | 'notice' | 'reminder';
}
export interface SendResult { channel: NotifyChannel; ok: boolean; error?: string; telegramMessageId?: number }

type Part = { kind: 'audio' | 'image' | 'file'; tmpPath: string; name: string; mime: string; size: number } | { kind: 'text'; text: string };
export interface InputBridge {
  pending(): { id: string; title: string; workflowName: string; tgMessageId: number | null }[];
  applyPart(requestId: string, part: Part): Promise<{ summary: string; missing: string[]; complete: boolean }>;
  submit(requestId: string, via: 'telegram'): Promise<{ ok: boolean; error?: string }>;
}

let bridge: InputBridge | null = null;
export function registerInputBridge(b: InputBridge): void {
  bridge = b;
}

// Conversa com a Yui pelo Telegram (telegramChat.ts): o que não é resposta a pedido de workflow vira pedido
// para o cérebro, na conversa do projeto do Telegram (/projeto troca). Aprovações comuns ganham botões.
export interface ChatBridge {
  ask(text: string, source: 'text' | 'voice'): Promise<string>;
  transcribe(path: string): Promise<string>;
  project(): { slug: string | null; name: string };
  setProject(q: string): { ok: true; name: string } | { ok: false; error: string; options: string[] };
  resolveApproval(id: string, approve: boolean): { ok: boolean; title?: string };
}
let chatBridge: ChatBridge | null = null;
export function registerChatBridge(c: ChatBridge | null): void {
  chatBridge = c;
}
/** Telegram configurado e com chat vinculado. */
export const telegramReady = () => !!(tgToken() && tgChat());
/** Aprovação comum com botões Aprovar/Rejeitar (as vermelhas, de exclusão, ficam só no painel). */
export function approvalButtons(a: { id: string; title: string; rows: { label: string; value: string }[]; kind?: string }): Promise<number | null> {
  if (a.kind === 'destructive') return Promise.resolve(null);
  const detail = a.rows.slice(0, 4).map((r) => `${r.label}: ${r.value}`).join('\n');
  return sendTelegramButtons('Aprovação necessária', `${a.title}${detail ? `\n\n${detail}` : ''}`, [[{ text: 'Aprovar', data: `a:${a.id}` }, { text: 'Rejeitar', data: `r:${a.id}` }]]);
}
/** Mensagem do bot com botões (aprovações vindas de telegramChat.ts). Nunca lança. */
export async function sendTelegramButtons(title: string, text: string, buttons: { text: string; data: string }[][]): Promise<number | null> {
  if (!telegramReady()) return null;
  try {
    const r = await sendTg(`<b>${esc(title)}</b>\n\n${esc(text)}`, { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } });
    return r.message_id;
  } catch (e) {
    console.error('notify telegram', errMsg(e));
    return null;
  }
}

// fetch trocável nos testes (Telegram e Resend falsos).
let http: typeof fetch = (input, init) => fetch(input, init);
export function setNotifyFetch(f: typeof fetch): void {
  http = f;
}

export function publicUrl(path: string): string {
  const base = config.domain === 'localhost' ? `http://localhost:${config.port}` : `https://${config.domain}`;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

const MAX_FILES = 5;
const TG_DOWNLOAD_MAX = 20 * 1024 * 1024; // limite da Bot API para getFile
const TG_UPLOAD_MAX = 50 * 1024 * 1024;
const TG_PHOTO_MAX = 10 * 1024 * 1024;
const EMAIL_ATTACH_MAX = 10 * 1024 * 1024; // soma dos anexos por e-mail

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fileSize = (p: string) => {
  try {
    return statSync(p).isFile() ? statSync(p).size : -1;
  } catch {
    return -1;
  }
};
const tgToken = () => String(getSetting('notify.telegram.token') ?? '');
const tgChat = () => String(getSetting('notify.telegram.chatId') ?? '');
const emailTo = () => String(getSetting('notify.email.to') || getSetting('user.email') || '');
const emailFrom = () => String(getSetting('notify.email.from') || 'Atria OS <onboarding@resend.dev>');

// ---------- Telegram: chamadas da Bot API ----------

type TgResp<T> = { ok: boolean; result?: T; description?: string; error_code?: number };
class TgError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.code = code;
  }
}

async function tg<T = unknown>(method: string, body: Record<string, unknown> | FormData, timeoutMs = 20_000, token = tgToken()): Promise<T> {
  if (!token) throw new TgError(0, 'Telegram não configurado');
  const isForm = body instanceof FormData;
  const r = await http(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: isForm ? undefined : { 'content-type': 'application/json' },
    body: isForm ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as TgResp<T>;
  if (!j.ok) throw new TgError(j.error_code ?? r.status, j.description ?? `Telegram respondeu ${r.status}`);
  return j.result as T;
}

interface TgMessage {
  message_id: number;
  chat: { id: number; type?: string; title?: string; first_name?: string; last_name?: string; username?: string };
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
  voice?: TgFile;
  audio?: TgFile & { file_name?: string };
  video_note?: TgFile;
  video?: TgFile & { file_name?: string };
  document?: TgFile & { file_name?: string };
  photo?: TgFile[];
}
interface TgFile { file_id: string; file_size?: number; mime_type?: string }
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number } } };
}

const sendTg = (text: string, extra: Record<string, unknown> = {}) =>
  tg<{ message_id: number }>('sendMessage', { chat_id: tgChat(), text: text.slice(0, 4096), parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

// Botão com link só funciona com endereço público (o Telegram recusa localhost).
const linkButton = (text: string, url?: string) => (url && /^https:\/\//.test(url) ? [{ text, url }] : null);

async function telegramSend(msg: NoticeMsg, notes: string[]): Promise<number> {
  const lines = [`<b>${esc(msg.title)}</b>`, '', esc(msg.text.trim())];
  if (msg.inputRequestId) lines.push('', '<i>Responda esta mensagem com áudio, foto ou texto — ou abra o formulário.</i>');
  if (msg.url && !linkButton('x', msg.url)) lines.push('', esc(msg.url));
  const btn = linkButton(msg.inputRequestId ? 'Abrir formulário' : 'Abrir no Atria', msg.url);
  const sent = await sendTg(lines.join('\n'), btn ? { reply_markup: { inline_keyboard: [btn] } } : {});
  for (const f of (msg.files ?? []).slice(0, MAX_FILES)) {
    const size = fileSize(f);
    if (size < 0) {
      notes.push(`${basename(f)}: arquivo não encontrado`);
      continue;
    }
    if (size > TG_UPLOAD_MAX) {
      notes.push(`${basename(f)}: grande demais para o Telegram`);
      continue;
    }
    const photo = /\.(jpe?g|png|webp)$/i.test(f) && size <= TG_PHOTO_MAX;
    const form = new FormData();
    form.set('chat_id', tgChat());
    form.set(photo ? 'photo' : 'document', new Blob([readFileSync(f)]), basename(f));
    try {
      await tg(photo ? 'sendPhoto' : 'sendDocument', form, 120_000);
    } catch (e) {
      notes.push(`${basename(f)}: ${errMsg(e)}`);
    }
  }
  return sent.message_id;
}

// ---------- e-mail (Resend) ----------

async function emailSend(msg: NoticeMsg, notes: string[]): Promise<void> {
  const attachments: { filename: string; content: string }[] = [];
  let total = 0;
  for (const f of (msg.files ?? []).slice(0, MAX_FILES)) {
    const size = fileSize(f);
    if (size < 0) notes.push(`${basename(f)}: arquivo não encontrado`);
    else if (total + size > EMAIL_ATTACH_MAX) notes.push(`${basename(f)}: passa do limite de 10 MB de anexos`);
    else {
      total += size;
      attachments.push({ filename: basename(f), content: readFileSync(f).toString('base64') });
    }
  }
  const body = esc(msg.text.trim()).replace(/\n/g, '<br>');
  const cta = msg.url
    ? `<p style="margin:24px 0"><a href="${esc(msg.url)}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${msg.inputRequestId ? 'Responder no Atria OS' : 'Abrir no Atria OS'}</a></p>`
    : '';
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;max-width:560px">
<h2 style="font-size:18px;margin:0 0 12px">${esc(msg.title)}</h2><p>${body}</p>${cta}
<p style="color:#9ca3af;font-size:12px">Enviado pelo Atria OS</p></div>`;
  const r = await http('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${String(getSetting('notify.email.resendKey'))}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: emailFrom(),
      to: emailTo().split(',').map((s) => s.trim()).filter(Boolean),
      subject: msg.title.slice(0, 200),
      html,
      text: `${msg.title}\n\n${msg.text}${msg.url ? `\n\n${msg.url}` : ''}`,
      ...(attachments.length ? { attachments } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { message?: string };
    throw new Error(j.message ? `Resend: ${j.message}` : `Resend respondeu ${r.status}`);
  }
}

// ---------- envio único ----------

const pushPath = (url?: string) => {
  if (!url) return '/app/inbox';
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url.startsWith('/') ? url : '/app/inbox';
  }
};

async function sendOne(channel: NotifyChannel, msg: NoticeMsg): Promise<SendResult> {
  const notes: string[] = [];
  const withNotes = (r: SendResult): SendResult => (notes.length ? { ...r, error: [r.error, ...notes].filter(Boolean).join('; ') } : r);
  try {
    if (channel === 'telegram') {
      if (!tgToken()) return { channel, ok: false, error: 'não configurado' };
      if (!tgChat()) return { channel, ok: false, error: 'Telegram não vinculado (mande /start <código> ao bot)' };
      const id = await telegramSend(msg, notes);
      if (msg.inputRequestId) track(id, msg.inputRequestId);
      return withNotes({ channel, ok: true, telegramMessageId: id });
    }
    if (channel === 'email') {
      if (!getSetting('notify.email.resendKey') || !emailTo()) return { channel, ok: false, error: 'não configurado' };
      await emailSend(msg, notes);
      return withNotes({ channel, ok: true });
    }
    const input = msg.kind === 'input' || msg.kind === 'reminder' || !!msg.inputRequestId;
    const sent = await sendPush(
      { title: msg.title, body: msg.text.replace(/\s+/g, ' ').trim().slice(0, 180), url: pushPath(msg.url), tag: msg.inputRequestId ? `input-${msg.inputRequestId}` : `notice-${Date.now()}`, priority: input ? 'high' : 'normal' },
      input ? { kind: 'input' } : { force: true },
    );
    return sent > 0 ? { channel, ok: true } : { channel, ok: false, error: 'nenhum aparelho com notificações ativas' };
  } catch (e) {
    return { channel, ok: false, error: errMsg(e) };
  }
}

/** Envia pelos canais pedidos. Nunca lança: cada canal volta com ok/erro. */
export async function sendNotice(msg: NoticeMsg): Promise<SendResult[]> {
  const channels = [...new Set(msg.channels)].filter((c): c is NotifyChannel => c === 'telegram' || c === 'email' || c === 'push');
  return Promise.all(channels.map((c) => sendOne(c, msg)));
}

// ---------- Telegram: vínculo por código ----------

const CODE_TTL = 30 * 60_000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newLinkCode(): string {
  const code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
  kvSet('notify.tg.linkCode', JSON.stringify({ code, exp: Date.now() + CODE_TTL }));
  return code;
}
function currentCode(): string | null {
  try {
    const c = JSON.parse(kvGet('notify.tg.linkCode') ?? 'null') as { code: string; exp: number } | null;
    return c && c.exp > Date.now() ? c.code : null;
  } catch {
    return null;
  }
}
export function unlinkTelegram(): void {
  setRaw('notify.telegram.chatId', null);
  kvSet('notify.tg.chatName', '');
  activeRequest = null;
  held = null;
}

// ---------- Telegram: respostas aos pedidos ----------

const sentFor = new Map<number, string>(); // id de mensagem do bot → pedido (avisos e resumos)
let activeRequest: string | null = null; // último pedido escolhido: mensagens soltas seguem para ele
let held: TgMessage | null = null; // mensagem aguardando o usuário escolher o pedido

const track = (messageId: number, requestId: string) => {
  sentFor.set(messageId, requestId);
  if (sentFor.size > 500) sentFor.delete(sentFor.keys().next().value!);
};
const formLink = (id?: string | null) => publicUrl(id ? `/app/workflows/pedido/${id}` : '/app/inbox');

async function reply(to: TgMessage | number | null, text: string, extra: Record<string, unknown> = {}): Promise<number | null> {
  try {
    const replyTo = typeof to === 'number' ? to : to?.message_id;
    const r = await sendTg(text, { ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}), ...extra });
    return r.message_id;
  } catch (e) {
    console.error('notify telegram', errMsg(e));
    return null;
  }
}

function chatName(c: TgMessage['chat']): string {
  return c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || (c.username ? `@${c.username}` : String(c.id));
}

/** Escolhe o pedido: resposta a um aviso/resumo > último escolhido > único pendente. null = perguntar ou nenhum. */
function routeMessage(m: TgMessage, pend: ReturnType<InputBridge['pending']>): string | null {
  const ids = new Set(pend.map((p) => p.id));
  const rt = m.reply_to_message?.message_id;
  if (rt) {
    const byTg = pend.find((p) => p.tgMessageId === rt)?.id ?? sentFor.get(rt);
    if (byTg && ids.has(byTg)) return byTg;
  }
  if (activeRequest && ids.has(activeRequest)) return activeRequest;
  return pend.length === 1 ? pend[0].id : null;
}

interface Incoming { kind: 'audio' | 'image' | 'file'; file: TgFile; name: string; mime: string }
function mediaOf(m: TgMessage): Incoming | null {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  if (m.voice) return { kind: 'audio', file: m.voice, name: `audio-${stamp}.ogg`, mime: m.voice.mime_type ?? 'audio/ogg' };
  if (m.audio) return { kind: 'audio', file: m.audio, name: m.audio.file_name ?? `audio-${stamp}.mp3`, mime: m.audio.mime_type ?? 'audio/mpeg' };
  if (m.video_note) return { kind: 'audio', file: m.video_note, name: `video-${stamp}.mp4`, mime: 'video/mp4' };
  if (m.photo?.length) return { kind: 'image', file: m.photo.at(-1)!, name: `foto-${stamp}.jpg`, mime: 'image/jpeg' };
  const d = m.document ?? m.video;
  if (d) {
    const mime = d.mime_type ?? 'application/octet-stream';
    return { kind: mime.startsWith('audio/') ? 'audio' : 'file', file: d, name: d.file_name ?? `arquivo-${stamp}`, mime };
  }
  return null;
}

async function download(f: TgFile, name: string): Promise<{ path: string; size: number }> {
  const info = await tg<{ file_path?: string; file_size?: number }>('getFile', { file_id: f.file_id });
  if (!info.file_path) throw new Error('o Telegram não liberou o arquivo');
  if ((info.file_size ?? 0) > TG_DOWNLOAD_MAX) throw new TgError(413, 'grande demais');
  const r = await http(`https://api.telegram.org/file/bot${tgToken()}/${info.file_path}`, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`download falhou (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), 'atria-tg-'));
  const safe = basename(name).replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `arquivo${extname(info.file_path)}`;
  const path = join(dir, safe);
  writeFileSync(path, buf);
  return { path, size: buf.length };
}

async function answerRequest(m: TgMessage, requestId: string): Promise<void> {
  if (!bridge) return;
  activeRequest = requestId;
  const parts: Part[] = [];
  const tmp: string[] = [];
  const media = mediaOf(m);
  try {
    if (media) {
      if ((media.file.file_size ?? 0) > TG_DOWNLOAD_MAX) {
        await reply(m, `Arquivo grande demais pelo Telegram (limite de 20 MB) — use o formulário:\n${esc(formLink(requestId))}`);
        return;
      }
      try {
        const d = await download(media.file, media.name);
        tmp.push(d.path);
        parts.push({ kind: media.kind, tmpPath: d.path, name: basename(d.path), mime: media.mime, size: d.size });
      } catch (e) {
        if (e instanceof TgError && (e.code === 413 || /too big/i.test(e.message))) {
          await reply(m, `Arquivo grande demais pelo Telegram (limite de 20 MB) — use o formulário:\n${esc(formLink(requestId))}`);
        } else await reply(m, `Não consegui baixar o arquivo: ${esc(errMsg(e))}`);
        return;
      }
    }
    const text = (m.text ?? m.caption ?? '').trim();
    if (text && !text.startsWith('/')) parts.push({ kind: 'text', text });
    if (!parts.length) {
      await reply(m, 'Mande áudio, foto, arquivo ou texto para responder o pedido.');
      return;
    }
    let res: Awaited<ReturnType<InputBridge['applyPart']>> | null = null;
    for (const p of parts) res = await bridge.applyPart(requestId, p);
    const r = res!;
    const lines = [esc(r.summary)];
    if (r.missing.length) lines.push(`Falta: ${esc(r.missing.join(', '))}`);
    else lines.push('Tudo certo. Posso enviar?');
    const extra = r.complete
      ? { reply_markup: { inline_keyboard: [[{ text: 'Enviar e continuar', callback_data: `s:${requestId}` }, { text: 'Ainda não', callback_data: `l:${requestId}` }]] } }
      : {};
    const id = await reply(m, lines.join('\n'), extra);
    if (id) track(id, requestId);
  } catch (e) {
    await reply(m, `Não consegui usar isso: ${esc(errMsg(e))}`);
  } finally {
    // applyPart move o arquivo para a pasta do pedido; o que sobrou no temporário é apagado.
    for (const p of tmp) rmSync(dirname(p), { recursive: true, force: true });
  }
}

async function onMessage(m: TgMessage): Promise<void> {
  const chat = String(m.chat.id);
  const text = (m.text ?? '').trim();
  if (chat !== tgChat()) {
    // Só o chat vinculado conversa com o bot. Vínculo: "/start <código>" com o código da tela de Configurações.
    const code = currentCode();
    const sentCode = text.replace(/^\/start(@\w+)?\s*/i, '').trim().toUpperCase();
    if (code && sentCode === code && /^\/start\b/i.test(text)) {
      setRaw('notify.telegram.chatId', chat);
      kvSet('notify.tg.chatName', chatName(m.chat));
      kvSet('notify.tg.linkCode', '');
      activeRequest = null;
      held = null;
      await reply(null, 'Pronto! Este chat está ligado ao Atria OS. Os avisos e pedidos dos seus workflows chegam aqui.');
    }
    return;
  }
  if (/^\/start\b/i.test(text)) {
    await reply(m, 'Este chat já está ligado ao Atria OS.');
    return;
  }
  if (chatBridge && /^\/projeto(@\w+)?\b/i.test(text)) return projectCommand(m, text.replace(/^\/projeto(@\w+)?\s*/i, '').trim());
  const pend = bridge?.pending() ?? [];
  if (!pend.length) {
    if (chatBridge) return talk(m);
    await reply(m, bridge ? 'Nenhum workflow está esperando resposta agora.' : 'Os pedidos de informação ainda não estão disponíveis neste Atria OS.');
    return;
  }
  const id = routeMessage(m, pend);
  if (id) return answerRequest(m, id);
  held = m;
  const rows = pend.slice(0, 8).map((p) => [{ text: `${p.title} · ${p.workflowName}`.slice(0, 60), callback_data: `p:${p.id}` }]);
  if (chatBridge) rows.push([{ text: 'Não é pedido: falar com a Yui', callback_data: 'y:held' }]);
  await reply(m, 'Para qual pedido é isso?', { reply_markup: { inline_keyboard: rows } });
}

async function projectCommand(m: TgMessage, q: string): Promise<void> {
  if (!chatBridge) return;
  if (!q) {
    await reply(m, `Conversa do Telegram no projeto: <b>${esc(chatBridge.project().name)}</b>.\nPara trocar: /projeto nome (ou /projeto geral).`);
    return;
  }
  const r = chatBridge.setProject(q);
  if (r.ok) await reply(m, `Pronto: a conversa do Telegram agora é no projeto <b>${esc(r.name)}</b>.`);
  else await reply(m, `${esc(r.error)}${r.options.length ? `\nProjetos: ${esc(r.options.slice(0, 20).join(', '))}` : ''}`);
}

// Telegram limita a 4096 caracteres por mensagem: corta em pedaços em quebra de linha.
function chunks(text: string, max = 3900): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out.slice(0, 4);
}

// Conversa com a Yui: texto direto; áudio é transcrito antes. Mensagens do mesmo chat são atendidas em ordem.
let talkQueue: Promise<void> = Promise.resolve();
function talk(m: TgMessage): Promise<void> {
  const job = talkQueue.then(() => talkNow(m)).catch((e) => console.error('notify telegram chat', errMsg(e)));
  talkQueue = job;
  return job;
}
async function talkNow(m: TgMessage): Promise<void> {
  if (!chatBridge) return;
  let text = (m.text ?? m.caption ?? '').trim();
  let source: 'text' | 'voice' = 'text';
  const media = mediaOf(m);
  if (media?.kind === 'audio') {
    if ((media.file.file_size ?? 0) > TG_DOWNLOAD_MAX) {
      await reply(m, 'Áudio grande demais pelo Telegram (limite de 20 MB).');
      return;
    }
    let tmp: string | null = null;
    try {
      const d = await download(media.file, media.name);
      tmp = d.path;
      text = (await chatBridge.transcribe(d.path)).trim();
      source = 'voice';
    } catch (e) {
      await reply(m, `Não consegui ouvir o áudio: ${esc(errMsg(e))}`);
      return;
    } finally {
      if (tmp) rmSync(dirname(tmp), { recursive: true, force: true });
    }
  } else if (media) {
    await reply(m, 'Por aqui eu entendo texto e áudio. Arquivos e fotos só nos pedidos dos workflows.');
    return;
  }
  if (!text || text.startsWith('/')) {
    await reply(m, 'Mande texto ou áudio para falar com a Yui. /projeto mostra ou troca o projeto da conversa.');
    return;
  }
  void tg('sendChatAction', { chat_id: tgChat(), action: 'typing' }).catch(() => {});
  let answer: string;
  try {
    answer = await chatBridge.ask(text, source);
  } catch (e) {
    answer = `Tive um problema para responder: ${errMsg(e)}`;
  }
  const head = source === 'voice' ? `<i>“${esc(text.slice(0, 300))}${text.length > 300 ? '…' : ''}”</i>\n\n` : '';
  const parts = chunks(answer || 'Pronto.');
  for (let i = 0; i < parts.length; i++) await reply(i === 0 ? m : null, `${i === 0 ? head : ''}${esc(parts[i])}`);
}

async function onCallback(q: NonNullable<TgUpdate['callback_query']>): Promise<void> {
  if (String(q.message?.chat.id ?? '') !== tgChat()) return;
  const [op, id] = [(q.data ?? '').slice(0, 1), (q.data ?? '').slice(2)];
  const answer = (text?: string) => tg('answerCallbackQuery', { callback_query_id: q.id, ...(text ? { text } : {}) }).catch(() => {});
  const dropButtons = () =>
    q.message ? tg('editMessageReplyMarkup', { chat_id: tgChat(), message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {}) : Promise.resolve();
  if (op === 'y' && chatBridge) {
    await answer();
    await dropButtons();
    const m = held;
    held = null;
    if (m) await talk(m);
    return;
  }
  if ((op === 'a' || op === 'r') && chatBridge && id) {
    const r = chatBridge.resolveApproval(id, op === 'a');
    await answer(r.ok ? (op === 'a' ? 'Aprovado' : 'Rejeitado') : 'Essa aprovação não está mais pendente.');
    await dropButtons();
    if (r.ok) await reply(q.message?.message_id ?? null, `${op === 'a' ? 'Aprovado' : 'Rejeitado'}${r.title ? `: ${esc(r.title)}` : ''}.`);
    return;
  }
  if (!bridge || !id) return void (await answer());
  if (!bridge.pending().some((p) => p.id === id)) {
    await answer('Esse pedido não está mais esperando.');
    return void (await dropButtons());
  }
  if (op === 'p') {
    await answer();
    await dropButtons();
    const m = held;
    held = null;
    activeRequest = id;
    if (m) await answerRequest(m, id);
    return;
  }
  if (op === 'l') {
    await answer('Ok, aguardo o resto.');
    return void (await dropButtons());
  }
  if (op === 's') {
    await dropButtons();
    let r: { ok: boolean; error?: string };
    try {
      r = await bridge.submit(id, 'telegram');
    } catch (e) {
      r = { ok: false, error: errMsg(e) };
    }
    await answer(r.ok ? 'Enviado' : 'Não deu');
    if (r.ok) {
      if (activeRequest === id) activeRequest = null;
      await reply(q.message?.message_id ?? null, 'Enviado. O workflow continua — aviso quando terminar.');
    } else await reply(q.message?.message_id ?? null, `Não consegui enviar: ${esc(r.error ?? 'erro')}\nResponda pelo formulário: ${esc(formLink(id))}`);
    return;
  }
  await answer();
}

/** Trata um update do getUpdates (exportado para os testes). */
export async function handleUpdate(u: TgUpdate): Promise<void> {
  try {
    if (u.callback_query) await onCallback(u.callback_query);
    else if (u.message) await onMessage(u.message);
  } catch (e) {
    console.error('notify telegram update', errMsg(e));
  }
}

// ---------- Telegram: long polling ----------

let pollGen = 0;
let pollError: string | null = null;
let botName: string | null = kvGet('notify.tg.botName') || null;

const sleep = (ms: number, gen: number) =>
  new Promise<void>((r) => {
    const t0 = Date.now();
    const tick = () => (gen !== pollGen || Date.now() - t0 >= ms ? r() : setTimeout(tick, Math.min(500, ms)));
    tick();
  });

export function stopTelegramPolling(): void {
  pollGen++;
}

/** (Re)inicia o loop de getUpdates com o token atual; sem token, só para. Devolve a promessa do loop (testes). */
export function startTelegramPolling(): Promise<void> {
  const gen = ++pollGen;
  const token = tgToken();
  pollError = null;
  if (!token) return Promise.resolve();
  return (async () => {
    let backoff = 2000;
    try {
      const me = await tg<{ username?: string }>('getMe', {}, 15_000, token);
      botName = me.username ? `@${me.username}` : null;
      kvSet('notify.tg.botName', botName ?? '');
    } catch (e) {
      pollError = e instanceof TgError && e.code === 401 ? 'token recusado pelo Telegram' : errMsg(e);
      if (e instanceof TgError && e.code === 401) return;
    }
    while (gen === pollGen) {
      try {
        const offset = Number(kvGet('notify.tg.offset') ?? 0);
        const ups = await tg<TgUpdate[]>('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 35_000, token);
        if (gen !== pollGen) return;
        pollError = null;
        backoff = 2000;
        for (const u of ups) {
          kvSet('notify.tg.offset', String(u.update_id + 1)); // antes de tratar: um update problemático não volta em loop
          await handleUpdate(u);
        }
      } catch (e) {
        if (gen !== pollGen) return;
        const code = e instanceof TgError ? e.code : 0;
        pollError = code === 401 ? 'token recusado pelo Telegram' : code === 409 ? 'outro programa está lendo este bot (webhook ou outra instalação)' : errMsg(e);
        if (code === 401) return;
        await sleep(backoff, gen);
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  })();
}

export function notifyStatus(): NotifyStatus {
  const devices = (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n;
  const to = emailTo();
  return {
    telegram: {
      configured: !!tgToken(),
      linked: !!tgChat(),
      chatName: tgChat() ? kvGet('notify.tg.chatName') || null : null,
      botName: tgToken() ? botName : null,
      linkCode: tgToken() ? currentCode() : null,
      error: tgToken() ? pollError : null,
    },
    email: { configured: !!getSetting('notify.email.resendKey') && !!to, to: to || null, from: getSetting('notify.email.resendKey') ? emailFrom() : null },
    push: { devices },
    remindHours: Number(getSetting('notify.remindHours') ?? 24),
  };
}

export function register(app: FastifyInstance): void {
  onSettingsChange((keys) => {
    if (keys.includes('notify.telegram.token')) {
      kvSet('notify.tg.offset', '0'); // bot novo: começa do zero
      botName = null;
      kvSet('notify.tg.botName', '');
      void startTelegramPolling();
    }
  });
  void startTelegramPolling();

  app.get('/api/notify/status', () => notifyStatus());

  app.post('/api/notify/test', async (req, reply) => {
    const channel = (req.body as { channel?: string } | undefined)?.channel;
    if (channel !== 'telegram' && channel !== 'email' && channel !== 'push') return reply.code(400).send({ error: 'canal: telegram, email ou push' });
    const label = { telegram: 'Telegram', email: 'e-mail', push: 'notificação' }[channel];
    const [r] = await sendNotice({ title: 'Teste do Atria OS', text: `Se você recebeu isto, os avisos por ${label} estão funcionando.`, url: publicUrl('/app'), channels: [channel], kind: 'notice' });
    return r;
  });

  app.post('/api/notify/telegram/link-code', async (_req, reply) => {
    if (!tgToken()) return reply.code(400).send({ error: 'cole o token do bot primeiro' });
    return { code: newLinkCode() };
  });

  app.delete('/api/notify/telegram/link', async (_req, reply) => {
    unlinkTelegram();
    return reply.code(204).send();
  });
}

// Testes: zera o estado em memória do Telegram.
export function resetTelegramState(): void {
  sentFor.clear();
  activeRequest = null;
  held = null;
  pollError = null;
}
