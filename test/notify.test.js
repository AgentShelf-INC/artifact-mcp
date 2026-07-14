import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const dir = mkdtempSync(path.join(tmpdir(), "artifact-notify-"));
process.env.DATA_DIR = dir;
process.env.WEBHOOK_ENC_KEY = randomBytes(32).toString("base64");
const { default: db } = await import("../lib/db.js");
const orgs = await import("../lib/orgs.js");
const webhooks = await import("../lib/webhooks.js");
const notify = await import("../lib/notify.js");

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.WEBHOOK_ENC_KEY;
});

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

test("buildEmbed creates an org-branded, linked Discord embed", () => {
  const body = notify.buildEmbed("published", {
    org: "acme",
    title: "Release notes",
    url: "https://artifact.test/a1",
    uploaderLabel: "Deploy bot",
    category: "Releases",
    revision: 3,
    bytes: 2048
  });
  assert.equal(body.embeds.length, 1);
  assert.equal(body.embeds[0].author.name, "acme");
  assert.equal(body.embeds[0].title, "Release notes");
  assert.equal(body.embeds[0].url, "https://artifact.test/a1");
  assert.ok(body.embeds[0].fields.some((field) => field.name === "Revision"));
});

test("emit only posts to matching webhook events and never throws on delivery failure", async () => {
  orgs.createOrg({ name: "notify" });
  webhooks.create({ org: "notify", url: "https://discord.com/api/webhooks/1/published", events: ["published"] });
  webhooks.create({ org: "notify", url: "https://discord.com/api/webhooks/2/feedback", events: ["feedback"] });
  const calls = [];
  notify.emit("published", "notify", { title: "A", url: "https://artifact.test/a", revision: 1 }, {
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true }; }
  });
  await tick();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/1\/published$/);
  assert.deepEqual(calls[0].init.headers, { "content-type": "application/json" });
  assert.equal(calls[0].init.body, "{\"embeds\":[{\"color\":3120756,\"author\":{\"name\":\"notify\"},\"title\":\"A\",\"url\":\"https://artifact.test/a\",\"fields\":[{\"name\":\"Publisher\",\"value\":\"Unknown\",\"inline\":true},{\"name\":\"Category\",\"value\":\"Uncategorized\",\"inline\":true},{\"name\":\"Revision\",\"value\":\"1\",\"inline\":true},{\"name\":\"Size\",\"value\":\"—\",\"inline\":true}],\"description\":\"Published artifact\"}]}");
  assert.equal(JSON.parse(calls[0].init.body).embeds[0].author.name, "notify");

  assert.doesNotThrow(() => notify.emit("published", "notify", { title: "A" }, {
    fetchImpl: async () => { throw new Error("network down"); }
  }));
  await tick();
});

test("emit uses Discord multipart attachments when a preview buffer is present", async () => {
  orgs.createOrg({ name: "multipart" });
  webhooks.create({ org: "multipart", url: "https://discord.com/api/webhooks/3/multipart", events: ["updated"] });
  const calls = [];
  const preview = Buffer.from("png-binary");

  notify.emit("updated", "multipart", { title: "Previewed", revision: 2 }, {
    preview,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true }; }
  });
  await tick();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers, undefined);
  assert.ok(calls[0].init.body instanceof FormData);
  const payload = JSON.parse(calls[0].init.body.get("payload_json"));
  assert.equal(payload.embeds[0].image.url, "attachment://preview.png");
  const file = calls[0].init.body.get("files[0]");
  assert.equal(file.name, "preview.png");
  assert.equal(file.type, "image/png");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), preview);
});

test("null preview keeps the unchanged JSON delivery path", async () => {
  orgs.createOrg({ name: "preview-fallback" });
  webhooks.create({ org: "preview-fallback", url: "https://discord.com/api/webhooks/4/fallback", events: ["restored"] });
  const calls = [];

  notify.emit("restored", "preview-fallback", { title: "Fallback", revision: 4 }, {
    preview: null,
    fetchImpl: async (_url, init) => { calls.push(init); return { ok: true }; }
  });
  await tick();

  assert.deepEqual(calls[0].headers, { "content-type": "application/json" });
  assert.equal(JSON.parse(calls[0].body).embeds[0].image, undefined);
});

test("encrypted webhook delivery targets the decrypted Discord endpoint", async () => {
  orgs.createOrg({ name: "encrypted-delivery" });
  const secretUrl = "https://discord.com/api/webhooks/99/encrypted-delivery-token";
  const created = webhooks.create({ org: "encrypted-delivery", url: secretUrl, events: ["published"] });
  const stored = db.prepare("SELECT * FROM org_webhooks WHERE id = ?").get(created.id);
  const calls = [];

  notify.emit("published", "encrypted-delivery", { title: "Encrypted" }, {
    fetchImpl: async (url) => { calls.push(url); return { ok: true }; }
  });
  await tick();

  assert.doesNotMatch(JSON.stringify(stored), /encrypted-delivery-token/);
  assert.deepEqual(calls, [secretUrl]);
});
