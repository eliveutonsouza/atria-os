import { db, now, uid } from './db.ts';
import { registerBrain } from './extensions.ts';
import { sendPush } from './push.ts';
import { agora } from './ambiente.ts';
import { config } from './config.ts';

// Lembretes e timers: "me lembra às 15h de ligar pro contador", "timer de 10 minutos".
// Leves de propósito (rotinas acordam um agente; isto só avisa): push no celular + fala/tela da Yui.

db.exec(`CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  due_at TEXT NOT NULL,
  repeat TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  fired_at TEXT
)`);
db.exec(`CREATE INDEX IF NOT EXISTS reminders_due ON reminders(status, due_at)`);

export const REPETICOES = ['diario', 'dias_uteis', 'semanal', 'mensal'] as const;
export type Repeticao = (typeof REPETICOES)[number];

export interface Lembrete {
  id: string;
  text: string;
  due_at: string;
  repeat: Repeticao | null;
  status: 'pending' | 'done' | 'cancelled' | 'missed';
  created_at: string;
  fired_at: string | null;
}

const DAY = 86_400_000;
// Atrasado mais que isso (servidor fora do ar) não dispara: vira "perdido" e a Yui menciona.
const TOLERANCIA = 3600_000;

// Próxima ocorrência estritamente depois de `after` (fuso sem horário de verão: somar dias preserva a hora local).
export function proxima(dueIso: string, rep: Repeticao, after = Date.now()): string {
  let t = new Date(dueIso);
  const step = () => {
    if (rep === 'diario') t = new Date(t.getTime() + DAY);
    else if (rep === 'semanal') t = new Date(t.getTime() + 7 * DAY);
    else if (rep === 'mensal') {
      const n = new Date(t);
      n.setUTCMonth(n.getUTCMonth() + 1);
      t = n;
    } else {
      do t = new Date(t.getTime() + DAY);
      while (agora(t).fimDeSemana);
    }
  };
  do step();
  while (t.getTime() <= after);
  return t.toISOString();
}

export function criarLembrete(input: { texto: string; quando?: string | null; daquiMinutos?: number | null; repetir?: Repeticao | null }): Lembrete {
  const text = input.texto.trim().slice(0, 300);
  if (!text) throw new Error('lembrete sem texto');
  let due: number;
  if (typeof input.daquiMinutos === 'number' && input.daquiMinutos > 0) due = Date.now() + input.daquiMinutos * 60_000;
  else if (input.quando) due = Date.parse(input.quando);
  else throw new Error('informe quando ou daqui_minutos');
  if (!Number.isFinite(due)) throw new Error(`data inválida: ${input.quando}`);
  if (due < Date.now() - 60_000) throw new Error('esse horário já passou');
  if (due > Date.now() + 400 * DAY) throw new Error('no máximo ~1 ano à frente');
  const rep = input.repetir && REPETICOES.includes(input.repetir) ? input.repetir : null;
  const row: Lembrete = { id: uid().slice(0, 8), text, due_at: new Date(due).toISOString(), repeat: rep, status: 'pending', created_at: now(), fired_at: null };
  db.prepare('INSERT INTO reminders(id, text, due_at, repeat, status, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(row.id, row.text, row.due_at, row.repeat, row.status, row.created_at);
  return row;
}

export const listarLembretes = (incluirPerdidos = true): Lembrete[] =>
  db.prepare(`SELECT * FROM reminders WHERE status = 'pending' ${incluirPerdidos ? "OR status = 'missed'" : ''} ORDER BY due_at`).all() as Lembrete[];

export function cancelarLembrete(id: string): boolean {
  return db.prepare(`UPDATE reminders SET status = 'cancelled' WHERE id = ? AND status IN ('pending', 'missed')`).run(id).changes > 0;
}

export const getLembrete = (id: string): Lembrete | null => (db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as Lembrete | undefined) ?? null;

// Edição pelo painel: só pendentes/perdidos; um perdido editado volta a pendente. null = não existe ou já saiu da fila.
export function editarLembrete(id: string, input: { texto?: string; quando?: string; repetir?: Repeticao | null }): Lembrete | null {
  const cur = getLembrete(id);
  if (!cur || (cur.status !== 'pending' && cur.status !== 'missed')) return null;
  const text = input.texto === undefined ? cur.text : input.texto.trim().slice(0, 300);
  if (!text) throw new Error('lembrete sem texto');
  let due = cur.due_at;
  if (input.quando !== undefined) {
    const t = Date.parse(input.quando);
    if (!Number.isFinite(t)) throw new Error(`data inválida: ${input.quando}`);
    if (t < Date.now() - 60_000) throw new Error('esse horário já passou');
    if (t > Date.now() + 400 * DAY) throw new Error('no máximo ~1 ano à frente');
    due = new Date(t).toISOString();
  } else if (cur.status === 'missed') throw new Error('escolha um novo horário para o lembrete perdido');
  const rep = input.repetir === undefined ? cur.repeat : input.repetir && REPETICOES.includes(input.repetir) ? input.repetir : null;
  db.prepare(`UPDATE reminders SET text = ?, due_at = ?, repeat = ?, status = 'pending' WHERE id = ?`).run(text, due, rep, id);
  return getLembrete(id);
}

export function excluirLembrete(id: string): boolean {
  return db.prepare('DELETE FROM reminders WHERE id = ?').run(id).changes > 0;
}

type Notifier = (text: string) => void;
let notifier: Notifier = () => {};

// Dispara os vencidos. Exportado para teste.
export function disparar(nowMs = Date.now()): Lembrete[] {
  const due = db.prepare(`SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ? ORDER BY due_at`).all(new Date(nowMs).toISOString()) as Lembrete[];
  const fired: Lembrete[] = [];
  for (const r of due) {
    const late = nowMs - Date.parse(r.due_at) > TOLERANCIA;
    if (r.repeat) {
      db.prepare('UPDATE reminders SET due_at = ?, fired_at = ? WHERE id = ?').run(proxima(r.due_at, r.repeat, nowMs), now(), r.id);
    } else {
      db.prepare('UPDATE reminders SET status = ?, fired_at = ? WHERE id = ?').run(late ? 'missed' : 'done', now(), r.id);
    }
    if (late) continue;
    fired.push(r);
    try {
      notifier(`Lembrete: ${r.text}.`);
    } catch (e) {
      console.error('lembrete: aviso', (e as Error).message);
    }
    void sendPush({ title: 'Lembrete da Yui', body: r.text, url: '/', tag: `reminder-${r.id}`, priority: 'high' }, { force: true }).catch((e) =>
      console.error('lembrete: push', (e as Error).message),
    );
  }
  return fired;
}

let started = false;
export function startLembretes(notify: Notifier): void {
  notifier = notify;
  if (started) return;
  started = true;
  disparar();
  setInterval(() => disparar(), 15_000).unref();
}

const horaLocal = (iso: string) => {
  const d = new Date(iso);
  const a = agora(d);
  return a.data === agora().data ? a.hora : `${a.data.slice(8, 10)}/${a.data.slice(5, 7)} ${a.hora}`;
};
const repLabel: Record<Repeticao, string> = { diario: 'todo dia', dias_uteis: 'dias úteis', semanal: 'toda semana', mensal: 'todo mês' };

function snapshot(): string {
  const all = listarLembretes();
  const limite = Date.now() + DAY;
  const proximos = all.filter((r) => r.status === 'pending' && Date.parse(r.due_at) <= limite).slice(0, 5);
  const perdidos = all.filter((r) => r.status === 'missed').slice(0, 3);
  const out: string[] = [];
  if (proximos.length) out.push(`Lembretes nas próximas 24 h: ${proximos.map((r) => `${horaLocal(r.due_at)} ${r.text}`).join('; ')}.`);
  if (perdidos.length) out.push(`Lembretes perdidos (servidor estava fora do ar; avise o usuário e cancele depois): ${perdidos.map((r) => `[${r.id}] ${horaLocal(r.due_at)} ${r.text}`).join('; ')}.`);
  return out.join('\n');
}

const S = (props: Record<string, unknown>, required: string[]) => ({ type: 'object', additionalProperties: false, properties: props, required });

registerBrain({
  name: 'lembretes',
  instructions: `- "Me lembra…", "me avisa às…", "timer/cronômetro de X minutos", "todo dia às 8 me lembra…" => lembrete_criar (aviso no celular + Yui fala na hora). Calcule o horário com o bloco "Agora" (fuso ${config.timezone}); "daqui X min" => daqui_minutos. Confirme em 1 frase com dia e hora. Lembrete NÃO é rotina: create_routine só quando um agente precisa trabalhar.
- "Quais meus lembretes?" => lembrete_listar. "Cancela o lembrete X" => lembrete_cancelar.`,
  snapshot,
  tools: [
    {
      type: 'function', name: 'lembrete_criar', strict: true,
      description: 'Cria lembrete/timer. Use quando (ISO 8601 com fuso, ex. 2026-10-06T15:00:00-03:00) OU daqui_minutos.',
      parameters: S({
        texto: { type: 'string', description: 'o que lembrar, curto (ex.: "ligar pro contador")' },
        quando: { type: ['string', 'null'], description: 'data/hora ISO 8601 com fuso; null se usar daqui_minutos' },
        daqui_minutos: { type: ['number', 'null'], description: 'minutos a partir de agora (timer); null se usar quando' },
        repetir: { type: ['string', 'null'], enum: [...REPETICOES, null], description: 'null = uma vez' },
      }, ['texto', 'quando', 'daqui_minutos', 'repetir']),
    },
    { type: 'function', name: 'lembrete_listar', strict: true, description: 'Lista lembretes pendentes e perdidos.', parameters: S({}, []) },
    {
      type: 'function', name: 'lembrete_cancelar', strict: true, description: 'Cancela um lembrete pelo id (ver lembrete_listar).',
      parameters: S({ id: { type: 'string' } }, ['id']),
    },
  ],
  run(tool, args) {
    try {
      if (tool === 'lembrete_criar') {
        const r = criarLembrete({
          texto: String(args.texto ?? ''),
          quando: typeof args.quando === 'string' ? args.quando : null,
          daquiMinutos: typeof args.daqui_minutos === 'number' ? args.daqui_minutos : null,
          repetir: (args.repetir as Repeticao | null) ?? null,
        });
        return Promise.resolve({ ok: true, id: r.id, quando_local: `${agora(new Date(r.due_at)).texto}`, repetir: r.repeat ? repLabel[r.repeat] : 'uma vez' });
      }
      if (tool === 'lembrete_listar')
        return Promise.resolve(listarLembretes().map((r) => ({ id: r.id, texto: r.text, quando: horaLocal(r.due_at), repetir: r.repeat ? repLabel[r.repeat] : null, perdido: r.status === 'missed' })));
      if (tool === 'lembrete_cancelar') return Promise.resolve(cancelarLembrete(String(args.id)) ? { ok: true } : { ok: false, error: 'lembrete não encontrado' });
    } catch (e) {
      return Promise.resolve({ ok: false, error: (e as Error).message });
    }
    return undefined;
  },
});
