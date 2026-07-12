function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function mcpJsonLimitFor(maxBundleBytes) {
  // JSON escaping can nearly double ordinary HTML/CSS payloads; reserve a fixed
  // envelope for JSON-RPC metadata, file names, titles, and descriptions too.
  return maxBundleBytes * 2 + 256 * 1024;
}

export const FEEDBACK_MAX_BODY = positiveInteger(process.env.FEEDBACK_MAX_BODY, 4000);
// How many past revisions to retain per artifact (older snapshots are pruned).
export const MAX_HISTORY = positiveInteger(process.env.MAX_HISTORY, 20);
export const MAX_ARTIFACT_BYTES = positiveInteger(process.env.MAX_ARTIFACT_BYTES, 2 * 1024 * 1024);
export const MAX_BUNDLE_BYTES = positiveInteger(process.env.MAX_BUNDLE_BYTES, 8 * 1024 * 1024);
export const MAX_BUNDLE_FILES = positiveInteger(process.env.MAX_BUNDLE_FILES, 100);
export const MCP_JSON_LIMIT = process.env.MCP_JSON_LIMIT || mcpJsonLimitFor(MAX_BUNDLE_BYTES);
