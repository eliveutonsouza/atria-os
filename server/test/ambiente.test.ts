import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Noção do "agora" (relógio, clima, feriados) e lembretes.
const root = mkdtempSync(join(tmpdir(), 'yui-amb-'));
process.env.YUI_DATA_DIR = join(root, 'data');
process.env.YUI_WORKSPACE_DIR = join(root, 'ws');
process.env.YUI_SEED_DIR = join(root, 'seed');
process.env.TZ = 'America/Sao_Paulo';
mkdirSync(process.env.YUI_DATA_DIR, { recursive: true });

const amb = await import('../src/ambiente.ts');
const lem = await import('../src/lembretes.ts');
const { db } = await import('../src/db.ts');
const { brainExtensions } = await import('../src/extensions.ts');

const SP = 'America/Sao_Paulo';
// Horário de Brasília = UTC−3 (sem horário de verão).
const br = (ymdhm: string) => new Date(`${ymdhm}:00-03:00`);

test('período do dia nos limites', () => {
  const cases: [string, string][] = [
    ['2026-10-06T04:59', 'madrugada'], ['2026-10-06T05:00', 'manhã'], ['2026-10-06T11:59', 'manhã'],
    ['2026-10-06T12:00', 'tarde'], ['2026-10-06T17:59', 'tarde'], ['2026-10-06T18:00', 'noite'], ['2026-10-06T23:59', 'noite'],
  ];
  for (const [t, p] of cases) assert.equal(amb.agora(br(t), SP).periodo, p, t);
  assert.equal(amb.saudacao('madrugada'), 'Boa noite');
  assert.equal(amb.saudacao('manhã'), 'Bom dia');
});

test('data por extenso, dia da semana, fuso e virada de dia', () => {
  const a = amb.agora(br('2026-10-06T14:32'), SP);
  assert.equal(a.diaSemana, 'terça-feira');
  assert.equal(a.data, '2026-10-06');
  assert.equal(a.hora, '14:32');
  assert.equal(a.fimDeSemana, false);
  assert.match(a.texto, /^terça-feira, 6 de outubro de 2026, 14:32 \(tarde\), fuso America\/Sao_Paulo \(UTC-3\)\. Semana 41\. Dia útil; faltam 25 dia/);
  // 02:30 UTC de quarta = 23:30 de terça em Brasília
  const v = amb.agora(new Date('2026-10-07T02:30:00Z'), SP);
  assert.equal(v.data, '2026-10-06');
  assert.equal(v.periodo, 'noite');
  assert.equal(amb.agora(br('2026-10-10T09:00'), SP).fimDeSemana, true);
  assert.equal(amb.agora(new Date('2026-10-06T17:32:00Z'), 'Asia/Tokyo').data, '2026-10-07');
});

test('previsão do Open-Meteo vira resumo falável', () => {
  const p = amb.parsePrevisao('Goiânia, GO', {
    current: { temperature_2m: 31.4, apparent_temperature: 33.2, relative_humidity_2m: 35, wind_speed_10m: 9.8, weather_code: 2, precipitation: 0, is_day: 1 },
    daily: {
      time: ['2026-10-06', '2026-10-07'], temperature_2m_min: [21.6, 20.9], temperature_2m_max: [33.1, 31.7], precipitation_probability_max: [10, 60],
      precipitation_sum: [0, 4.2], uv_index_max: [9.6, 8.1], weather_code: [2, 80], sunrise: ['2026-10-06T05:58', '2026-10-07T05:57'], sunset: ['2026-10-06T18:21', '2026-10-07T18:21'],
    },
  });
  assert.equal(p.agora.temp, 31);
  assert.equal(p.dias[1].condicao, 'pancadas de chuva fracas');
  assert.equal(
    amb.resumoClima(p),
    'Clima em Goiânia, GO: 31 °C (sensação 33), parcialmente nublado, umidade 35%. Hoje 22–33 °C, chuva 10%, UV 10, sol 05:58–18:21. Amanhã 21–32 °C, pancadas de chuva fracas, chuva 60%.',
  );
});

test('geocodificação escolhe a UF certa e cacheia', async () => {
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ results: [
      { name: 'Planaltina', latitude: -15.6, longitude: -47.6, admin1: 'Distrito Federal', country: 'Brasil', country_code: 'BR', timezone: 'America/Sao_Paulo' },
      { name: 'Planaltina', latitude: -15.4, longitude: -47.5, admin1: 'Goiás', country: 'Brasil', country_code: 'BR', timezone: 'America/Sao_Paulo' },
    ] }));
  }) as typeof fetch;
  try {
    const l = await amb.geocodificar('Planaltina, GO');
    assert.equal(l?.uf, 'GO');
    assert.equal(l?.lat, -15.4);
    await amb.geocodificar('planaltina, go');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = orig;
  }
});

test('feriados: hoje e próximo, a partir do cache', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify([
    { date: '2026-10-12', name: 'Nossa Senhora Aparecida', type: 'national' },
    { date: '2026-11-02', name: 'Finados', type: 'national' },
  ]))) as typeof fetch;
  try {
    await amb.feriados(2026);
  } finally {
    globalThis.fetch = orig;
  }
  assert.equal(amb.linhaFeriados('2026-10-06'), 'Próximo feriado nacional: 12/10 (segunda-feira), Nossa Senhora Aparecida, em 6 dia(s).');
  assert.match(amb.linhaFeriados('2026-10-12'), /^Hoje é feriado nacional: Nossa Senhora Aparecida\. Próximo feriado nacional: 02\/11/);
});

test('falha de rede no clima vira erro amigável, não exceção', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('timeout');
  }) as typeof fetch;
  try {
    const ext = brainExtensions().find((e) => e.name === 'ambiente')!;
    const r = (await ext.run('ambiente_clima', { cidade: 'Cidade Inexistente XYZ', dias: 2 }, { dryRun: false })) as { ok: boolean; error: string };
    assert.equal(r.ok, false);
    assert.match(r.error, /timeout/);
  } finally {
    globalThis.fetch = orig;
  }
});

test('contexto do agora sempre tem a linha Agora', () => {
  const c = amb.contextoAgora(1);
  assert.match(c, /^Agora: .+-feira|^Agora: (sábado|domingo)/);
  assert.match(c, /Cidade do usuário não configurada/);
});

test('lembretes: criar, listar, cancelar e validar', () => {
  const r = lem.criarLembrete({ texto: 'tirar o café', daquiMinutos: 10 });
  assert.ok(Math.abs(Date.parse(r.due_at) - (Date.now() + 600_000)) < 2000);
  assert.ok(lem.listarLembretes().some((x) => x.id === r.id));
  assert.equal(lem.cancelarLembrete(r.id), true);
  assert.equal(lem.cancelarLembrete(r.id), false);
  assert.throws(() => lem.criarLembrete({ texto: 'x', quando: '2020-01-01T10:00:00-03:00' }), /já passou/);
  assert.throws(() => lem.criarLembrete({ texto: 'x' }), /quando/);
  assert.throws(() => lem.criarLembrete({ texto: '', daquiMinutos: 5 }), /sem texto/);
});

test('lembretes: próxima ocorrência recorrente', () => {
  const base = '2026-10-09T11:00:00.000Z'; // sexta 08:00 em Brasília
  const after = Date.parse(base);
  assert.equal(lem.proxima(base, 'diario', after), '2026-10-10T11:00:00.000Z');
  assert.equal(lem.proxima(base, 'dias_uteis', after), '2026-10-12T11:00:00.000Z'); // pula sábado e domingo
  assert.equal(lem.proxima(base, 'semanal', after), '2026-10-16T11:00:00.000Z');
  assert.equal(lem.proxima(base, 'mensal', after), '2026-11-09T11:00:00.000Z');
  // servidor ficou fora 3 dias: pula para a próxima no futuro
  assert.equal(lem.proxima(base, 'diario', after + 3 * 86_400_000 + 1), '2026-10-13T11:00:00.000Z');
});

test('lembretes: disparo avisa, recorrente reagenda, atrasado vira perdido', () => {
  db.prepare('DELETE FROM reminders').run();
  const said: string[] = [];
  lem.startLembretes((t) => said.push(t));
  said.length = 0;
  const t0 = Date.now();
  const ins = db.prepare('INSERT INTO reminders(id, text, due_at, repeat, status, created_at) VALUES(?, ?, ?, ?, ?, ?)');
  ins.run('a', 'ligar pro contador', new Date(t0 - 30_000).toISOString(), null, 'pending', new Date().toISOString());
  ins.run('b', 'beber água', new Date(t0 - 30_000).toISOString(), 'diario', 'pending', new Date().toISOString());
  ins.run('c', 'reunião antiga', new Date(t0 - 5 * 3600_000).toISOString(), null, 'pending', new Date().toISOString());
  const fired = lem.disparar(t0);
  assert.deepEqual(fired.map((f) => f.id).sort(), ['a', 'b']);
  assert.deepEqual(said.sort(), ['Lembrete: beber água.', 'Lembrete: ligar pro contador.']);
  const st = (id: string) => db.prepare('SELECT status, due_at FROM reminders WHERE id = ?').get(id) as { status: string; due_at: string };
  assert.equal(st('a').status, 'done');
  assert.equal(st('b').status, 'pending');
  assert.ok(Date.parse(st('b').due_at) > t0);
  assert.equal(st('c').status, 'missed');
  assert.equal(lem.disparar(t0).length, 0);
});
