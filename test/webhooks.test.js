import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const dir = mkdtempSync(path.join(tmpdir(), "artifact-webhooks-"));
process.env.DATA_DIR = dir;
process.env.WEBHOOK_ENC_KEY = randomBytes(32).toString("base64");
const { default: db } = await import("../lib/db.js");
const orgs = await import("../lib/orgs.js");
const webhooks = await import("../lib/webhooks.js");

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.WEBHOOK_ENC_KEY;
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
  const stored = db.prepare("SELECT * FROM org_webhooks WHERE id = ?").get(created.id);
  assert.doesNotMatch(JSON.stringify(stored), /very-secret-token/);
  assert.ok(stored.url_cipher);
  assert.ok(stored.url_nonce);
  assert.ok(stored.url_tag);
  assert.doesNotMatch(webhooks.listForOrg("acme")[0].url, /very-secret/);
  assert.equal(webhooks.forEvent("acme", "published")[0].url.endsWith("very-secret-token"), true);

  const changed = webhooks.setEvents("acme", created.id, ["resolved"]);
  assert.deepEqual(changed.events, ["resolved"]);
  assert.doesNotMatch(changed.url, /very-secret/);
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

test("webhooks preserve the documented plaintext fallback when no encryption key is configured", () => {
  const key = process.env.WEBHOOK_ENC_KEY;
  delete process.env.WEBHOOK_ENC_KEY;
  try {
    orgs.createOrg({ name: "zero-config" });
    const secretUrl = "https://discord.com/api/webhooks/42/plaintext-fallback-token";
    const created = webhooks.create({ org: "zero-config", url: secretUrl });
    const stored = db.prepare("SELECT * FROM org_webhooks WHERE id = ?").get(created.id);

    assert.equal(stored.url, secretUrl);
    assert.equal(stored.url_cipher, null);
    assert.equal(webhooks.get(created.id).url, secretUrl);
    assert.doesNotMatch(created.url, /plaintext-fallback-token/);
  } finally {
    process.env.WEBHOOK_ENC_KEY = key;
  }
});

test("mixed encrypted and plaintext webhook rows remain deliverable and publicly masked", () => {
  orgs.createOrg({ name: "mixed-rollout" });
  const encryptedUrl = "https://discord.com/api/webhooks/51/encrypted-rollout-token";
  const plaintextUrl = "https://discord.com/api/webhooks/52/plaintext-rollout-token";
  webhooks.create({ org: "mixed-rollout", url: encryptedUrl, events: ["feedback"] });
  db.prepare(`
    INSERT INTO org_webhooks (id, org, url, events) VALUES (?, ?, ?, ?)
  `).run("plaintext-rollout", "mixed-rollout", plaintextUrl, "feedback");

  const publicRows = webhooks.listForOrg("mixed-rollout");
  assert.equal(publicRows.length, 2);
  assert.ok(publicRows.every((row) => !row.url.includes("rollout-token")));
  assert.deepEqual(
    webhooks.forEvent("mixed-rollout", "feedback").map((row) => row.url).sort(),
    [encryptedUrl, plaintextUrl].sort()
  );
});
