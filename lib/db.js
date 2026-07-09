import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/data";
const DB_PATH = path.join(DATA_DIR, "artifacts.db");
export const ARTIFACT_DIR = path.join(DATA_DIR, "artifacts");

mkdirSync(ARTIFACT_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    client_id   TEXT PRIMARY KEY,
    key_hash    TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id          TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    bytes       INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS artifacts_client_idx ON artifacts(client_id, created_at DESC);
`);

export default db;

// Seed keys from env on boot: ARTIFACT_API_KEYS="clientId:secret,clientId:secret".
// Idempotent: (re)hashes and clears revoked_at so config is source of truth for seeded keys.
export function seedKeysFromEnv(sha256Hex, raw = process.env.ARTIFACT_API_KEYS || "") {
  if (!raw.trim()) return 0;
  const upsert = db.prepare(`
    INSERT INTO api_keys (client_id, key_hash, revoked_at) VALUES (?, ?, NULL)
    ON CONFLICT(client_id) DO UPDATE SET key_hash = excluded.key_hash, revoked_at = NULL
  `);
  let n = 0;
  for (const entry of raw.split(",")) {
    const t = entry.trim();
    const i = t.indexOf(":");
    if (i <= 0) continue;
    const clientId = t.slice(0, i).trim();
    const secret = t.slice(i + 1).trim();
    if (clientId && secret) {
      upsert.run(clientId, sha256Hex(secret));
      n++;
    }
  }
  return n;
}
