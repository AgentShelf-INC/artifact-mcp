import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { LATEST_SCHEMA_VERSION } from "../lib/migrations.js";
import { decrypt } from "../lib/crypto.js";

const ALL_VERSIONS = Array.from({ length: LATEST_SCHEMA_VERSION }, (_, i) => i + 1);

const importDataDir = mkdtempSync(path.join(tmpdir(), "artifact-db-import-"));
process.env.DATA_DIR = importDataDir;
const { default: defaultDb, openDatabase } = await import("../lib/db.js");

after(() => {
  defaultDb.close();
  rmSync(importDataDir, { recursive: true, force: true });
});

test("fresh databases apply ordered migrations with foreign keys enabled", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-db-fresh-"));
  const runtime = openDatabase({ dataDir });

  try {
    const versions = runtime.db.prepare("SELECT version FROM schema_migrations ORDER BY version").pluck().all();
    assert.deepEqual(versions, ALL_VERSIONS);
    assert.equal(runtime.db.pragma("foreign_keys", { simple: true }), 1);
    const foreignKeys = runtime.db.prepare("PRAGMA foreign_key_list(reactions)").all();
    assert.ok(foreignKeys.some((fk) => fk.table === "artifacts" && fk.on_delete === "CASCADE"));
    assert.deepEqual(
      runtime.db.prepare("PRAGMA table_info(notification_reads)").all().map((column) => column.name),
      ["viewer_email", "seen_at"]
    );
  } finally {
    runtime.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("reopening a migrated database is idempotent", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-db-reopen-"));
  const first = openDatabase({ dataDir });
  first.db.close();
  const second = openDatabase({ dataDir });

  try {
    const versions = second.db.prepare("SELECT version FROM schema_migrations ORDER BY version").pluck().all();
    assert.deepEqual(versions, ALL_VERSIONS);
  } finally {
    second.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("legacy databases upgrade without losing valid keys, artifacts, or reactions", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-db-legacy-"));
  const legacy = new Database(path.join(dataDir, "artifacts.db"));
  legacy.exec(`
    CREATE TABLE api_keys (
      client_id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    );
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE reactions (
      email TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      vote INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (email, artifact_id)
    );
    INSERT INTO api_keys (client_id, key_hash) VALUES ('legacy-key', 'hash');
    INSERT INTO artifacts (id, client_id, title) VALUES ('abc123', 'legacy-key', 'Legacy artifact');
    INSERT INTO reactions (email, artifact_id, favorite, vote) VALUES ('viewer@example.com', 'abc123', 1, 1);
    INSERT INTO reactions (email, artifact_id, favorite, vote) VALUES ('orphan@example.com', 'missing1', 1, -1);
  `);
  legacy.close();

  const runtime = openDatabase({ dataDir });
  try {
    assert.equal(runtime.db.prepare("SELECT org FROM api_keys WHERE client_id = 'legacy-key'").pluck().get(), "default");
    assert.equal(runtime.db.prepare("SELECT title FROM artifacts WHERE id = 'abc123'").pluck().get(), "Legacy artifact");
    assert.equal(runtime.db.prepare("SELECT COUNT(*) FROM reactions").pluck().get(), 1);
    runtime.db.prepare("DELETE FROM artifacts WHERE id = 'abc123'").run();
    assert.equal(runtime.db.prepare("SELECT COUNT(*) FROM reactions").pluck().get(), 0);
  } finally {
    runtime.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("existing plaintext webhook rows are encrypted in place when a key is configured", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-db-webhook-encryption-"));
  const previousKey = process.env.WEBHOOK_ENC_KEY;
  delete process.env.WEBHOOK_ENC_KEY;
  const first = openDatabase({ dataDir });
  const secretUrl = "https://discord.com/api/webhooks/123/existing-plaintext-token";
  first.db.prepare("INSERT INTO orgs (name) VALUES (?)").run("migration-test");
  first.db.prepare("INSERT INTO org_webhooks (id, org, url) VALUES (?, ?, ?)")
    .run("legacy-webhook", "migration-test", secretUrl);
  first.db.close();

  const key = Buffer.alloc(32, 7).toString("base64");
  process.env.WEBHOOK_ENC_KEY = key;
  const second = openDatabase({ dataDir });
  try {
    const stored = second.db.prepare("SELECT * FROM org_webhooks WHERE id = ?").get("legacy-webhook");
    assert.doesNotMatch(JSON.stringify(stored), /existing-plaintext-token/);
    assert.match(stored.url, /^https:\/\/discord\.com\/…oken$/);
    assert.equal(decrypt(stored, key), secretUrl);
  } finally {
    second.db.close();
    if (previousKey === undefined) delete process.env.WEBHOOK_ENC_KEY;
    else process.env.WEBHOOK_ENC_KEY = previousKey;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
