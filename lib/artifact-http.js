const DOCUMENT_SANDBOX = "sandbox allow-scripts allow-popups allow-forms allow-modals";

export function rawArtifactHeaders(contentType, { downloadName } = {}) {
  // Apply the document sandbox to EVERY raw response, not just text/html. Uploaded
  // .svg (image/svg+xml) and .xml execute scripts as a document on direct navigation;
  // the sandbox CSP forces a null-origin context so any script can't reach same-origin
  // cookies/endpoints. Harmless (ignored) when the file is loaded as a subresource.
  const headers = {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "private, max-age=60",
    "content-security-policy": DOCUMENT_SANDBOX
  };
  if (downloadName) {
    headers["content-disposition"] = `attachment; filename="${downloadName}"`;
  }
  return headers;
}
