// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const importDataDir = mkdtempSync(path.join(tmpdir(), "artifact-notifications-import-"));
process.env.DATA_DIR = importDataDir;
const { default: defaultDb, openDatabase } = await import("../lib/db.js");
const { createNotificationStore } = await import("../lib/notifications.js");

after(() => {
  defaultDb.close();
  rmSync(importDataDir, { recursive: true, force: true });
});

function withNotifications(fn) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-notifications-"));
  const runtime = openDatabase({ dataDir });
  const notifications = createNotificationStore({ db: runtime.db });
  const artifact = runtime.db.prepare("INSERT INTO artifacts (id, client_id, org, title) VALUES (?, 'publisher', ?, ?)");
  artifact.run("artifact-a", "acme", "Acme report");
  artifact.run("artifact-b", "beta", "Beta report");
  const feedback = runtime.db.prepare(`
    INSERT INTO feedback (id, artifact_id, org, viewer_email, body, artifact_revision, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  feedback.run("feedback-a", "artifact-a", "acme", "author@acme.test", "Acme note", "2026-07-14 10:00:00");
  feedback.run("feedback-b", "artifact-b", "beta", "author@beta.test", "Beta note", "2026-07-14 11:00:00");
  try {
    fn({ db: runtime.db, notifications });
  } finally {
    runtime.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test("notification listings enforce member tenancy while admins see every organization", () => {
  withNotifications(({ notifications }) => {
    const member = notifications.recentForViewer({ email: "viewer@acme.test", org: "acme", isAdmin: false });
    assert.deepEqual(member.map((row) => row.id), ["feedback-a"]);
    assert.deepEqual(member.map((row) => row.org), ["acme"]);

    const admin = notifications.recentForViewer({ email: "admin@example.test", org: "admin", isAdmin: true });
    assert.deepEqual(admin.map((row) => row.id), ["feedback-b", "feedback-a"]);
  });
});

test("notification listings exclude feedback left by the viewer", () => {
  withNotifications(({ db, notifications }) => {
    db.prepare(`
      INSERT INTO feedback (id, artifact_id, org, viewer_email, body, artifact_revision, created_at)
      VALUES ('feedback-self', 'artifact-a', 'acme', 'viewer@acme.test', 'My own note', 1, datetime('now'))
    `).run();
    const rows = notifications.recentForViewer({ email: "viewer@acme.test", org: "acme", isAdmin: false });
    assert.equal(rows.some((row) => row.id === "feedback-self"), false);
  });
});

test("advancing a viewer watermark clears their unread feedback count", () => {
  withNotifications(({ db, notifications }) => {
    db.prepare("UPDATE feedback SET created_at = datetime('now', '-1 second') WHERE id = 'feedback-a'").run();
    const viewer = { email: "viewer@acme.test", org: "acme", isAdmin: false };
    assert.equal(notifications.unreadCount(viewer), 1);
    notifications.markSeen(viewer.email);
    assert.equal(notifications.unreadCount(viewer), 0);
    assert.equal(notifications.recentForViewer(viewer).find((row) => row.id === "feedback-a").unread, 0);
  });
});
