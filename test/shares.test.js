import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-shares-"));
process.env.DATA_DIR = dataDir;
const { default: db } = await import("../lib/db.js");
const shares = await import("../lib/shares.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function artifact(id) {
  db.prepare("INSERT INTO artifacts (id, client_id, org, title) VALUES (?, 'publisher', 'acme', ?)").run(id, id);
}

test("shares resolve only while active, list active links, and cascade with their artifact", () => {
  artifact("share01");
  const day = shares.create({ artifactId: "share01", org: "acme", createdBy: "owner@acme.test", expires: "24h" });
  const never = shares.create({ artifactId: "share01", org: "acme", createdBy: "owner@acme.test", expires: "never" });
  const dated = shares.create({ artifactId: "share01", org: "acme", createdBy: "owner@acme.test", expires: "2099-01-01T00:00:00.000Z" });

  assert.match(day.token, /^[A-Za-z0-9_-]{22,}$/);
  assert.equal(never.expires_at, null);
  assert.equal(new Date(day.expires_at).getTime() > Date.now(), true);
  assert.equal(new Date(dated.expires_at).toISOString(), "2099-01-01T00:00:00.000Z");
  assert.deepEqual(shares.resolve(day.token), { artifact_id: "share01", org: "acme" });
  assert.deepEqual(shares.listForArtifact("share01").map((row) => row.token).sort(), [day.token, never.token, dated.token].sort());

  db.prepare("UPDATE artifact_shares SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second') WHERE token = ?").run(day.token);
  assert.equal(shares.resolve("unknown"), null);
  assert.equal(shares.resolve(day.token), null);
  assert.equal(shares.revoke("share01", never.token), true);
  assert.equal(shares.resolve(never.token), null);
  assert.deepEqual(shares.listForArtifact("share01").map((row) => row.token), [dated.token]);
  assert.equal(shares.revoke("share01", never.token), false);
  assert.throws(() => shares.create({ artifactId: "share01", org: "acme", createdBy: "owner@acme.test", expires: "2000-01-01T00:00:00Z" }), /future/);
  assert.throws(() => shares.create({ artifactId: "share01", org: "acme", createdBy: "owner@acme.test", expires: "not-a-date" }), /ISO/);
  // An impossible calendar date must be rejected, not silently rolled over to a later expiry.
  assert.throws(() => shares.create({ artifactId: "share01", org: "acme", createdBy: "owner@acme.test", expires: "2099-02-31" }), /calendar date/);

  db.prepare("DELETE FROM artifacts WHERE id = 'share01'").run();
  assert.equal(db.prepare("SELECT COUNT(*) FROM artifact_shares").pluck().get(), 0);
});
