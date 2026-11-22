// Base de dados SQLite (módulo nativo do Node 22+, sem dependências extra)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network TEXT NOT NULL,            -- facebook | instagram | linkedin | x | tiktok | demo
  name TEXT NOT NULL,
  external_id TEXT,                 -- id da página / utilizador na rede
  avatar TEXT,
  access_token TEXT,                -- cifrado
  refresh_token TEXT,               -- cifrado
  expires_at INTEGER,               -- epoch ms
  meta TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL DEFAULT '',
  media TEXT NOT NULL DEFAULT '[]',  -- [{file, mime, url}]
  scheduled_at INTEGER,              -- epoch ms; NULL = rascunho
  status TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | publishing | published | partial | failed
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS post_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  custom_content TEXT,               -- texto específico para esta rede (opcional)
  status TEXT NOT NULL DEFAULT 'pending', -- pending | published | failed
  external_id TEXT,
  url TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER
);

CREATE TABLE IF NOT EXISTS metrics (
  target_id INTEGER PRIMARY KEY REFERENCES post_targets(id) ON DELETE CASCADE,
  impressions INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  fetched_at INTEGER
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  verifier TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_sched ON posts(status, scheduled_at);
`);

module.exports = db;
