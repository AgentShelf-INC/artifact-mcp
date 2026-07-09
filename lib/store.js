import { writeFileSync, readFileSync, unlinkSync, existsSync, statSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { customAlphabet } from "nanoid";
import db, { ARTIFACT_DIR } from "./db.js";

const MAX_BYTES = Number(process.env.MAX_ARTIFACT_BYTES || 2 * 1024 * 1024); // 2 MB
const MAX_BUNDLE_BYTES = Number(process.env.MAX_BUNDLE_BYTES || 8 * 1024 * 1024); // 8 MB total
const MAX_BUNDLE_FILES = Number(process.env.MAX_BUNDLE_FILES || 100);

const MIME = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", ico: "image/x-icon", woff2: "font/woff2", woff: "font/woff",
  ttf: "font/ttf", txt: "text/plain; charset=utf-8", map: "application/json", xml: "application/xml"
};
function mimeFor(p) {
  return MIME[p.split(".").pop().toLowerCase()] || "application/octet-stream";
}

// Normalize a bundle-relative path; return null if it escapes the bundle or is absolute.
function sanitizeRel(p) {
  const norm = path.posix.normalize(String(p || "").replace(/\\/g, "/").replace(/^\/+/, ""));
  if (!norm || norm === "." || norm === ".." || norm.startsWith("../") || path.posix.isAbsolute(norm)) return null;
  if (norm.split("/").some((seg) => seg === "..")) return null;
  return norm;
}
// URL-safe, unambiguous, 12 chars -> unguessable but tidy.
const newId = customAlphabet("0123456789abcdefghijkmnpqrstuvwxyz", 12);

const RESERVED = new Set(["mcp", "health", "settings", "raw", "favicon.ico", "robots.txt", ""]);

const insert = db.prepare(`
  INSERT INTO artifacts (id, client_id, org, uploader_label, title, description, bytes, is_bundle, entry)
  VALUES (@id, @client_id, @org, @uploader_label, @title, @description, @bytes, @is_bundle, @entry)
`);
const listIdsByOrg = db.prepare("SELECT id FROM artifacts WHERE org = ? ORDER BY created_at DESC, id DESC");
const getMeta = db.prepare("SELECT * FROM artifacts WHERE id = ?");
const listByClient = db.prepare("SELECT * FROM artifacts WHERE client_id = ? ORDER BY created_at DESC");
const listByOrg = db.prepare("SELECT * FROM artifacts WHERE org = ? ORDER BY client_id ASC, created_at DESC");
const listAll = db.prepare("SELECT * FROM artifacts ORDER BY org ASC, client_id ASC, created_at DESC");
const del = db.prepare("DELETE FROM artifacts WHERE id = ? AND client_id = ?");
const delById = db.prepare("DELETE FROM artifacts WHERE id = ?");

function filePath(id) {
  return path.join(ARTIFACT_DIR, `${id}.html`);
}
function bundleDir(id) {
  return path.join(ARTIFACT_DIR, id);
}

export function isReserved(id) {
  return RESERVED.has(id) || !/^[0-9a-z]{6,24}$/.test(id);
}

export function publish({ clientId, org, uploaderLabel, html, title, description }) {
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
    org: org || "default",
    uploader_label: (uploaderLabel || "").slice(0, 60),
    title: (title || "Untitled artifact").slice(0, 200),
    description: (description || "").slice(0, 500),
    bytes,
    is_bundle: 0,
    entry: ""
  });
  return { id, bytes };
}

// Publish a multi-file bundle: files is a map of {relative-path: string-content}.
// Served under /:id/<path> so relative links (_shared.css, other pages) resolve.
export function publishBundle({ clientId, org, uploaderLabel, files, entry, title, description }) {
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new Error("files must be an object of { 'path': 'content' }");
  }
  const names = Object.keys(files);
  if (names.length === 0) throw new Error("files is empty");
  if (names.length > MAX_BUNDLE_FILES) throw new Error(`too many files (max ${MAX_BUNDLE_FILES})`);

  let total = 0;
  const clean = [];
  const relset = new Set();
  for (const raw of names) {
    const rel = sanitizeRel(raw);
    if (!rel) throw new Error(`unsafe file path: ${raw}`);
    const content = files[raw];
    if (typeof content !== "string") throw new Error(`file "${raw}" content must be a string`);
    total += Buffer.byteLength(content, "utf8");
    clean.push([rel, content]);
    relset.add(rel);
  }
  if (total > MAX_BUNDLE_BYTES) throw new Error(`bundle exceeds ${MAX_BUNDLE_BYTES} bytes (got ${total})`);

  let ent = entry ? sanitizeRel(entry) : "";
  if (ent && !relset.has(ent)) throw new Error(`entry "${entry}" is not one of the files`);
  if (!ent) ent = relset.has("index.html") ? "index.html" : clean.map((c) => c[0]).find((p) => p.endsWith(".html"));
  if (!ent) throw new Error("no HTML entry found — include index.html or pass an 'entry'");

  let id;
  do {
    id = newId();
  } while (existsSync(filePath(id)) || existsSync(bundleDir(id)) || RESERVED.has(id));

  const dir = bundleDir(id);
  for (const [rel, content] of clean) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  insert.run({
    id,
    client_id: clientId,
    org: org || "default",
    uploader_label: (uploaderLabel || "").slice(0, 60),
    title: (title || "Untitled artifact").slice(0, 200),
    description: (description || "").slice(0, 500),
    bytes: total,
    is_bundle: 1,
    entry: ent
  });
  return { id, bytes: total, entry: ent, files: clean.length };
}

// Read one file from a bundle. relPath "" -> the entry. Returns {content:Buffer, contentType} or null.
export function readBundleFile(id, relPath) {
  const meta = getMeta.get(id);
  if (!meta || !meta.is_bundle) return null;
  const rel = relPath ? sanitizeRel(relPath) : meta.entry;
  if (!rel) return null;
  const base = path.resolve(bundleDir(id));
  const full = path.resolve(path.join(base, rel));
  if (full !== base && !full.startsWith(base + path.sep)) return null; // traversal guard
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  return { content: readFileSync(full), contentType: mimeFor(rel) };
}

// Ordered artifact ids for one org (gallery order) — for prev/next in the viewer shell.
export function listOrgIds(org) {
  return listIdsByOrg.all(org).map((r) => r.id);
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

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return groups;
}

// A single org's artifacts, grouped by uploader (client_id).
export function listOrgGroupedByClient(org) {
  return groupBy(listByOrg.all(org), (r) => r.client_id);
}

// A single org's artifacts, flat, newest first.
export function listOrgArtifacts(org) {
  return listByOrg.all(org);
}

// Admin view: every artifact grouped by org.
export function listAllGroupedByOrg() {
  return groupBy(listAll.all(), (r) => r.org);
}

function removeFiles(id, meta) {
  try {
    if (meta && meta.is_bundle) rmSync(bundleDir(id), { recursive: true, force: true });
    else unlinkSync(filePath(id));
  } catch {}
}

export function remove({ id, clientId }) {
  const meta = getMeta.get(id);
  const info = del.run(id, clientId);
  if (info.changes > 0) {
    removeFiles(id, meta);
    return true;
  }
  return false;
}

// Metadata for authorization checks on the web delete route.
export function getArtifactMeta(id) {
  return isReserved(id) ? null : getMeta.get(id) || null;
}

// Delete by id only (the web route authorizes admin/org before calling this).
export function deleteArtifactById(id) {
  const meta = getMeta.get(id);
  const info = delById.run(id);
  if (info.changes > 0) {
    removeFiles(id, meta);
    return true;
  }
  return false;
}
