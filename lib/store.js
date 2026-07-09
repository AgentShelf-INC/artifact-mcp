import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { customAlphabet } from "nanoid";
import db, { ARTIFACT_DIR } from "./db.js";

const MAX_BYTES = Number(process.env.MAX_ARTIFACT_BYTES || 2 * 1024 * 1024); // 2 MB
// URL-safe, unambiguous, 12 chars -> unguessable but tidy.
const newId = customAlphabet("0123456789abcdefghijkmnpqrstuvwxyz", 12);

const RESERVED = new Set(["mcp", "health", "favicon.ico", "robots.txt", ""]);

const insert = db.prepare(`
  INSERT INTO artifacts (id, client_id, title, description, bytes)
  VALUES (@id, @client_id, @title, @description, @bytes)
`);
const getMeta = db.prepare("SELECT * FROM artifacts WHERE id = ?");
const listByClient = db.prepare("SELECT * FROM artifacts WHERE client_id = ? ORDER BY created_at DESC");
const listAll = db.prepare("SELECT * FROM artifacts ORDER BY client_id ASC, created_at DESC");
const del = db.prepare("DELETE FROM artifacts WHERE id = ? AND client_id = ?");

function filePath(id) {
  return path.join(ARTIFACT_DIR, `${id}.html`);
}

export function isReserved(id) {
  return RESERVED.has(id) || !/^[0-9a-z]{6,24}$/.test(id);
}

export function publish({ clientId, html, title, description }) {
  if (typeof html !== "string" || !html.trim()) {
    throw new Error("html is required");
  }
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_BYTES) {
    throw new Error(`html exceeds ${MAX_BYTES} bytes (got ${bytes})`);
  }
  let id;
  do {
    id = newId();
  } while (existsSync(filePath(id)) || RESERVED.has(id));

  writeFileSync(filePath(id), html, "utf8");
  insert.run({
    id,
    client_id: clientId,
    title: (title || "Untitled artifact").slice(0, 200),
    description: (description || "").slice(0, 500),
    bytes
  });
  return { id, bytes };
}

export function readArtifact(id) {
  if (isReserved(id)) return null;
  const meta = getMeta.get(id);
  if (!meta) return null;
  const fp = filePath(id);
  if (!existsSync(fp)) return null;
  return { meta, html: readFileSync(fp, "utf8") };
}

export function listForClient(clientId) {
  return listByClient.all(clientId);
}

export function listGroupedByClient() {
  const rows = listAll.all();
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.client_id)) groups.set(r.client_id, []);
    groups.get(r.client_id).push(r);
  }
  return groups;
}

export function remove({ id, clientId }) {
  const info = del.run(id, clientId);
  if (info.changes > 0) {
    try {
      unlinkSync(filePath(id));
    } catch {}
    return true;
  }
  return false;
}
