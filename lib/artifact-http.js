const DOCUMENT_SANDBOX = "sandbox allow-scripts allow-popups allow-forms allow-modals";

export function rawArtifactHeaders(contentType, { downloadName } = {}) {
  const headers = {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "private, max-age=60"
  };

  if (String(contentType).toLowerCase().startsWith("text/html")) {
    headers["content-security-policy"] = DOCUMENT_SANDBOX;
  }
  if (downloadName) {
    headers["content-disposition"] = `attachment; filename="${downloadName}"`;
  }
  return headers;
}
