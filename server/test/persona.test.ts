import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONA_DEFAULT, TTS_BASE, isDefaultPersona, normalizePersona, personaBlock, ttsInstructions } from '../src/persona.ts';

// Personalidade da Yui: no padrão nada muda nos prompts; ajustes acrescentam instruções.

test('padrão: bloco da voz vazio e áudio do Telegram idêntico ao de antes', () => {
  assert.equal(personaBlock(PERSONA_DEFAULT), '');
  assert.equal(ttsInstructions(PERSONA_DEFAULT), 'Fale em português do Brasil, calma e calorosa, ritmo natural.');
  assert.equal(TTS_BASE, 'Fale em português do Brasil, calma e calorosa, ritmo natural.');
  assert.ok(isDefaultPersona(PERSONA_DEFAULT));
});

test('valores vazios ou inválidos viram o padrão', () => {
  assert.deepEqual(normalizePersona({}), PERSONA_DEFAULT);
  assert.deepEqual(normalizePersona({ warmth: '', humor: 'x', length: 1, pace: 'abc', reactions: '' }), PERSONA_DEFAULT);
  assert.equal(normalizePersona({ pace: 2 }).pace, 1);
  assert.equal(normalizePersona({ pace: '0.9' }).pace, 0.9);
  assert.equal(normalizePersona({ reactions: 'true' }).reactions, true);
});

test('ajustes entram no prompt da voz', () => {
  const b = personaBlock({ warmth: 'acolhedora', humor: 'leve', length: 'naturais', pace: 0.85, reactions: true });
  assert.match(b, /acolhedora e empática/);
  assert.match(b, /humor leve/);
  assert.match(b, /2 a 4 frases/);
  assert.match(b, /bem mais devagar/);
  assert.match(b, /Reações/);
  assert.match(b, /Enquanto ele fala, continue em silêncio/);
});

test('um ajuste só acrescenta só a sua linha', () => {
  const b = personaBlock({ ...PERSONA_DEFAULT, warmth: 'expressiva' });
  assert.equal(b.split('\n- ').length, 2);
  assert.match(b, /expressiva e viva/);
  assert.ok(!isDefaultPersona({ ...PERSONA_DEFAULT, warmth: 'expressiva' }));
});

test('áudio do Telegram mantém a base e soma o tom', () => {
  const t = ttsInstructions({ ...PERSONA_DEFAULT, warmth: 'acolhedora', pace: 0.8 });
  assert.ok(t.startsWith(TTS_BASE));
  assert.match(t, /acolhedor/);
  assert.match(t, /devagar/);
  assert.ok(!t.includes('Ritmo:'));
});
