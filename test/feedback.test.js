import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const importDataDir = mkdtempSync(path.join(tmpdir(), "artifact-feedback-import-"));
process.env.DATA_DIR = importDataDir;
const { default: defaultDb, openDatabase } = await import("../lib/db.js");
const { createFeedbackStore } = await import("../lib/feedback.js");

test.after(() => {
  defaultDb.close();
  rmSync(importDataDir, { recursive: true, force: true });
});

function withFeedbackStore(fn) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-feedback-"));
  const runtime = openDatabase({ dataDir });
  const store = createFeedbackStore({ db: runtime.db });
  runtime.db.prepare("INSERT INTO artifacts (id, client_id, org, title) VALUES (?, ?, ?, ?)").run("artifact-a", "owner", "acme", "A");
  runtime.db.prepare("INSERT INTO artifacts (id, client_id, org, title) VALUES (?, ?, ?, ?)").run("artifact-b", "owner", "acme", "B");
  try {
    fn({ db: runtime.db, feedback: store });
  } finally {
    runtime.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test("feedback replies require a same-artifact top-level parent and inherit no anchor", () => {
  withFeedbackStore(({ feedback }) => {
    const parent = feedback.addFeedback({
      artifactId: "artifact-a", org: "acme", viewerEmail: "owner@acme.test", body: "Pinned", artifactRevision: 7,
      anchor: { path: "body", x: 0.25, y: 0.75 }
    });
    const reply = feedback.addFeedback({
      artifactId: "artifact-a", org: "acme", viewerEmail: "reply@acme.test", body: "Reply", artifactRevision: 7,
      parentId: parent.id, anchor: { path: "ignored", x: 0.5, y: 0.5 }
    });
    assert.deepEqual(
      { parent_id: reply.parent_id, anchor_path: reply.anchor_path, anchor_x: reply.anchor_x, anchor_y: reply.anchor_y, anchor_approx: reply.anchor_approx },
      { parent_id: parent.id, anchor_path: null, anchor_x: null, anchor_y: null, anchor_approx: 0 }
    );
    assert.equal(reply.org, "acme");
    assert.equal(reply.artifact_revision, 7);
    assert.throws(() => feedback.addFeedback({ artifactId: "artifact-a", org: "acme", viewerEmail: "x", body: "No parent", artifactRevision: 7, parentId: "missing" }), /parent not found/);
    const other = feedback.addFeedback({ artifactId: "artifact-b", org: "acme", viewerEmail: "x", body: "Other", artifactRevision: 1 });
    assert.throws(() => feedback.addFeedback({ artifactId: "artifact-a", org: "acme", viewerEmail: "x", body: "Cross artifact", artifactRevision: 7, parentId: other.id }), /different artifact/);
    assert.throws(() => feedback.addFeedback({ artifactId: "artifact-a", org: "acme", viewerEmail: "x", body: "Too deep", artifactRevision: 7, parentId: reply.id }), /top-level/);
    assert.equal(feedback.listForArtifact("artifact-a").find((row) => row.id === reply.id).parent_id, parent.id);
  });
});

test("viewer delete and resolve enforce ownership, admin access, and parent cascade", () => {
  withFeedbackStore(({ feedback }) => {
    const parent = feedback.addFeedback({ artifactId: "artifact-a", org: "acme", viewerEmail: "owner@acme.test", body: "Parent", artifactRevision: 2 });
    const reply = feedback.addFeedback({ artifactId: "artifact-a", org: "acme", viewerEmail: "reply@acme.test", body: "Reply", artifactRevision: 2, parentId: parent.id });

    assert.deepEqual(feedback.deleteFeedback(reply.id, { viewerEmail: "other@acme.test", isAdmin: false }), { ok: false, reason: "forbidden" });
    assert.equal(feedback.getFeedback(reply.id).id, reply.id);
    assert.deepEqual(feedback.resolveByViewer(reply.id, { viewerEmail: "other@acme.test", isAdmin: false }), { ok: false, reason: "forbidden" });
    assert.deepEqual(feedback.resolveByViewer(reply.id, { viewerEmail: "reply@acme.test", isAdmin: false }), { ok: true, id: reply.id });
    assert.equal(feedback.getFeedback(reply.id).resolved_by, "reply@acme.test");
    assert.deepEqual(feedback.resolveByViewer(parent.id, { viewerEmail: "admin@acme.test", isAdmin: true }), { ok: true, id: parent.id });
    assert.equal(feedback.getFeedback(parent.id).resolved_by, "admin:admin@acme.test");
    assert.deepEqual(feedback.deleteFeedback(parent.id, { viewerEmail: "admin@acme.test", isAdmin: true }), { ok: true, id: parent.id });
    assert.equal(feedback.getFeedback(parent.id), undefined);
    assert.equal(feedback.getFeedback(reply.id), undefined);
  });
});
