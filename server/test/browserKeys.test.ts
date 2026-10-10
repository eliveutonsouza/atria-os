import { test } from 'node:test';
import assert from 'node:assert/strict';

// Código de tecla da tela ao vivo: sinais não podem virar teclas especiais (o '.' virava Delete).
process.env.ATRIA_DATA_DIR ??= (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'atria-keys-'));
const { virtualKey } = await import('../src/browserLive.ts');

test('pontuação usa a tecla física, nunca o código do caractere', () => {
  assert.equal(virtualKey('.', 'Period'), 190);
  assert.equal(virtualKey(',', 'Comma'), 188);
  assert.equal(virtualKey('-', 'Minus'), 189);
  assert.equal(virtualKey('/', 'IntlRo'), 193); // ABNT2
  assert.equal(virtualKey('(', 'Digit9'), 57);
  assert.equal(virtualKey("'", 'Backquote'), 192); // ABNT2: aspas fica no lugar do `
  assert.notEqual(virtualKey('.', undefined), 46); // nunca Delete
});

test('letras, números, especiais e caracteres sem tecla', () => {
  assert.equal(virtualKey('a', 'KeyA'), 65);
  assert.equal(virtualKey('7', 'Digit7'), 55);
  assert.equal(virtualKey('Enter', 'Enter'), 13);
  assert.equal(virtualKey('F5', 'F5'), 116);
  assert.equal(virtualKey('ç', 'Semicolon'), 186);
  assert.equal(virtualKey('á', 'KeyA'), 65);
  assert.equal(virtualKey('@', undefined), 0);
});
