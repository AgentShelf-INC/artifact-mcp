import test from "node:test";
import assert from "node:assert/strict";
import { rawArtifactHeaders } from "../lib/artifact-http.js";

test("raw HTML responses are sandboxed into an opaque origin", () => {
  const headers = rawArtifactHeaders("text/html; charset=utf-8");

  assert.equal(
    headers["content-security-policy"],
    "sandbox allow-scripts allow-popups allow-forms allow-modals"
  );
  assert.doesNotMatch(headers["content-security-policy"], /allow-same-origin/);
});

test("non-HTML bundle assets keep their content type but are still sandboxed", () => {
  // .svg / .xml execute scripts when navigated to directly, so the sandbox CSP is applied
  // to every content type, not just text/html. Content type itself is preserved.
  const headers = rawArtifactHeaders("image/svg+xml");

  assert.equal(headers["content-security-policy"], "sandbox allow-scripts allow-popups allow-forms allow-modals");
  assert.doesNotMatch(headers["content-security-policy"], /allow-same-origin/);
  assert.equal(headers["content-type"], "image/svg+xml");
});

test("download responses retain sandboxing and attachment disposition", () => {
  const headers = rawArtifactHeaders("text/html; charset=utf-8", { downloadName: "report.html" });

  assert.equal(headers["content-disposition"], 'attachment; filename="report.html"');
  assert.match(headers["content-security-policy"], /^sandbox /);
});
