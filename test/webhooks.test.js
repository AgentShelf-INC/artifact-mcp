import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "artifact-webhooks-"));
process.env.DATA_DIR = dir;
const { default: db } = await import("../lib/db.js");
const orgs = await import("../lib/orgs.js");
const webhooks = await import("../lib/webhooks.js");

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("webhooks are masked, validate their Discord URL and event set, and can be updated or removed", () => {
  orgs.createOrg({ name: "acme" });
  const created = webhooks.create({
    org: "acme",
    url: "https://discord.com/api/webhooks/123456/very-secret-token",
    label: "Builds",
    events: ["published", "feedback"]
  });
  assert.equal(created.label, "Builds");
  assert.deepEqual(created.events, ["published", "feedback"]);
  assert.match(created.url, /^https:\/\/discord\.com…oken$/);
  assert.doesNotMatch(created.url, /very-secret/);
  assert.equal(webhooks.forEvent("acme", "published")[0].url.endsWith("very-secret-token"), true);

  const changed = webhooks.setEvents("acme", created.id, ["resolved"]);
  assert.deepEqual(changed.events, ["resolved"]);
  assert.equal(webhooks.forEvent("acme", "published").length, 0);
  assert.equal(webhooks.forEvent("acme", "resolved").length, 1);
  assert.equal(webhooks.remove("acme", created.id), true);
  assert.deepEqual(webhooks.listForOrg("acme"), []);

  assert.throws(
    () => webhooks.create({ org: "acme", url: "https://example.test/webhook" }),
    /Discord webhook URL/
  );
  assert.throws(
    () => webhooks.create({ org: "acme", url: "https://discordapp.com/api/webhooks/1/x", events: ["nope"] }),
    /Unknown webhook event/
  );
});

test("webhooks default to every event and cascade with their organization", () => {
  orgs.createOrg({ name: "cascade" });
  const row = webhooks.create({ org: "cascade", url: "https://discordapp.com/api/webhooks/1/token" });
  assert.deepEqual(row.events, webhooks.EVENTS);
  orgs.deleteOrg("cascade");
  assert.equal(webhooks.get(row.id), undefined);
});
