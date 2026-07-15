// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
// Persistent, digest-addressed artifact thumbnails. Only validated server-owned
// artifact ids and SHA-256 digests are ever used to construct filesystem paths.
import { randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const DEFAULT_MAX_PNG_BYTES = 7_500_000;

const ARTIFACT_ID = /^[0-9a-z]{6,24}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function validArtifactId(value) {
  return ARTIFACT_ID.test(String(value || ""));
}

export function validDigest(value) {
  return SHA256.test(String(value || ""));
}

export function validPng(value, maxBytes = DEFAULT_MAX_PNG_BYTES) {
  return Buffer.isBuffer(value) && value.length >= PNG_SIGNATURE.length && value.length <= maxBytes
    && value.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function safeColor(value, org) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${[...color.slice(1)].map((c) => c + c).join("")}`;
  let hash = 2166136261;
  for (const char of String(org || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `hsl(${(hash >>> 0) % 360} 68% 44%)`;
}

export function thumbnailPlaceholder(meta, accent) {
  const bundle = !!meta?.is_bundle;
  const label = bundle ? "BUNDLE" : "HTML";
  const detail = bundle ? "Bundle preview" : "Preview temporarily unavailable";
  const color = safeColor(accent, meta?.org);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750" role="img" aria-label="${detail}">
<rect width="1200" height="750" fill="#f4f1ea"/><rect x="56" y="56" width="1088" height="638" rx="18" fill="#fff" stroke="#d8d2c5" stroke-width="3"/>
<rect x="96" y="96" width="152" height="42" rx="7" fill="${color}"/><text x="172" y="124" text-anchor="middle" font-family="ui-monospace,monospace" font-size="20" font-weight="700" fill="#fff">${label}</text>
<path d="M96 194h620M96 242h820M96 290h710" stroke="#d8d2c5" stroke-width="22" stroke-linecap="round"/>
<circle cx="600" cy="474" r="62" fill="${color}" opacity=".12"/><path d="M600 442v64M568 474h64" stroke="${color}" stroke-width="10" stroke-linecap="round"/>
<text x="600" y="586" text-anchor="middle" font-family="system-ui,sans-serif" font-size="27" fill="#596273">${detail}</text></svg>`);
}

export function createThumbnailStore({
  dataDir = process.env.DATA_DIR || "/data",
  renderer,
  maxPngBytes = process.env.PREVIEW_MAX_PNG_BYTES,
  logger = console
} = {}) {
  const previewDir = path.join(dataDir, "previews");
  const maxBytes = positiveInteger(maxPngBytes, DEFAULT_MAX_PNG_BYTES);
  const inflight = new Map();

  function artifactDir(id) {
    if (!validArtifactId(id)) return null;
    return path.join(previewDir, id);
  }

  function thumbnailPath(id, digest) {
    const dir = artifactDir(id);
    if (!dir || !validDigest(digest)) return null;
    return path.join(dir, `${digest}.png`);
  }

  async function removePath(target, options = {}) {
    try { await rm(target, { force: true, ...options }); } catch {}
  }

  async function readThumbnail(meta, requestedDigest = meta?.body_sha256) {
    if (!meta || meta.is_bundle || requestedDigest !== meta.body_sha256) return null;
    const target = thumbnailPath(meta.id, requestedDigest);
    if (!target) return null;
    try {
      const png = await readFile(target);
      if (validPng(png, maxBytes)) return png;
      await removePath(target);
    } catch {}
    return null;
  }

  async function cleanupObsolete(id, keepDigest) {
    const dir = artifactDir(id);
    if (!dir) return;
    try {
      for (const name of await readdir(dir)) {
        if (name !== `${keepDigest}.png`) await removePath(path.join(dir, name), { recursive: true });
      }
    } catch {}
  }

  async function generate(meta, html) {
    const existing = await readThumbnail(meta);
    if (existing) return existing;
    if (!renderer?.enabled || typeof html !== "string") return null;

    let png;
    try {
      png = await renderer.renderRevisionPreview(meta.id, meta.body_sha256, html);
    } catch {
      return null;
    }
    if (!validPng(png, maxBytes)) return null;

    const dir = artifactDir(meta.id);
    const target = thumbnailPath(meta.id, meta.body_sha256);
    if (!dir || !target) return null;
    const temporary = path.join(dir, `.${meta.body_sha256}.${randomBytes(8).toString("hex")}.tmp`);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(temporary, png, { flag: "wx" });
      await rename(temporary, target);
      await cleanupObsolete(meta.id, meta.body_sha256);
      return png;
    } catch (error) {
      await removePath(temporary);
      logger.warn?.(`[artifact-mcp] thumbnail persistence failed for ${meta.id}: ${String(error?.message || error)}`);
      return null;
    }
  }

  function ensureThumbnail(meta, html) {
    if (!meta || meta.is_bundle || !validArtifactId(meta.id) || !validDigest(meta.body_sha256)) {
      return Promise.resolve(null);
    }
    const key = `${meta.id}:${meta.body_sha256}`;
    if (inflight.has(key)) return inflight.get(key);
    const pending = generate(meta, html).finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
  }

  async function removeArtifact(id) {
    const dir = artifactDir(id);
    if (dir) await removePath(dir, { recursive: true });
  }

  async function audit(artifacts) {
    const report = { orphanDirs: [], partialFiles: [], invalidFiles: [] };
    await mkdir(previewDir, { recursive: true });
    let names = [];
    try { names = await readdir(previewDir, { withFileTypes: true }); } catch { return report; }
    for (const entry of names) {
      const target = path.join(previewDir, entry.name);
      const meta = validArtifactId(entry.name) ? artifacts.getArtifactMeta(entry.name) : null;
      if (!entry.isDirectory() || !meta) {
        report.orphanDirs.push(entry.name);
        await removePath(target, { recursive: true });
        continue;
      }
      let files = [];
      try { files = await readdir(target, { withFileTypes: true }); } catch { continue; }
      for (const file of files) {
        const full = path.join(target, file.name);
        const expected = !meta.is_bundle && file.isFile() && file.name === `${meta.body_sha256}.png`;
        if (!expected) {
          report.partialFiles.push(`${entry.name}/${file.name}`);
          await removePath(full, { recursive: true });
          continue;
        }
        try {
          if (!validPng(await readFile(full), maxBytes)) {
            report.invalidFiles.push(`${entry.name}/${file.name}`);
            await removePath(full);
          }
        } catch {
          report.invalidFiles.push(`${entry.name}/${file.name}`);
          await removePath(full);
        }
      }
    }
    return report;
  }

  return {
    enabled: !!renderer?.enabled,
    maxPngBytes: maxBytes,
    ensureThumbnail,
    readThumbnail,
    removeArtifact,
    audit,
    placeholder: thumbnailPlaceholder
  };
}

// One serial renderer lane. Interactive mutation events always jump ahead of startup backfill.
export function createThumbnailQueue({ thumbnails, logger = console } = {}) {
  const high = [];
  const low = [];
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    while (high.length || low.length) {
      const job = high.shift() || low.shift();
      try {
        const html = typeof job.html === "function" ? await job.html() : job.html;
        job.resolve(await thumbnails.ensureThumbnail(job.meta, html));
      } catch (error) {
        logger.warn?.(`[artifact-mcp] thumbnail job failed for ${job.meta?.id || "unknown"}: ${String(error?.message || error)}`);
        job.resolve(null);
      }
    }
    running = false;
  }

  function enqueue(meta, html, { priority = "high" } = {}) {
    return new Promise((resolve) => {
      (priority === "low" ? low : high).push({ meta, html, resolve });
      queueMicrotask(drain);
    });
  }

  return { enqueue, pending: () => ({ high: high.length, low: low.length, running }) };
}
