// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
// Optional HTML preview rendering and detached artifact-notification orchestration.

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_VIEWPORT = "1200x630";
const DEFAULT_CACHE_ENTRIES = 32;
const PREVIEW_EVENTS = new Set(["published", "updated", "restored"]);

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseViewport(value) {
  const match = String(value || "").trim().match(/^(\d+)x(\d+)$/i);
  if (!match) return { width: 1200, height: 630 };
  return {
    width: positiveInteger(match[1], 1200),
    height: positiveInteger(match[2], 630)
  };
}

function rendererEndpoint(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const base = new URL(raw.endsWith("/") ? raw : `${raw}/`);
    if (!new Set(["http:", "https:"]).has(base.protocol)) return null;
    return new URL("render", base).toString();
  } catch {
    return null;
  }
}

export function createPreviewRenderer({
  rendererUrl = process.env.PREVIEW_RENDERER_URL,
  timeoutMs = process.env.PREVIEW_RENDER_TIMEOUT_MS,
  viewport = process.env.PREVIEW_VIEWPORT || DEFAULT_VIEWPORT,
  cacheEntries = DEFAULT_CACHE_ENTRIES,
  fetchImpl = globalThis.fetch
} = {}) {
  const endpoint = rendererEndpoint(rendererUrl);
  const timeout = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
  const dimensions = parseViewport(viewport);
  const maxCacheEntries = positiveInteger(cacheEntries, DEFAULT_CACHE_ENTRIES);
  const cache = new Map();

  async function renderPreview(html) {
    if (!endpoint || typeof fetchImpl !== "function" || typeof html !== "string") return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Preview renderer timed out.")), timeout);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ html, ...dimensions }),
        signal: controller.signal,
        redirect: "error"
      });
      if (!response?.ok) return null;
      const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
      if (!contentType.startsWith("image/png")) return null;
      return Buffer.from(await response.arrayBuffer());
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function remember(key, value) {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
    return value;
  }

  function renderRevisionPreview(artifactId, revision, html) {
    if (!endpoint) return Promise.resolve(null);
    const key = `${String(artifactId)}:${String(revision)}`;
    if (cache.has(key)) return remember(key, cache.get(key));
    return remember(key, renderPreview(html));
  }

  return {
    enabled: !!endpoint,
    renderPreview,
    renderRevisionPreview
  };
}

let defaultRenderer;
let defaultSignature;

function configuredRenderer() {
  const signature = [
    process.env.PREVIEW_RENDERER_URL || "",
    process.env.PREVIEW_RENDER_TIMEOUT_MS || "",
    process.env.PREVIEW_VIEWPORT || ""
  ].join("\0");
  if (!defaultRenderer || signature !== defaultSignature) {
    defaultSignature = signature;
    defaultRenderer = createPreviewRenderer();
  }
  return defaultRenderer;
}

export function renderPreview(html) {
  return configuredRenderer().renderPreview(html);
}

export function renderRevisionPreview(artifactId, revision, html) {
  return configuredRenderer().renderRevisionPreview(artifactId, revision, html);
}

export function createArtifactPreviewNotifier({ artifacts, notify, renderer = configuredRenderer() }) {
  function emit(event, org, payload = {}, options = {}) {
    const { artifactMeta, ...deliveryOptions } = options;
    const deliver = (preview) => {
      try { notify.emit(event, org, payload, { ...deliveryOptions, preview }); } catch {}
    };

    if (!renderer.enabled || !PREVIEW_EVENTS.has(event) || !artifactMeta || artifactMeta.is_bundle) {
      deliver(undefined);
      return;
    }

    let artifact;
    try {
      artifact = artifacts.readArtifact(artifactMeta.id);
    } catch {
      deliver(null);
      return;
    }
    if (!artifact || typeof artifact.html !== "string") {
      deliver(null);
      return;
    }

    let pending;
    try {
      pending = renderer.renderRevisionPreview(artifactMeta.id, artifactMeta.revision, artifact.html);
    } catch {
      deliver(null);
      return;
    }
    void Promise.resolve(pending).then(deliver, () => deliver(null));
  }

  return {
    emit,
    ...(typeof notify.test === "function" ? { test: notify.test.bind(notify) } : {})
  };
}
