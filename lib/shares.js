import { customAlphabet } from "nanoid";
import db from "./db.js";

const generateToken = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-", 24);
const insertStmt = db.prepare(`
  INSERT INTO artifact_shares (token, artifact_id, org, created_by, expires_at)
  VALUES (@token, @artifact_id, @org, @created_by, @expires_at)
`);
const resolveStmt = db.prepare(`
  SELECT artifact_id, org FROM artifact_shares
  WHERE token = ? AND revoked_at IS NULL AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
`);
const listStmt = db.prepare(`
  SELECT token, expires_at, created_at, created_by FROM artifact_shares
  WHERE artifact_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
  ORDER BY created_at DESC, token DESC
`);
const revokeStmt = db.prepare(`
  UPDATE artifact_shares SET revoked_at = datetime('now')
  WHERE artifact_id = ? AND token = ? AND revoked_at IS NULL
`);

function expiryFor(expires) {
  if (expires === "24h") return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  if (expires === "never") return null;
  if (typeof expires !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(expires)) {
    throw new Error("expires must be '24h', 'never', or a future ISO date");
  }
  const date = new Date(expires);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw new Error("expires must be a valid future ISO date");
  }
  // Reject impossible calendar dates (e.g. 2027-02-31) that Date silently rolls over into a
  // later, longer-lived expiry than was requested.
  if (/^\d{4}-\d{2}-\d{2}$/.test(expires) && date.toISOString().slice(0, 10) !== expires) {
    throw new Error("expires is not a real calendar date");
  }
  return date.toISOString();
}

export function create({ artifactId, org, createdBy, expires } = {}) {
  const expires_at = expiryFor(expires);
  const token = generateToken();
  insertStmt.run({ token, artifact_id: String(artifactId || ""), org: String(org || ""), created_by: String(createdBy || ""), expires_at });
  return { token, expires_at };
}

export function resolve(token) {
  return resolveStmt.get(String(token || "")) || null;
}

export function listForArtifact(artifactId) {
  return listStmt.all(String(artifactId || ""));
}

export function revoke(artifactId, token) {
  return revokeStmt.run(String(artifactId || ""), String(token || "")).changes > 0;
}
