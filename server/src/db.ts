import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.ts';

mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(join(config.dataDir, 'yui.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  who TEXT NOT NULL CHECK (who IN ('user','yui')),
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'text',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_at ON messages(at);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  project TEXT,
  instruction TEXT NOT NULL,
  task TEXT NOT NULL,
  state TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  current_op TEXT,
  tools TEXT NOT NULL DEFAULT '[]',
  steps TEXT NOT NULL DEFAULT '[]',
  result TEXT,
  session_id TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'yui',
  routine_id TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS runs_created ON runs(created_at);

CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  t TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS run_events_run ON run_events(run_id);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  title TEXT NOT NULL,
  rows TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  project TEXT,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repos (
  name_with_owner TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  description TEXT,
  language TEXT,
  pushed_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  url TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  project TEXT,
  instruction TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
`);

// Migrações aditivas (colunas novas em tabelas existentes).
function addColumn(table: string, col: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('runs', 'mission_id', 'TEXT');
addColumn('runs', 'step_id', 'TEXT');
addColumn('runs', 'workflow_run_id', 'TEXT');
addColumn('runs', 'display', 'TEXT');
addColumn('routines', 'workflow_id', 'TEXT');
addColumn('approvals', 'kind', 'TEXT');
addColumn('runs', 'context_tokens', 'INTEGER');
addColumn('runs', 'context_window', 'INTEGER');
addColumn('runs', 'num_turns', 'INTEGER');

export const now = () => new Date().toISOString();
export const uid = () => randomUUID();

export function kvGet(key: string): string | null {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function kvSet(key: string, value: string): void {
  db.prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
