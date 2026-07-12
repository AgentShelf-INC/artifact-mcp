import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { customAlphabet } from "nanoid";
import db, { ARTIFACT_DIR } from "./db.js";
import { MAX_ARTIFACT_BYTES, MAX_BUNDLE_BYTES, MAX_BUNDLE_FILES, MAX_HISTORY } from "./config.js";

const MIME = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", ico: "image/x-icon", woff2: "font/woff2", woff: "font/woff",
  ttf: "font/ttf", txt: "text/plain; charset=utf-8", map: "application/json", xml: "application/xml"
};

const RESERVED = new Set(["mcp", "health", "settings", "raw", "favicon.ico", "robots.txt", ""]);
const generateId = customAlphabet("0123456789abcdefghijkmnpqrstuvwxyz", 12);

const defaultFiles = {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
};

const HISTORY_DIR = ".history";

function mimeFor(filePath) {
  return MIME[filePath.split(".").pop().toLowerCase()] || "application/octet-stream";
}

function sanitizeRel(value) {
  const normalized = path.posix.normalize(String(value || "").replace(/\\/g, "/").replace(/^\/+/, ""));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) return null;
  if (normalized.split("/").some((segment) => segment === "..")) return null;
  return normalized;
}

function normalizeCategory(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 60);
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function safeRemove(files, target) {
  try {
    files.rmSync(target, { recursive: true, force: true });
  } catch {}
}

export function isReserved(id) {
  return RESERVED.has(id) || !/^[0-9a-z]{6,24}$/.test(id);
}

export function createArtifactStore({
  db: database,
  artifactDir,
  files = defaultFiles,
  idFactory = generateId,
  maxBytes = MAX_ARTIFACT_BYTES,
  maxBundleBytes = MAX_BUNDLE_BYTES,
  maxBundleFiles = MAX_BUNDLE_FILES,
  maxHistory = MAX_HISTORY
}) {
  files.mkdirSync(artifactDir, { recursive: true });

  const insert = database.prepare(`
    INSERT INTO artifacts (id, client_id, org, uploader_label, title, description, bytes, is_bundle, entry, category)
    VALUES (@id, @client_id, @org, @uploader_label, @title, @description, @bytes, @is_bundle, @entry, @category)
  `);
  const listIdsByOrg = database.prepare("SELECT id FROM artifacts WHERE org = ? ORDER BY created_at DESC, id DESC");
  const getMetaStmt = database.prepare("SELECT * FROM artifacts WHERE id = ?");
  const listByClient = database.prepare("SELECT * FROM artifacts WHERE client_id = ? ORDER BY created_at DESC");
  const listByOrg = database.prepare("SELECT * FROM artifacts WHERE org = ? ORDER BY client_id ASC, created_at DESC");
  const listAll = database.prepare("SELECT * FROM artifacts ORDER BY org ASC, client_id ASC, created_at DESC");
  const listBodies = database.prepare("SELECT id, is_bundle, bytes FROM artifacts");
  const deleteById = database.prepare("DELETE FROM artifacts WHERE id = ?");
  const updateMetaStmt = database.prepare(`
    UPDATE artifacts
    SET title = @title, description = @description, bytes = @bytes, entry = @entry, category = @category,
        revision = revision + 1, updated_at = datetime('now')
    WHERE id = @id
  `);
  const updateCategoryStmt = database.prepare(
    "UPDATE artifacts SET category = @category, updated_at = datetime('now') WHERE id = @id"
  );
  const restoreMetaStmt = database.prepare(`
    UPDATE artifacts
    SET title = @title, description = @description, bytes = @bytes, entry = @entry,
        category = @category, revision = @revision, updated_at = @updated_at
    WHERE id = @id
  `);
  const insertRevisionStmt = database.prepare(`
    INSERT OR REPLACE INTO artifact_revisions
      (artifact_id, org, revision, title, description, category, bytes, is_bundle, entry)
    VALUES (@artifact_id, @org, @revision, @title, @description, @category, @bytes, @is_bundle, @entry)
  `);
  const deleteRevisionStmt = database.prepare(
    "DELETE FROM artifact_revisions WHERE artifact_id = ? AND revision = ?"
  );
  const listRevisionsStmt = database.prepare(
    "SELECT revision, title, description, category, bytes, is_bundle, entry, created_at FROM artifact_revisions WHERE artifact_id = ? ORDER BY revision DESC"
  );
  const getRevisionStmt = database.prepare(
    "SELECT * FROM artifact_revisions WHERE artifact_id = ? AND revision = ?"
  );
  const prunableRevisionsStmt = database.prepare(
    "SELECT revision, is_bundle FROM artifact_revisions WHERE artifact_id = ? ORDER BY revision DESC LIMIT -1 OFFSET ?"
  );

  function filePath(id) {
    return path.join(artifactDir, `${id}.html`);
  }

  function bundleDir(id) {
    return path.join(artifactDir, id);
  }

  function transientPath(id, kind) {
    return path.join(artifactDir, `.${id}.${kind}-${generateId()}`);
  }

  function nextId() {
    let id;
    do {
      id = idFactory();
    } while (RESERVED.has(id) || files.existsSync(filePath(id)) || files.existsSync(bundleDir(id)) || getMetaStmt.get(id));
    return id;
  }

  function metadata({ id, clientId, org, uploaderLabel, title, description, bytes, isBundle, entry, category }) {
    return {
      id,
      client_id: clientId,
      org: org || "default",
      uploader_label: String(uploaderLabel || "").slice(0, 60),
      title: String(title || "Untitled artifact").slice(0, 200),
      description: String(description || "").slice(0, 500),
      bytes,
      is_bundle: isBundle ? 1 : 0,
      entry: entry || "",
      category: normalizeCategory(category)
    };
  }

  function publish({ clientId, org, uploaderLabel, html, title, description, category }) {
    if (typeof html !== "string" || !html.trim()) throw new Error("html is required");
    const bytes = Buffer.byteLength(html, "utf8");
    if (bytes > maxBytes) throw new Error(`html exceeds ${maxBytes} bytes (got ${bytes})`);

    const id = nextId();
    const staging = transientPath(id, "staging");
    const finalPath = filePath(id);
    let inserted = false;
    try {
      files.writeFileSync(staging, html, "utf8");
      insert.run(metadata({ id, clientId, org, uploaderLabel, title, description, bytes, isBundle: false, category }));
      inserted = true;
      files.renameSync(staging, finalPath);
      return { id, bytes };
    } catch (error) {
      if (inserted) deleteById.run(id);
      safeRemove(files, staging);
      safeRemove(files, finalPath);
      throw error;
    }
  }

  function publishBundle({ clientId, org, uploaderLabel, files: bundleFiles, entry, title, description, category }) {
    if (!bundleFiles || typeof bundleFiles !== "object" || Array.isArray(bundleFiles)) {
      throw new Error("files must be an object of { 'path': 'content' }");
    }
    const names = Object.keys(bundleFiles);
    if (names.length === 0) throw new Error("files is empty");
    if (names.length > maxBundleFiles) throw new Error(`too many files (max ${maxBundleFiles})`);

    let total = 0;
    const clean = [];
    const relativePaths = new Set();
    for (const raw of names) {
      const rel = sanitizeRel(raw);
      if (!rel) throw new Error(`unsafe file path: ${raw}`);
      const content = bundleFiles[raw];
      if (typeof content !== "string") throw new Error(`file "${raw}" content must be a string`);
      total += Buffer.byteLength(content, "utf8");
      clean.push([rel, content]);
      relativePaths.add(rel);
    }
    if (total > maxBundleBytes) throw new Error(`bundle exceeds ${maxBundleBytes} bytes (got ${total})`);

    let selectedEntry = entry ? sanitizeRel(entry) : "";
    if (selectedEntry && !relativePaths.has(selectedEntry)) throw new Error(`entry "${entry}" is not one of the files`);
    if (!selectedEntry) selectedEntry = relativePaths.has("index.html") ? "index.html" : clean.map(([rel]) => rel).find((rel) => rel.endsWith(".html"));
    if (!selectedEntry) throw new Error("no HTML entry found — include index.html or pass an 'entry'");

    const id = nextId();
    const staging = transientPath(id, "staging");
    const finalDir = bundleDir(id);
    let inserted = false;
    try {
      for (const [rel, content] of clean) {
        const full = path.join(staging, rel);
        files.mkdirSync(path.dirname(full), { recursive: true });
        files.writeFileSync(full, content, "utf8");
      }
      insert.run(metadata({
        id, clientId, org, uploaderLabel, title, description, bytes: total, isBundle: true, entry: selectedEntry, category
      }));
      inserted = true;
      files.renameSync(staging, finalDir);
      return { id, bytes: total, entry: selectedEntry, files: clean.length };
    } catch (error) {
      if (inserted) deleteById.run(id);
      safeRemove(files, staging);
      safeRemove(files, finalDir);
      throw error;
    }
  }

  // Validate a complete bundle snapshot (mirrors publishBundle) -> { clean, total, entry }.
  function validateBundle(bundleFiles, entry, preferEntry) {
    if (!bundleFiles || typeof bundleFiles !== "object" || Array.isArray(bundleFiles)) {
      throw new Error("files must be an object of { 'path': 'content' }");
    }
    const names = Object.keys(bundleFiles);
    if (names.length === 0) throw new Error("files is empty");
    if (names.length > maxBundleFiles) throw new Error(`too many files (max ${maxBundleFiles})`);
    let total = 0;
    const clean = [];
    const relativePaths = new Set();
    for (const raw of names) {
      const rel = sanitizeRel(raw);
      if (!rel) throw new Error(`unsafe file path: ${raw}`);
      const content = bundleFiles[raw];
      if (typeof content !== "string") throw new Error(`file "${raw}" content must be a string`);
      total += Buffer.byteLength(content, "utf8");
      clean.push([rel, content]);
      relativePaths.add(rel);
    }
    if (total > maxBundleBytes) throw new Error(`bundle exceeds ${maxBundleBytes} bytes (got ${total})`);
    let selectedEntry = entry ? sanitizeRel(entry) : "";
    if (selectedEntry && !relativePaths.has(selectedEntry)) throw new Error(`entry "${entry}" is not one of the files`);
    if (!selectedEntry && preferEntry && relativePaths.has(preferEntry)) selectedEntry = preferEntry;
    if (!selectedEntry) selectedEntry = relativePaths.has("index.html") ? "index.html" : clean.map(([rel]) => rel).find((rel) => rel.endsWith(".html"));
    if (!selectedEntry) throw new Error("no HTML entry found — include index.html or pass an 'entry'");
    return { clean, total, entry: selectedEntry };
  }

  // Replace an existing artifact in place (same id/URL); bumps revision. Reuses the
  // staging->rename crash-safe lifecycle and rolls back the body if the DB swap fails.
  function update({ id, clientId, isAdmin = false, html, files: bundleFiles, entry, title, description, category }) {
    const meta = getMetaStmt.get(id);
    if (!meta) return { ok: false, reason: "not_found" };
    if (!isAdmin && meta.client_id !== clientId) return { ok: false, reason: "forbidden" };

    const wantsSingle = html !== undefined;
    const wantsBundle = bundleFiles !== undefined;
    if (wantsSingle && wantsBundle) throw new Error("provide either html or files, not both");
    if (wantsSingle && meta.is_bundle) throw new Error("artifact is a bundle; pass files, not html");
    if (wantsBundle && !meta.is_bundle) throw new Error("artifact is single-file; pass html, not files");

    const nextTitle = title === undefined ? meta.title : String(title || "Untitled artifact").slice(0, 200);
    const nextDescription = description === undefined ? meta.description : String(description || "").slice(0, 500);
    const nextCategory = category === undefined ? meta.category : normalizeCategory(category);

    let nextBytes = meta.bytes;
    let nextEntry = meta.entry;
    let staged = null;

    // Stage the new body (if any) BEFORE touching the DB.
    if (wantsSingle) {
      if (typeof html !== "string" || !html.trim()) throw new Error("html is required");
      nextBytes = Buffer.byteLength(html, "utf8");
      if (nextBytes > maxBytes) throw new Error(`html exceeds ${maxBytes} bytes (got ${nextBytes})`);
      staged = transientPath(id, "staging");
      files.writeFileSync(staged, html, "utf8");
    } else if (wantsBundle) {
      const built = validateBundle(bundleFiles, entry, meta.entry);
      nextBytes = built.total;
      nextEntry = built.entry;
      staged = transientPath(id, "staging");
      for (const [rel, content] of built.clean) {
        const full = path.join(staged, rel);
        files.mkdirSync(path.dirname(full), { recursive: true });
        files.writeFileSync(full, content, "utf8");
      }
    }

    // Commit metadata first, THEN swap the body. SQLite's transaction cannot span the
    // filesystem rename, so ordering decides the crash outcome:
    //   - swap-inside-txn: a crash between the rename and the commit rolls the metadata
    //     back but keeps the NEW file, and startup audit then deletes the only copy of the
    //     old body -> permanent data loss + serving uncommitted content.
    //   - commit-then-swap (this): a crash before the swap leaves committed metadata with
    //     the old body still on disk (stale metadata, but no data loss — self-heals on the
    //     next update). A swap *error* compensates by reverting metadata to pre-update.
    const before = {
      id,
      title: meta.title,
      description: meta.description,
      bytes: meta.bytes,
      entry: meta.entry,
      category: meta.category,
      revision: meta.revision,
      updated_at: meta.updated_at
    };
    // Record the OUTGOING revision (metadata) and bump to the next revision atomically.
    database.transaction(() => {
      recordRevisionRow(meta);
      updateMetaStmt.run({ id, title: nextTitle, description: nextDescription, bytes: nextBytes, entry: nextEntry, category: nextCategory });
    })();
    let snap = null;
    try {
      // Snapshot the outgoing body into .history: MOVE it for a body change (frees the final
      // path for the new body), COPY it for a metadata-only change (body stays live).
      snap = snapshotBody(id, meta, { moveBody: !!staged });
      if (staged) {
        files.renameSync(staged, meta.is_bundle ? bundleDir(id) : filePath(id));
        staged = null;
      }
    } catch (error) {
      restoreSnapshotBody(snap);
      if (staged) safeRemove(files, staged);
      database.transaction(() => {
        deleteRevisionStmt.run(id, meta.revision);
        restoreMetaStmt.run(before); // revert committed metadata + revision so it matches the body
      })();
      throw error;
    }
    pruneHistory(id);

    const updated = getMetaStmt.get(id);
    return { ok: true, id, revision: updated.revision, bytes: updated.bytes, is_bundle: !!updated.is_bundle, entry: updated.entry, category: updated.category };
  }

  // Set/clear an artifact's category (bumps updated_at so it surfaces in the new group).
  // Authorization is the caller's responsibility (route uses artifactAccess).
  function setCategory(id, category) {
    const meta = getMetaStmt.get(id);
    if (!meta) return { ok: false, reason: "not_found" };
    const next = normalizeCategory(category);
    updateCategoryStmt.run({ id, category: next });
    return { ok: true, id, category: next };
  }

  function readBundleFile(id, relPath) {
    const meta = getMetaStmt.get(id);
    if (!meta || !meta.is_bundle) return null;
    const rel = relPath ? sanitizeRel(relPath) : meta.entry;
    if (!rel) return null;
    const base = path.resolve(bundleDir(id));
    const full = path.resolve(path.join(base, rel));
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    if (!files.existsSync(full) || !files.statSync(full).isFile()) return null;
    return { content: files.readFileSync(full), contentType: mimeFor(rel) };
  }

  function readArtifact(id) {
    if (isReserved(id)) return null;
    const meta = getMetaStmt.get(id);
    if (!meta) return null;
    const target = filePath(id);
    if (!files.existsSync(target)) return null;
    return { meta, html: files.readFileSync(target, "utf8") };
  }

  function moveBodyToTrash(id, meta) {
    const source = meta?.is_bundle ? bundleDir(id) : filePath(id);
    if (!files.existsSync(source)) return null;
    const trash = transientPath(id, "trash");
    files.renameSync(source, trash);
    return { source, trash };
  }

  function restoreBody(moved) {
    if (!moved || !files.existsSync(moved.trash)) return;
    files.renameSync(moved.trash, moved.source);
  }

  // ---- Version history ------------------------------------------------------------------
  function historyDir(id) {
    return path.join(artifactDir, HISTORY_DIR, id);
  }
  function historyBodyPath(id, revision, isBundle) {
    return path.join(historyDir(id), isBundle ? String(revision) : `${revision}.html`);
  }
  function removeHistory(id) {
    safeRemove(files, historyDir(id));
  }

  // Read a directory tree into { 'rel/path': content } (utf8) — restores a bundle snapshot.
  function readTree(dir, base = dir) {
    const out = {};
    for (const name of files.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (files.statSync(full).isDirectory()) Object.assign(out, readTree(full, base));
      else out[path.relative(base, full).split(path.sep).join("/")] = files.readFileSync(full, "utf8");
    }
    return out;
  }

  function recordRevisionRow(meta) {
    insertRevisionStmt.run({
      artifact_id: meta.id, org: meta.org, revision: meta.revision, title: meta.title,
      description: meta.description, category: meta.category, bytes: meta.bytes,
      is_bundle: meta.is_bundle, entry: meta.entry
    });
  }

  // Snapshot the outgoing revision's body into .history. moveBody=true relocates the live
  // body (freeing the final path for the replacement); moveBody=false copies it (a
  // metadata-only update keeps its body live). Returns a handle for body rollback.
  function snapshotBody(id, meta, { moveBody }) {
    const source = meta.is_bundle ? bundleDir(id) : filePath(id);
    if (!files.existsSync(source)) return null;
    const dest = historyBodyPath(id, meta.revision, meta.is_bundle);
    files.mkdirSync(path.dirname(dest), { recursive: true });
    safeRemove(files, dest);
    if (moveBody) {
      files.renameSync(source, dest);
      return { source, dest, moved: true };
    }
    files.cpSync(source, dest, { recursive: true });
    return { source, dest, moved: false };
  }
  function restoreSnapshotBody(snap) {
    if (!snap || !snap.moved || !files.existsSync(snap.dest)) return;
    files.renameSync(snap.dest, snap.source);
  }

  // Best-effort: keep only the newest maxHistory snapshots per artifact.
  function pruneHistory(id) {
    try {
      for (const row of prunableRevisionsStmt.all(id, Math.max(0, maxHistory))) {
        deleteRevisionStmt.run(id, row.revision);
        safeRemove(files, historyBodyPath(id, row.revision, row.is_bundle));
      }
    } catch {}
  }

  function listRevisions(id) {
    const meta = getMetaStmt.get(id);
    if (!meta) return null;
    return { current: meta.revision, revisions: listRevisionsStmt.all(id) };
  }

  function readHistoryArtifact(id, revision) {
    const rev = getRevisionStmt.get(id, Number(revision));
    if (!rev || rev.is_bundle) return null;
    const p = historyBodyPath(id, rev.revision, false);
    if (!files.existsSync(p)) return null;
    return { meta: rev, html: files.readFileSync(p, "utf8") };
  }

  function readHistoryBundleFile(id, revision, relPath) {
    const rev = getRevisionStmt.get(id, Number(revision));
    if (!rev || !rev.is_bundle) return null;
    const rel = relPath ? sanitizeRel(relPath) : rev.entry;
    if (!rel) return null;
    const base = path.resolve(historyBodyPath(id, rev.revision, true));
    const full = path.resolve(path.join(base, rel));
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    if (!files.existsSync(full) || !files.statSync(full).isFile()) return null;
    return { content: files.readFileSync(full), contentType: mimeFor(rel) };
  }

  // Replay a past revision as a NEW revision (append-only). update() snapshots the current
  // revision first, so a restore is itself undoable. Auth mirrors removeById.
  function restoreById(id, revision, expectedClientId, isAdmin = false) {
    const meta = getMetaStmt.get(id);
    if (!meta) return { ok: false, reason: "not_found" };
    if (!isAdmin && expectedClientId && meta.client_id !== expectedClientId) return { ok: false, reason: "forbidden" };
    const rev = getRevisionStmt.get(id, Number(revision));
    if (!rev) return { ok: false, reason: "revision_not_found" };
    if (!!rev.is_bundle !== !!meta.is_bundle) return { ok: false, reason: "type_mismatch" };
    const bodyPath = historyBodyPath(id, rev.revision, rev.is_bundle);
    if (!files.existsSync(bodyPath)) return { ok: false, reason: "body_missing" };

    const payload = { id, isAdmin: true, title: rev.title, description: rev.description, category: rev.category };
    if (rev.is_bundle) {
      payload.files = readTree(bodyPath);
      payload.entry = rev.entry;
    } else {
      payload.html = files.readFileSync(bodyPath, "utf8");
    }
    const result = update(payload);
    return result.ok ? { ...result, restoredFrom: rev.revision } : result;
  }

  function removeById(id, expectedClientId, isAdmin = false) {
    const meta = getMetaStmt.get(id);
    if (!meta) return false;
    if (!isAdmin && expectedClientId && meta.client_id !== expectedClientId) return false;
    const moved = moveBodyToTrash(id, meta);
    try {
      const info = deleteById.run(id);
      if (info.changes === 0) {
        restoreBody(moved);
        return false;
      }
      if (moved) safeRemove(files, moved.trash);
      removeHistory(id); // revision rows cascade via FK; remove their bodies from disk
      return true;
    } catch (error) {
      restoreBody(moved);
      throw error;
    }
  }

  // Total on-disk size of an installed body (file size, or summed bundle-tree size), or -1
  // if it does not exist. Comparable to artifacts.bytes (both are utf8 byte lengths).
  function bodySizeOnDisk(id, isBundle) {
    try {
      if (!isBundle) return files.statSync(filePath(id)).size;
      let total = 0;
      const walk = (dir) => {
        for (const n of files.readdirSync(dir)) {
          const full = path.join(dir, n);
          const st = files.statSync(full);
          if (st.isDirectory()) walk(full);
          else total += st.size;
        }
      };
      walk(bundleDir(id));
      return total;
    } catch {
      return -1;
    }
  }

  function auditStorage({ cleanTransient = false } = {}) {
    const rows = listBodies.all();
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const expected = new Set(rows.map((row) => row.is_bundle ? row.id : `${row.id}.html`));
    const orphanBodies = [];
    const orphanHistory = [];
    const transientPaths = [];
    const recoveredPaths = [];

    // Process .staging- before .trash- so that if both survive a crash for one id, the
    // staging body (the committed-new content) is restored to the final path and the trash
    // (old body) is then discarded — never the other way around.
    const names = files.readdirSync(artifactDir).slice().sort((a, b) => {
      const rank = (n) => (n.includes(".staging-") ? 0 : n.includes(".trash-") ? 1 : 2);
      return rank(a) - rank(b);
    });
    for (const name of names) {
      if (name === HISTORY_DIR) continue; // version-history store, not an orphan body
      if (name.startsWith(".") && (name.includes(".staging-") || name.includes(".trash-"))) {
        transientPaths.push(name);
        if (cleanTransient) {
          const match = name.match(/^\.([0-9a-z]{6,24})\.(?:staging|trash)-/);
          const row = match ? rowsById.get(match[1]) : null;
          const transient = path.join(artifactDir, name);
          const finalPath = row ? (row.is_bundle ? bundleDir(row.id) : filePath(row.id)) : null;
          if (row && !files.existsSync(finalPath)) {
            // The interrupted body belongs at the (now-empty) final path.
            files.renameSync(transient, finalPath);
            recoveredPaths.push(name);
          } else if (row && name.includes(".staging-") && bodySizeOnDisk(row.id, row.is_bundle) !== row.bytes) {
            // A staged body survived AND the installed body does not match the committed
            // metadata (bytes) — i.e. the process crashed after committing the new revision
            // but before swapping the body in. The staged file IS the committed content;
            // install it instead of discarding it (which would lose the committed update).
            safeRemove(files, finalPath);
            files.renameSync(transient, finalPath);
            recoveredPaths.push(name);
          } else {
            safeRemove(files, transient);
          }
        }
      } else if (!expected.has(name)) {
        orphanBodies.push(name);
      }
    }
    // Reclaim history for artifacts that no longer exist (e.g. a crash between the DB delete
    // and removeHistory). Revision rows already cascade-deleted; this removes their bodies.
    if (cleanTransient) {
      const historyRoot = path.join(artifactDir, HISTORY_DIR);
      if (files.existsSync(historyRoot)) {
        for (const hid of files.readdirSync(historyRoot)) {
          if (!rowsById.has(hid)) {
            safeRemove(files, path.join(historyRoot, hid));
            orphanHistory.push(hid);
          }
        }
      }
    }
    const missingBodies = rows
      .filter((row) => !files.existsSync(row.is_bundle ? bundleDir(row.id) : filePath(row.id)))
      .map((row) => row.id);
    return { missingBodies, orphanBodies, orphanHistory, transientPaths, recoveredPaths };
  }

  return {
    publish,
    publishBundle,
    update,
    restore: ({ id, revision, clientId, isAdmin }) => restoreById(id, revision, clientId, isAdmin),
    restoreArtifactRevision: (id, revision) => restoreById(id, revision, null, true),
    listRevisions,
    readHistoryArtifact,
    readHistoryBundleFile,
    setCategory,
    readBundleFile,
    listOrgIds: (org) => listIdsByOrg.all(org).map((row) => row.id),
    readArtifact,
    listForClient: (clientId) => listByClient.all(clientId),
    listOrgGroupedByClient: (org) => groupBy(listByOrg.all(org), (row) => row.client_id),
    listOrgArtifacts: (org) => listByOrg.all(org),
    listAllGroupedByOrg: () => groupBy(listAll.all(), (row) => row.org),
    remove: ({ id, clientId, isAdmin }) => removeById(id, clientId, isAdmin),
    getArtifactMeta: (id) => isReserved(id) ? null : getMetaStmt.get(id) || null,
    deleteArtifactById: (id) => removeById(id),
    auditStorage
  };
}

const defaultStore = createArtifactStore({ db, artifactDir: ARTIFACT_DIR });

export const publish = defaultStore.publish;
export const publishBundle = defaultStore.publishBundle;
export const update = defaultStore.update;
export const restore = defaultStore.restore;
export const restoreArtifactRevision = defaultStore.restoreArtifactRevision;
export const listRevisions = defaultStore.listRevisions;
export const readHistoryArtifact = defaultStore.readHistoryArtifact;
export const readHistoryBundleFile = defaultStore.readHistoryBundleFile;
export const setCategory = defaultStore.setCategory;
export const readBundleFile = defaultStore.readBundleFile;
export const listOrgIds = defaultStore.listOrgIds;
export const readArtifact = defaultStore.readArtifact;
export const listForClient = defaultStore.listForClient;
export const listOrgGroupedByClient = defaultStore.listOrgGroupedByClient;
export const listOrgArtifacts = defaultStore.listOrgArtifacts;
export const listAllGroupedByOrg = defaultStore.listAllGroupedByOrg;
export const remove = defaultStore.remove;
export const getArtifactMeta = defaultStore.getArtifactMeta;
export const deleteArtifactById = defaultStore.deleteArtifactById;
export const auditStorage = defaultStore.auditStorage;
