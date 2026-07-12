import test from "node:test";
import assert from "node:assert/strict";
import { rawArtifactHeaders, injectAnchorBridge, ANCHOR_BRIDGE_MARKER, ANCHOR_BRIDGE } from "../lib/artifact-http.js";

test("anchor bridge injects before the real (last) </body>, not one inside a script string", () => {
  const html = '<html><body><script>var x = "</body>";</script><p>hi</p></body></html>';
  const out = injectAnchorBridge(html);
  const bridgeAt = out.indexOf(ANCHOR_BRIDGE_MARKER);
  assert.ok(bridgeAt > -1, "bridge injected");
  assert.equal(out.split(ANCHOR_BRIDGE_MARKER).length - 1, 1, "injected exactly once");
  // the script string's </body> stays ahead of the bridge; the bridge sits before the LAST </body>
  assert.ok(out.indexOf("</body>") < bridgeAt, "the earlier (in-script) </body> is untouched");
  assert.ok(bridgeAt < out.lastIndexOf("</body>"), "bridge is before the final </body>");
});

test("anchor bridge appends when there is no </body>", () => {
  const out = injectAnchorBridge("<p>no body tag here</p>");
  assert.ok(out.endsWith("</script>"));
  assert.ok(out.includes(ANCHOR_BRIDGE_MARKER));
});

test("anchor bridge handles pointer drag boxes as well as click points", () => {
  assert.match(ANCHOR_BRIDGE, /pointerdown/);
  assert.match(ANCHOR_BRIDGE, /pointermove/);
  assert.match(ANCHOR_BRIDGE, /pointerup/);
  assert.match(ANCHOR_BRIDGE, /w:bw,h:bh/);
  assert.match(ANCHOR_BRIDGE, /data-artifact-anchor-selection/);
});

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
