import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'bot.db')
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  lang TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS completions (
  user_id TEXT PRIMARY KEY,
  expires_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_completions_expires ON completions(expires_at);
`)

// Prepared statements
const upsertUserStmt = db.prepare(`
INSERT INTO users(id, username, first_name, last_name, lang, updated_at)
VALUES (@id, @username, @first_name, @last_name, @lang, @updated_at)
ON CONFLICT(id) DO UPDATE SET
  username=excluded.username,
  first_name=excluded.first_name,
  last_name=excluded.last_name,
  lang=excluded.lang,
  updated_at=excluded.updated_at
`)

const getUserStmt = db.prepare('SELECT * FROM users WHERE id = ?')
const listUserIdsStmt = db.prepare('SELECT id FROM users ORDER BY updated_at DESC LIMIT ? OFFSET ?')

const getSessionStmt = db.prepare('SELECT data, expires_at FROM sessions WHERE user_id = ?')
const upsertSessionStmt = db.prepare(`
INSERT INTO sessions(user_id, data, expires_at, updated_at)
VALUES (@user_id, @data, @expires_at, @updated_at)
ON CONFLICT(user_id) DO UPDATE SET
  data=excluded.data,
  expires_at=excluded.expires_at,
  updated_at=excluded.updated_at
`)
const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE user_id = ?')

const getCompletionStmt = db.prepare('SELECT expires_at FROM completions WHERE user_id = ?')
const upsertCompletionStmt = db.prepare(`
INSERT INTO completions(user_id, expires_at, updated_at)
VALUES (@user_id, @expires_at, @updated_at)
ON CONFLICT(user_id) DO UPDATE SET
  expires_at=excluded.expires_at,
  updated_at=excluded.updated_at
`)
const deleteCompletionStmt = db.prepare('DELETE FROM completions WHERE user_id = ?')

const cleanupSessionsStmt = db.prepare('DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < ?')
const cleanupCompletionsStmt = db.prepare('DELETE FROM completions WHERE expires_at IS NOT NULL AND expires_at < ?')

export function upsertUser(payload) { return upsertUserStmt.run(payload) }
export function getUser(id) { return getUserStmt.get(id) }
export function listUserIds(limit, offset) { return listUserIdsStmt.all(limit, offset).map(r => r.id) }

export function getSessionRow(userId) { return getSessionStmt.get(userId) }
export function setSessionRow(userId, dataStr, expiresAt) { return upsertSessionStmt.run({ user_id: String(userId), data: dataStr, expires_at: expiresAt ?? null, updated_at: Date.now() }) }
export function deleteSessionRow(userId) { return deleteSessionStmt.run(String(userId)) }

export function getCompletionRow(userId) { return getCompletionStmt.get(String(userId)) }
export function setCompletionRow(userId, expiresAt) { return upsertCompletionStmt.run({ user_id: String(userId), expires_at: expiresAt ?? null, updated_at: Date.now() }) }
export function deleteCompletionRow(userId) { return deleteCompletionStmt.run(String(userId)) }

export function cleanupExpired(now = Date.now()) {
  const s = cleanupSessionsStmt.run(now)
  const c = cleanupCompletionsStmt.run(now)
  return { sessions: s.changes || 0, completions: c.changes || 0 }
}

export default db
