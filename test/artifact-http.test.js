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

test("non-HTML bundle assets are not assigned a document sandbox policy", () => {
  const headers = rawArtifactHeaders("text/css; charset=utf-8");

  assert.equal(headers["content-security-policy"], undefined);
  assert.equal(headers["content-type"], "text/css; charset=utf-8");
});

test("download responses retain sandboxing and attachment disposition", () => {
  const headers = rawArtifactHeaders("text/html; charset=utf-8", { downloadName: "report.html" });

  assert.equal(headers["content-disposition"], 'attachment; filename="report.html"');
  assert.match(headers["content-security-policy"], /^sandbox /);
});
