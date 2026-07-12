import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "artifact-mcp-rpc-"));
process.env.DATA_DIR = dataDir;
const { handleMcp } = await import("../lib/mcp.js");

test.after(() => rmSync(dataDir, { recursive: true, force: true }));

const auth = { clientId: "publisher", org: "acme", label: "Agent" };

async function call(name, args, id = 1) {
  return handleMcp({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args }
  }, auth);
}

test("MCP enforces the published tool input schemas", async () => {
  const missing = await call("publish_artifact", { surprise: true });
  assert.equal(missing.error.code, -32602);
  assert.match(missing.error.message, /html is required/);
  assert.match(missing.error.message, /surprise is not allowed/);

  const nested = await call("publish_bundle", { files: { "index.html": 42 } }, 2);
  assert.equal(nested.error.code, -32602);
  assert.match(nested.error.message, /files\.index\.html must be a string/);
});

test("artifact_stats exposes named audience data only to the owner or an admin", async () => {
  const published = await call("publish_artifact", { html: "<h1>Stats</h1>" }, 3);
  const id = published.result.structuredContent.id;
  const { record } = await import("../lib/views.js");
  record(id, "acme", "viewer@example.test");

  const stats = await call("artifact_stats", { id }, 4);
  assert.equal(stats.result.structuredContent.views, 1);
  assert.deepEqual(stats.result.structuredContent.viewers.map((v) => v.email), ["viewer@example.test"]);

  const denied = await handleMcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "artifact_stats", arguments: { id } } }, { clientId: "other", org: "acme" });
  assert.equal(denied.result.isError, true);
  assert.match(denied.result.content[0].text, /own artifacts/);
});

test("list_feedback exposes anchor reliability while keeping ownership and resolution scoped", async () => {
  const published = await call("publish_artifact", { html: "<h1>Feedback</h1>" }, 6);
  const artifactId = published.result.structuredContent.id;
  const { addFeedback } = await import("../lib/feedback.js");
  const row = addFeedback({
    artifactId, org: "acme", viewerEmail: "viewer@acme.test", body: "At the chart", artifactRevision: 1,
    anchor: { path: "body:nth-child(2)", x: 0.2, y: 0.8, approx: true }
  });

  const listed = await call("list_feedback", { id: artifactId }, 7);
  assert.deepEqual(listed.result.structuredContent.feedback[0].anchor_path, "body:nth-child(2)");
  assert.equal(listed.result.structuredContent.feedback[0].anchor_approx, 1);
  assert.equal(listed.result.structuredContent.feedback[0].artifact_revision, 1);

  const denied = await handleMcp({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "resolve_feedback", arguments: { feedback_id: row.id } } }, { clientId: "other", org: "acme" });
  assert.equal(denied.result.isError, true);
  const resolved = await call("resolve_feedback", { feedback_id: row.id }, 9);
  assert.equal(resolved.result.structuredContent.resolved, true);
  const reopened = await call("reopen_feedback", { feedback_id: row.id }, 10);
  assert.equal(reopened.result.structuredContent.reopened, true);
});

test("feedback anchors persist bounded coordinates while omitted anchors remain general comments", async () => {
  const published = await call("publish_artifact", { html: "<h1>Anchor storage</h1>" }, 10);
  const artifactId = published.result.structuredContent.id;
  const { addFeedback, listForArtifact } = await import("../lib/feedback.js");
  const anchored = addFeedback({
    artifactId, org: "acme", viewerEmail: "viewer@acme.test", body: "This heading", artifactRevision: 3,
    anchor: { path: "html:nth-child(1)>body:nth-child(2)", x: 0.25, y: 0.75 }
  });
  const general = addFeedback({ artifactId, org: "acme", viewerEmail: "viewer@acme.test", body: "General note", artifactRevision: 3 });

  assert.deepEqual(
    { path: anchored.anchor_path, x: anchored.anchor_x, y: anchored.anchor_y, approx: anchored.anchor_approx, revision: anchored.artifact_revision },
    { path: "html:nth-child(1)>body:nth-child(2)", x: 0.25, y: 0.75, approx: 0, revision: 3 }
  );
  assert.deepEqual(
    { path: general.anchor_path, x: general.anchor_x, y: general.anchor_y, approx: general.anchor_approx },
    { path: null, x: null, y: null, approx: 0 }
  );
  // Ordering ties on created_at (1s granularity) then random id, so look the row up by id
  // rather than assuming position 0.
  const listedAnchor = listForArtifact(artifactId).find((f) => f.id === anchored.id);
  assert.ok(listedAnchor, "anchored feedback is listed");
  assert.equal(listedAnchor.anchor_x, 0.25);
});

test("feedback anchor coordinates reject out-of-range values and cap paths", async () => {
  const published = await call("publish_artifact", { html: "<h1>Anchor bounds</h1>" }, 11);
  const artifactId = published.result.structuredContent.id;
  const { addFeedback } = await import("../lib/feedback.js");
  for (const anchor of [{ x: -0.01, y: 0.5 }, { x: 0.5, y: 1.01 }, { x: Infinity, y: 0.5 }]) {
    assert.throws(() => addFeedback({ artifactId, org: "acme", viewerEmail: "viewer@acme.test", body: "Nope", artifactRevision: 1, anchor }), /between 0 and 1/);
  }
  const row = addFeedback({
    artifactId, org: "acme", viewerEmail: "viewer@acme.test", body: "Capped", artifactRevision: 1,
    anchor: { path: "x".repeat(600), x: 0, y: 1, approx: true }
  });
  assert.equal(row.anchor_path.length, 512);
  assert.equal(row.anchor_approx, 1);
});
