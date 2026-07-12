import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "artifact-notify-"));
process.env.DATA_DIR = dir;
const { default: db } = await import("../lib/db.js");
const orgs = await import("../lib/orgs.js");
const webhooks = await import("../lib/webhooks.js");
const notify = await import("../lib/notify.js");

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
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
  assert.equal(JSON.parse(calls[0].init.body).embeds[0].author.name, "notify");

  assert.doesNotThrow(() => notify.emit("published", "notify", { title: "A" }, {
    fetchImpl: async () => { throw new Error("network down"); }
  }));
  await tick();
});
