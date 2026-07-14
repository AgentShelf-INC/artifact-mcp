// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
// Admin key management: generate, list, revoke upload API keys (per org).
// Secrets are shown once at creation and only stored hashed.
import crypto from "node:crypto";
import db from "./db.js";
import { sha256Hex } from "./auth.js";

const listStmt = db.prepare(
  "SELECT client_id, org, label, created_at, revoked_at FROM api_keys ORDER BY (revoked_at IS NOT NULL), org, client_id"
);
const existsStmt = db.prepare("SELECT 1 FROM api_keys WHERE client_id = ?");
const insertStmt = db.prepare("INSERT INTO api_keys (client_id, org, label, key_hash) VALUES (?, ?, ?, ?)");
const revokeStmt = db.prepare(
  "UPDATE api_keys SET revoked_at = datetime('now') WHERE client_id = ? AND revoked_at IS NULL"
);

const NAME_RE = /^[a-z0-9][a-z0-9._-]{1,40}$/i;
const ORG_RE = /^[a-z0-9][a-z0-9._-]{0,40}$/i;

export function listKeys() {
  return listStmt.all();
}

export function createKey({ clientId, org, label }) {
  clientId = String(clientId || "").trim();
  org = String(org || "").trim();
  label = String(label || "").trim().slice(0, 60);
  if (!NAME_RE.test(clientId)) {
    throw new Error("Name must be 2–41 characters: letters, numbers, dot, dash, underscore.");
  }
  if (!ORG_RE.test(org)) {
    throw new Error("Org must be letters, numbers, dot, dash, or underscore.");
  }
  if (existsStmt.get(clientId)) {
    throw new Error(`A key named "${clientId}" already exists.`);
  }
  const secret = crypto.randomBytes(24).toString("hex");
  insertStmt.run(clientId, org, label, sha256Hex(secret));
  return { clientId, org, label, secret };
}

export function revokeKey(clientId) {
  return revokeStmt.run(String(clientId || "")).changes > 0;
}
