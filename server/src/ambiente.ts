import { config } from './config.ts';
import { db, kvGet, kvSet } from './db.ts';
import { registerBrain, registerRunPrompt } from './extensions.ts';
import { getSetting, onSettingsChange } from './settings.ts';

// Noção do "agora": data, hora, período do dia, clima, feriados e cotações.
// O bloco de contexto é síncrono (entra no prompt do cérebro e da voz); clima e feriados vêm de
// caches aquecidos em segundo plano — se a API cair, a linha some e o resto segue.

// ---------- relógio ----------

export type Periodo = 'madrugada' | 'manhã' | 'tarde' | 'noite';
export const periodoDe = (h: number): Periodo => (h < 5 ? 'madrugada' : h < 12 ? 'manhã' : h < 18 ? 'tarde' : 'noite');
export const saudacao = (p: Periodo) => (p === 'manhã' ? 'Bom dia' : p === 'tarde' ? 'Boa tarde' : 'Boa noite');

export interface Agora {
  texto: string;
  periodo: Periodo;
  diaSemana: string;
  data: string; // AAAA-MM-DD local
  hora: string; // HH:MM local
  fimDeSemana: boolean;
}

function partes(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset',
  }).formatToParts(d);
  const g = (t: Intl.DateTimeFormatPartTypes) => f.find((p) => p.type === t)?.value ?? '';
  const num = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); // AAAA-MM-DD
  return { weekday: g('weekday'), day: g('day'), month: g('month'), year: g('year'), hour: g('hour'), minute: g('minute'), offset: g('timeZoneName'), ymd: num };
}

// Semana ISO a partir da data local.
function semanaIso(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const jan1 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - jan1) / 86_400_000 + 1) / 7);
}

export function agora(d = new Date(), tz = config.timezone): Agora {
  const p = partes(d, tz);
  const h = Number(p.hour);
  const periodo = periodoDe(h);
  const fimDeSemana = p.weekday === 'sábado' || p.weekday === 'domingo';
  const [y, m, dd] = p.ymd.split('-').map(Number);
  const fimMes = new Date(Date.UTC(y, m, 0)).getUTCDate() - dd;
  const offset = p.offset.replace('GMT', 'UTC') || 'UTC';
  const texto = `${p.weekday}, ${p.day} de ${p.month} de ${p.year}, ${p.hour}:${p.minute} (${periodo}), fuso ${tz} (${offset}). Semana ${semanaIso(p.ymd)}. ${fimDeSemana ? 'Fim de semana' : 'Dia útil'}; faltam ${fimMes} dia(s) para o fim do mês.`;
  return { texto, periodo, diaSemana: p.weekday, data: p.ymd, hora: `${p.hour}:${p.minute}`, fimDeSemana };
}

const fmtDuracao = (ms: number) => {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} dias`;
};

// Fala anterior do usuário (offset 1 = antes da mensagem atual). Só interessa se faz mais de 1 h.
function ultimaConversa(offset: number): string {
  const row = db.prepare(`SELECT at FROM messages WHERE who = 'user' ORDER BY at DESC LIMIT 1 OFFSET ?`).get(offset) as { at: string } | undefined;
  if (!row) return '';
  const gap = Date.now() - new Date(row.at).getTime();
  return gap > 3600_000 ? `Última conversa com o usuário antes desta: há ${fmtDuracao(gap)}.` : '';
}

// ---------- HTTP com timeout ----------

async function getJson<T>(url: string, ms = 5000): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'yui-console' } });
  if (!r.ok) throw new Error(`${new URL(url).host} respondeu ${r.status}`);
  return (await r.json()) as T;
}

// ---------- localização ----------

export interface Lugar {
  nome: string;
  uf: string | null;
  pais: string;
  lat: number;
  lon: number;
  tz: string;
}

const UF: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba',
  PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
  country_code?: string;
  timezone?: string;
}

// "Goiânia, GO" / "Lisboa" / "Porto, Portugal" → coordenadas (Open-Meteo, sem chave). Cache no kv.
export async function geocodificar(consulta: string): Promise<Lugar | null> {
  const q = consulta.trim();
  if (!q) return null;
  const key = `ambiente:geo:${norm(q)}`;
  const hit = kvGet(key);
  if (hit) return JSON.parse(hit) as Lugar;
  const [nome, ...resto] = q.split(',').map((s) => s.trim()).filter(Boolean);
  const dica = norm(resto.map((r) => UF[r.toUpperCase()] ?? r).join(' '));
  const j = await getJson<{ results?: GeoResult[] }>(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(nome)}&count=10&language=pt&format=json`);
  const rs = j.results ?? [];
  const pick =
    (dica && rs.find((r) => norm(`${r.admin1 ?? ''} ${r.country ?? ''} ${r.country_code ?? ''}`).includes(dica))) || rs[0]; // sem dica: o mais populoso
  if (!pick) return null;
  const uf = pick.country_code === 'BR' ? (Object.entries(UF).find(([, n]) => norm(n) === norm(pick.admin1 ?? ''))?.[0] ?? null) : null;
  const lugar: Lugar = { nome: pick.name, uf, pais: pick.country ?? '', lat: pick.latitude, lon: pick.longitude, tz: pick.timezone ?? config.timezone };
  kvSet(key, JSON.stringify(lugar));
  return lugar;
}

const cidadeConfig = () => String(getSetting('user.city') ?? '').trim();
let lugarAtual: Lugar | null = null;
const nomeLugar = (l: Lugar) => (l.uf ? `${l.nome}, ${l.uf}` : l.pais && l.pais !== 'Brasil' ? `${l.nome}, ${l.pais}` : l.nome);

// ---------- clima ----------

const WMO: Record<number, string> = {
  0: 'céu limpo', 1: 'predominantemente limpo', 2: 'parcialmente nublado', 3: 'nublado', 45: 'neblina', 48: 'neblina com geada',
  51: 'garoa fraca', 53: 'garoa', 55: 'garoa forte', 56: 'garoa congelante', 57: 'garoa congelante forte',
  61: 'chuva fraca', 63: 'chuva', 65: 'chuva forte', 66: 'chuva congelante', 67: 'chuva congelante forte',
  71: 'neve fraca', 73: 'neve', 75: 'neve forte', 77: 'grãos de neve', 80: 'pancadas de chuva fracas', 81: 'pancadas de chuva',
  82: 'pancadas de chuva fortes', 85: 'pancadas de neve', 86: 'pancadas de neve fortes', 95: 'trovoadas', 96: 'trovoadas com granizo', 99: 'trovoadas com granizo forte',
};
export const condicao = (code: number) => WMO[code] ?? `código ${code}`;

export interface Previsao {
  lugar: string;
  agora: { temp: number; sensacao: number; umidade: number; vento_kmh: number; condicao: string; chuva_mm: number; dia: boolean };
  dias: { data: string; min: number; max: number; chuva_prob: number; chuva_mm: number; uv: number; condicao: string; nascer: string; por: string }[];
}

interface OmForecast {
  current: { temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; wind_speed_10m: number; weather_code: number; precipitation: number; is_day: number };
  daily: { time: string[]; temperature_2m_min: number[]; temperature_2m_max: number[]; precipitation_probability_max: (number | null)[]; precipitation_sum: number[]; uv_index_max: (number | null)[]; weather_code: number[]; sunrise: string[]; sunset: string[] };
}

export function parsePrevisao(lugar: string, j: OmForecast): Previsao {
  const c = j.current;
  const d = j.daily;
  const r = (n: number) => Math.round(n);
  return {
    lugar,
    agora: { temp: r(c.temperature_2m), sensacao: r(c.apparent_temperature), umidade: r(c.relative_humidity_2m), vento_kmh: r(c.wind_speed_10m), condicao: condicao(c.weather_code), chuva_mm: c.precipitation, dia: c.is_day === 1 },
    dias: d.time.map((t, i) => ({
      data: t, min: r(d.temperature_2m_min[i]), max: r(d.temperature_2m_max[i]), chuva_prob: d.precipitation_probability_max[i] ?? 0,
      chuva_mm: d.precipitation_sum[i], uv: Math.round(d.uv_index_max[i] ?? 0), condicao: condicao(d.weather_code[i]),
      nascer: d.sunrise[i].slice(11, 16), por: d.sunset[i].slice(11, 16),
    })),
  };
}

export async function previsao(l: Lugar, dias = 2): Promise<Previsao> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${l.lat}&longitude=${l.lon}&timezone=auto&forecast_days=${Math.max(1, Math.min(7, dias))}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,precipitation,is_day' +
    '&daily=temperature_2m_min,temperature_2m_max,precipitation_probability_max,precipitation_sum,uv_index_max,weather_code,sunrise,sunset';
  return parsePrevisao(nomeLugar(l), await getJson<OmForecast>(url));
}

export function resumoClima(p: Previsao): string {
  const a = p.agora;
  const [hoje, amanha] = p.dias;
  const parts = [`Clima em ${p.lugar}: ${a.temp} °C (sensação ${a.sensacao}), ${a.condicao}, umidade ${a.umidade}%.`];
  if (hoje) parts.push(`Hoje ${hoje.min}–${hoje.max} °C, chuva ${hoje.chuva_prob}%, UV ${hoje.uv}, sol ${hoje.nascer}–${hoje.por}.`);
  if (amanha) parts.push(`Amanhã ${amanha.min}–${amanha.max} °C, ${amanha.condicao}, chuva ${amanha.chuva_prob}%.`);
  return parts.join(' ');
}

let climaCache: { linha: string; at: number } | null = null;
const CLIMA_TTL = 30 * 60_000;

async function atualizarClima(): Promise<void> {
  const cidade = cidadeConfig();
  if (!cidade) {
    lugarAtual = null;
    climaCache = null;
    return;
  }
  try {
    lugarAtual = await geocodificar(cidade);
    if (!lugarAtual) {
      climaCache = { linha: `Cidade configurada "${cidade}" não foi encontrada no mapa.`, at: Date.now() };
      return;
    }
    climaCache = { linha: resumoClima(await previsao(lugarAtual, 2)), at: Date.now() };
  } catch (e) {
    console.error('ambiente: clima', (e as Error).message);
    if (climaCache && Date.now() - climaCache.at > 3 * CLIMA_TTL) climaCache = null; // velho demais: melhor não dizer
  }
}

// ---------- feriados ----------

export interface Feriado {
  date: string;
  name: string;
  type: string;
}
const feriadosMem = new Map<number, Feriado[]>();

export async function feriados(ano: number): Promise<Feriado[]> {
  const mem = feriadosMem.get(ano);
  if (mem) return mem;
  const key = `ambiente:feriados:${ano}`;
  const hit = kvGet(key);
  if (hit) {
    const v = JSON.parse(hit) as Feriado[];
    feriadosMem.set(ano, v);
    return v;
  }
  const v = await getJson<Feriado[]>(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
  kvSet(key, JSON.stringify(v));
  feriadosMem.set(ano, v);
  return v;
}

const diaSemanaDe = (ymd: string) => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`));
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

// Linha síncrona a partir do cache de memória (aquecido por atualizarFeriados).
export function linhaFeriados(hoje: string): string {
  const ano = Number(hoje.slice(0, 4));
  const lista = [...(feriadosMem.get(ano) ?? []), ...(feriadosMem.get(ano + 1) ?? [])];
  if (!lista.length) return '';
  const deHoje = lista.find((f) => f.date === hoje);
  const prox = lista.find((f) => f.date > hoje);
  const out: string[] = [];
  if (deHoje) out.push(`Hoje é feriado nacional: ${deHoje.name}.`);
  if (prox) {
    const dias = Math.round((Date.parse(prox.date) - Date.parse(hoje)) / 86_400_000);
    out.push(`Próximo feriado nacional: ${ddmm(prox.date)} (${diaSemanaDe(prox.date)}), ${prox.name}, em ${dias} dia(s).`);
  }
  return out.join(' ');
}

async function atualizarFeriados(): Promise<void> {
  const ano = Number(agora().data.slice(0, 4));
  for (const a of [ano, ano + 1]) {
    try {
      await feriados(a);
    } catch (e) {
      console.error('ambiente: feriados', a, (e as Error).message);
    }
  }
}

// ---------- cotações ----------

let cotacoesCache: { v: unknown; at: number } | null = null;

// Dólar/euro: referência diária do BCE (Frankfurter); bitcoin: CoinGecko; taxas: BrasilAPI. Todos sem chave.
export async function cotacoes(): Promise<unknown> {
  if (cotacoesCache && Date.now() - cotacoesCache.at < 10 * 60_000) return cotacoesCache.v;
  const fx = (base: string) => getJson<{ date: string; rates: { BRL: number } }>(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=BRL`);
  const [usd, eur, btc, taxas] = await Promise.allSettled([
    fx('USD'),
    fx('EUR'),
    getJson<{ bitcoin: { brl: number; brl_24h_change: number } }>('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl&include_24hr_change=true'),
    getJson<{ nome: string; valor: number }[]>('https://brasilapi.com.br/api/taxas/v1'),
  ]);
  const moedas = [
    usd.status === 'fulfilled' ? { nome: 'dólar', reais: usd.value.rates.BRL, referencia: `BCE ${usd.value.date}` } : null,
    eur.status === 'fulfilled' ? { nome: 'euro', reais: eur.value.rates.BRL, referencia: `BCE ${eur.value.date}` } : null,
    btc.status === 'fulfilled' ? { nome: 'bitcoin', reais: btc.value.bitcoin.brl, variacao_24h_pct: Math.round(btc.value.bitcoin.brl_24h_change * 100) / 100 } : null,
  ].filter(Boolean);
  const v = {
    moedas,
    taxas_pct_ano: taxas.status === 'fulfilled' ? taxas.value.map((t) => ({ nome: t.nome, valor: t.valor })) : [],
    erros: [usd, eur, btc, taxas].filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason?.message ?? r)),
  };
  if (!v.erros.length) cotacoesCache = { v, at: Date.now() };
  return v;
}

// ---------- hora no mundo ----------

const fusoValido = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export async function horaEm(lugar: string): Promise<unknown> {
  let tz = lugar.trim();
  let nome = tz;
  if (!fusoValido(tz)) {
    const l = await geocodificar(lugar);
    if (!l) return { ok: false, error: `não encontrei "${lugar}"` };
    tz = l.tz;
    nome = nomeLugar(l);
  }
  const a = agora(new Date(), tz);
  const local = agora();
  return { ok: true, lugar: nome, fuso: tz, agora: a.texto, mesmo_dia_que_o_usuario: a.data === local.data, hora: a.hora };
}

// ---------- contexto ----------

// Bloco curto que entra no prompt (cérebro e voz). offsetConversa: 1 no cérebro (a fala atual já foi salva), 0 na voz.
export function contextoAgora(offsetConversa = 1): string {
  const a = agora();
  if (climaCache && Date.now() - climaCache.at > CLIMA_TTL) void atualizarClima();
  return [
    `Agora: ${a.texto}`,
    lugarAtual ? `Usuário em ${nomeLugar(lugarAtual)}.` : 'Cidade do usuário não configurada (Configurações → Conta).',
    climaCache?.linha ?? '',
    linhaFeriados(a.data),
    ultimaConversa(offsetConversa),
  ].filter(Boolean).join('\n');
}

let started = false;
export function startAmbiente(): void {
  if (started) return;
  started = true;
  void atualizarClima();
  void atualizarFeriados();
  setInterval(() => void atualizarClima(), CLIMA_TTL).unref();
  setInterval(() => void atualizarFeriados(), 12 * 3600_000).unref();
  onSettingsChange((keys) => {
    if (keys.includes('user.city')) void atualizarClima();
  });
}

// ---------- extensões ----------

registerRunPrompt(() => `- Agora: ${agora().texto} Use esta data/hora como referência para "hoje", "amanhã", prazos e agendamentos.`);

const S = (props: Record<string, unknown>, required: string[]) => ({ type: 'object', additionalProperties: false, properties: props, required });

registerBrain({
  name: 'ambiente',
  instructions: `- Data, hora, dia da semana, período do dia, clima de hoje/amanhã e feriados: responda DIRETO com o bloco "Agora" do contexto — nunca pergunte de volta nem delegue. "Que horas são" = hora atual.
- Previsão de mais dias ou de outra cidade => ambiente_clima. "Que horas são em Lisboa/Tóquio" => ambiente_hora. Lista de feriados => ambiente_feriados. Dólar, euro, bitcoin, Selic, CDI, IPCA => ambiente_cotacoes.
- Sem cidade configurada e pergunta sobre clima: peça a cidade (ou use a que ele disser em ambiente_clima) e sugira configurar em Configurações → Conta.`,
  snapshot: () => contextoAgora(1),
  tools: [
    {
      type: 'function', name: 'ambiente_clima', strict: true,
      description: 'Previsão do tempo (agora + até 7 dias). Sem cidade, usa a cidade configurada do usuário.',
      parameters: S({ cidade: { type: ['string', 'null'], description: 'ex.: "Goiânia, GO", "Lisboa"; null = cidade do usuário' }, dias: { type: ['integer', 'null'], description: '1 a 7; null = 3' } }, ['cidade', 'dias']),
    },
    {
      type: 'function', name: 'ambiente_hora', strict: true,
      description: 'Hora e data atuais em outra cidade ou fuso IANA.',
      parameters: S({ lugar: { type: 'string', description: 'cidade ("Tóquio") ou fuso IANA ("Europe/Lisbon")' } }, ['lugar']),
    },
    {
      type: 'function', name: 'ambiente_feriados', strict: true,
      description: 'Feriados nacionais do Brasil de um ano, com dia da semana.',
      parameters: S({ ano: { type: ['integer', 'null'], description: 'null = ano atual' } }, ['ano']),
    },
    {
      type: 'function', name: 'ambiente_cotacoes', strict: true,
      description: 'Cotações atuais: dólar, euro, bitcoin em reais e taxas Selic, CDI e IPCA.',
      parameters: S({}, []),
    },
  ],
  run(tool, args) {
    const safe = (p: Promise<unknown>) => p.catch((e) => ({ ok: false, error: (e as Error).message }));
    if (tool === 'ambiente_clima')
      return safe(
        (async () => {
          const cidade = typeof args.cidade === 'string' && args.cidade.trim() ? args.cidade : cidadeConfig();
          if (!cidade) return { ok: false, error: 'cidade do usuário não configurada; pergunte a cidade' };
          const l = await geocodificar(cidade);
          if (!l) return { ok: false, error: `não encontrei "${cidade}"` };
          return { ok: true, ...(await previsao(l, typeof args.dias === 'number' ? args.dias : 3)) };
        })(),
      );
    if (tool === 'ambiente_hora') return safe(horaEm(String(args.lugar ?? '')));
    if (tool === 'ambiente_feriados')
      return safe(
        (async () => {
          const ano = typeof args.ano === 'number' ? args.ano : Number(agora().data.slice(0, 4));
          const hoje = agora().data;
          return { ano, feriados: (await feriados(ano)).map((f) => ({ data: ddmm(f.date), dia_semana: diaSemanaDe(f.date), nome: f.name, passou: f.date < hoje })) };
        })(),
      );
    if (tool === 'ambiente_cotacoes') return safe(cotacoes());
    return undefined;
  },
});
