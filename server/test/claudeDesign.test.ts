import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Claude Design: leitura do token de Design, interpretação do consentimento e aviso no Inbox.
const root = mkdtempSync(join(tmpdir(), 'atria-design-'));
process.env.ATRIA_DATA_DIR = join(root, 'data');
process.env.ATRIA_WORKSPACE_DIR = join(root, 'ws');
process.env.ATRIA_SEED_DIR = join(root, 'seed');
mkdirSync(process.env.ATRIA_DATA_DIR, { recursive: true });

const { interpretConsent, readDesignToken, designReady, designInboxItems } = await import('../src/claudeDesign.ts');
const { kvSet } = await import('../src/db.ts');

test('interpretConsent: concedido, faltando, token vencido e sem escopo', () => {
  assert.deepEqual(interpretConsent(200, { consent: 'agent_design_projects', granted_at: '2026-10-07T18:14:01Z' }), { login: 'ok', consent: 'granted', grantedAt: '2026-10-07T18:14:01Z' });
  assert.equal(interpretConsent(200, { consent: 'agent_design_projects', granted_at: null }).consent, 'missing');
  assert.equal(interpretConsent(401, null).login, 'expired');
  assert.equal(interpretConsent(403, { error: 'needs_design_scopes' }).login, 'missing');
  assert.equal(interpretConsent(500, null).consent, 'unknown');
});

test('readDesignToken: lê designOauth e ignora credencial sem Design', () => {
  const p = join(root, 'creds.json');
  writeFileSync(p, JSON.stringify({ claudeAiOauth: { accessToken: 'a' }, designOauth: { accessToken: 'd', expiresAt: 1, scopes: ['user:design:read'] } }));
  assert.equal(readDesignToken(p)?.accessToken, 'd');
  writeFileSync(p, JSON.stringify({ claudeAiOauth: { accessToken: 'a' } }));
  assert.equal(readDesignToken(p), null);
  assert.equal(readDesignToken(join(root, 'nao-existe.json')), null);
});

test('Inbox: aviso só quando o Claude Design não está pronto', () => {
  const base = { grantedAt: null, checkedAt: new Date().toISOString() };
  kvSet('claude_design_status', JSON.stringify({ ...base, login: 'ok', consent: 'granted', grantedAt: 'x' }));
  assert.equal(designInboxItems().length, 0);
  kvSet('claude_design_status', JSON.stringify({ ...base, login: 'ok', consent: 'missing' }));
  assert.equal(designInboxItems()[0]?.id, 'claude-design');
  kvSet('claude_design_status', JSON.stringify({ ...base, login: 'missing', consent: 'unknown' }));
  assert.match(designInboxItems()[0]?.label ?? '', /design-login/);
  assert.ok(!designReady(null));
});
