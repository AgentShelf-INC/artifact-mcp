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
    org         TEXT NOT NULL DEFAULT 'default',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id          TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL,
    org         TEXT NOT NULL DEFAULT 'default',
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    bytes       INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS artifacts_org_idx ON artifacts(org, client_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS reactions (
    email       TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    favorite    INTEGER NOT NULL DEFAULT 0,
    vote        INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (email, artifact_id)
  );
  CREATE INDEX IF NOT EXISTS reactions_artifact_idx ON reactions(artifact_id);
`);

// Safe additive migration for DBs created before the org column existed.
function ensureColumn(table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
ensureColumn("api_keys", "org", "TEXT NOT NULL DEFAULT 'default'");
ensureColumn("artifacts", "org", "TEXT NOT NULL DEFAULT 'default'");
ensureColumn("api_keys", "label", "TEXT NOT NULL DEFAULT ''");
ensureColumn("artifacts", "uploader_label", "TEXT NOT NULL DEFAULT ''");
ensureColumn("artifacts", "is_bundle", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("artifacts", "entry", "TEXT NOT NULL DEFAULT ''");

export default db;

// Seed keys from env: ARTIFACT_API_KEYS="clientId:org:secret,clientId:org:secret".
// Back-compat: a 2-part "clientId:secret" entry maps to org 'default'.
// BOOTSTRAP ONLY: inserts a key if that client_id doesn't exist yet, and never touches
// existing rows — so keys generated/revoked in Settings (the DB) stay authoritative.
export function seedKeysFromEnv(sha256Hex, raw = process.env.ARTIFACT_API_KEYS || "") {
  if (!raw.trim()) return 0;
  const upsert = db.prepare(`
    INSERT INTO api_keys (client_id, org, key_hash) VALUES (?, ?, ?)
    ON CONFLICT(client_id) DO NOTHING
  `);
  let n = 0;
  for (const entry of raw.split(",")) {
    const parts = entry.split(":").map((s) => s.trim());
    let clientId, org, secret;
    if (parts.length >= 3) {
      [clientId, org, secret] = [parts[0], parts[1], parts.slice(2).join(":")];
    } else if (parts.length === 2) {
      [clientId, org, secret] = [parts[0], "default", parts[1]];
    } else {
      continue;
    }
    if (clientId && secret) {
      upsert.run(clientId, org || "default", sha256Hex(secret));
      n++;
    }
  }
  return n;
}
