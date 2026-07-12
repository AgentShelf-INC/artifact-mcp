import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-views-"));
process.env.DATA_DIR = dataDir;
const { default: db } = await import("../lib/db.js");
const views = await import("../lib/views.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function artifact(id, org = "acme") {
  db.prepare("INSERT INTO artifacts (id, client_id, org, title) VALUES (?, 'publisher', ?, ?)").run(id, org, id);
}

test("recording a repeat view increments the total without creating another viewer", () => {
  artifact("one");
  views.record("one", "acme", "viewer@example.test");
  db.prepare("UPDATE artifact_views SET last_viewed_at = '2000-01-01 00:00:00' WHERE artifact_id = 'one'").run();
  views.record("one", "acme", "viewer@example.test");

  assert.deepEqual(views.countsFor("one"), { views: 2, unique_viewers: 1, last_viewed_at: views.viewersFor("one")[0].last_viewed_at });
  assert.notEqual(views.viewersFor("one")[0].last_viewed_at, "2000-01-01 00:00:00");
  assert.equal(views.viewersFor("one").length, 1);
  assert.equal(views.viewersFor("one")[0].count, 2);
});

test("counts and named viewers aggregate one artifact in newest-viewer order", () => {
  artifact("two");
  views.record("two", "acme", "first@example.test");
  views.record("two", "acme", "first@example.test");
  views.record("two", "acme", "last@example.test");
  db.prepare("UPDATE artifact_views SET last_viewed_at = '2000-01-01 00:00:00' WHERE artifact_id = 'two' AND email = 'first@example.test'").run();

  assert.deepEqual(views.countsFor("two"), { views: 3, unique_viewers: 2, last_viewed_at: views.viewersFor("two")[0].last_viewed_at });
  assert.deepEqual(views.viewersFor("two").map(({ email, count }) => ({ email, count })), [
    { email: "last@example.test", count: 1 },
    { email: "first@example.test", count: 2 }
  ]);
});

test("artifact deletion cascades its view analytics", () => {
  artifact("three");
  views.record("three", "acme", "viewer@example.test");
  db.prepare("DELETE FROM artifacts WHERE id = 'three'").run();
  assert.deepEqual(views.countsFor("three"), { views: 0, unique_viewers: 0, last_viewed_at: null });
});

test("org counts batch only the requested tenant", () => {
  artifact("four", "acme");
  artifact("five", "other");
  views.record("four", "acme", "a@example.test");
  views.record("four", "acme", "a@example.test");
  views.record("five", "other", "b@example.test");

  assert.deepEqual([...views.countsForOrg("acme")].sort(([a], [b]) => a.localeCompare(b)), [
    ["four", { views: 2, unique_viewers: 1 }],
    ["one", { views: 2, unique_viewers: 1 }],
    ["two", { views: 3, unique_viewers: 2 }]
  ]);
  assert.deepEqual([...views.countsForOrg("other")], [["five", { views: 1, unique_viewers: 1 }]]);
});
