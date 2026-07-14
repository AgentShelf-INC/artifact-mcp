// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { migrateDatabase } from "./migrations.js";

export function openDatabase({ dataDir = process.env.DATA_DIR || "/data" } = {}) {
  const artifactDir = path.join(dataDir, "artifacts");
  const dbPath = path.join(dataDir, "artifacts.db");

  mkdirSync(artifactDir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrateDatabase(db);

  return { db, dataDir, artifactDir, dbPath };
}

const runtime = openDatabase();

export const ARTIFACT_DIR = runtime.artifactDir;
export default runtime.db;

// Seed keys from env: ARTIFACT_API_KEYS="clientId:org:secret,clientId:org:secret".
// Back-compat: a 2-part "clientId:secret" entry maps to org 'default'.
// BOOTSTRAP ONLY: inserts a key if that client_id doesn't exist yet, and never touches
// existing rows — so keys generated/revoked in Settings (the DB) stay authoritative.
export function seedKeysFromEnv(sha256Hex, raw = process.env.ARTIFACT_API_KEYS || "") {
  if (!raw.trim()) return 0;
  const insert = runtime.db.prepare(`
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
      insert.run(clientId, org || "default", sha256Hex(secret));
      n++;
    }
  }
  return n;
}
