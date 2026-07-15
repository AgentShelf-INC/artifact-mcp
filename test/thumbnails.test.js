import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createThumbnailQueue, createThumbnailStore, PNG_SIGNATURE } from "../lib/thumbnails.js";
import { createArtifactPreviewNotifier } from "../lib/preview.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const png = (value = "ok") => Buffer.concat([PNG_SIGNATURE, Buffer.from(value)]);
const meta = (digest = DIGEST_A) => ({ id: "art123", body_sha256: digest, is_bundle: 0, org: "acme" });

function tempData(name) {
  return mkdtempSync(path.join(tmpdir(), `artifact-thumbnails-${name}-`));
}

test("thumbnail generation coalesces, persists atomically, and is reused after restart", async () => {
  const dataDir = tempData("reuse");
  let calls = 0;
  let release;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const renderer = {
    enabled: true,
    async renderRevisionPreview() {
      calls += 1;
      markStarted();
      await new Promise((resolve) => { release = resolve; });
      return png("first");
    }
  };
  try {
    const firstStore = createThumbnailStore({ dataDir, renderer });
    const first = firstStore.ensureThumbnail(meta(), "<h1>one</h1>");
    const duplicate = firstStore.ensureThumbnail(meta(), "<h1>one</h1>");
    await started;
    assert.equal(calls, 1);
    release();
    assert.deepEqual(await first, png("first"));
    assert.deepEqual(await duplicate, png("first"));
    const files = readdirSync(path.join(dataDir, "previews", "art123"));
    assert.deepEqual(files, [`${DIGEST_A}.png`]);

    const restarted = createThumbnailStore({
      dataDir,
      renderer: { enabled: true, renderRevisionPreview: async () => { throw new Error("must not render"); } }
    });
    assert.deepEqual(await restarted.ensureThumbnail(meta(), "ignored"), png("first"));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("failures are retryable and invalid or oversized renderer output is rejected", async () => {
  const dataDir = tempData("validation");
  const outputs = [null, Buffer.from("not png"), Buffer.concat([PNG_SIGNATURE, Buffer.alloc(20)]), png("retry")];
  const store = createThumbnailStore({
    dataDir,
    maxPngBytes: 16,
    renderer: { enabled: true, renderRevisionPreview: async () => outputs.shift() }
  });
  try {
    assert.equal(await store.ensureThumbnail(meta(), "html"), null);
    assert.equal(await store.ensureThumbnail(meta(), "html"), null);
    assert.equal(await store.ensureThumbnail(meta(), "html"), null);
    assert.deepEqual(await store.ensureThumbnail(meta(), "html"), png("retry"));
    assert.ok(existsSync(path.join(dataDir, "previews", "art123", `${DIGEST_A}.png`)));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("new digests invalidate obsolete files; delete and startup audit are best effort", async () => {
  const dataDir = tempData("cleanup");
  const store = createThumbnailStore({
    dataDir,
    renderer: { enabled: true, renderRevisionPreview: async (_id, digest) => png(digest[0]) }
  });
  try {
    await store.ensureThumbnail(meta(DIGEST_A), "one");
    await store.ensureThumbnail(meta(DIGEST_B), "two");
    assert.deepEqual(readdirSync(path.join(dataDir, "previews", "art123")), [`${DIGEST_B}.png`]);
    assert.equal(await store.readThumbnail(meta(DIGEST_B), DIGEST_A), null, "old digest is never served");

    const orphan = path.join(dataDir, "previews", "orphan1");
    mkdirSync(orphan, { recursive: true });
    writeFileSync(path.join(orphan, ".partial.tmp"), Buffer.from("partial"));
    writeFileSync(path.join(dataDir, "previews", "art123", ".partial.tmp"), Buffer.from("partial"));
    const report = await store.audit({ getArtifactMeta: (id) => id === "art123" ? meta(DIGEST_B) : null });
    assert.deepEqual(report.orphanDirs, ["orphan1"]);
    assert.ok(report.partialFiles.includes("art123/.partial.tmp"));
    assert.equal(existsSync(orphan), false);

    await store.removeArtifact("art123");
    assert.equal(existsSync(path.join(dataDir, "previews", "art123")), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("renderer-off mode returns placeholders and the serial queue prioritizes new events", async () => {
  const dataDir = tempData("queue");
  const off = createThumbnailStore({ dataDir, renderer: { enabled: false } });
  try {
    assert.equal(await off.ensureThumbnail(meta(), "html"), null);
    assert.match(off.placeholder(meta()).toString(), /Preview temporarily unavailable/);
    assert.match(off.placeholder({ ...meta(), is_bundle: 1 }).toString(), /Bundle preview/);

    const order = [];
    let release;
    const thumbnails = {
      async ensureThumbnail(item) {
        order.push(item.id);
        if (item.id === "back01") await new Promise((resolve) => { release = resolve; });
        return png(item.id);
      }
    };
    const queue = createThumbnailQueue({ thumbnails });
    const first = queue.enqueue({ ...meta(), id: "back01" }, "", { priority: "low" });
    queue.enqueue({ ...meta(), id: "back02" }, "", { priority: "low" });
    await new Promise((resolve) => setImmediate(resolve));
    const high = queue.enqueue({ ...meta(), id: "event1" }, "", { priority: "high" });
    release();
    await Promise.all([first, high]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["back01", "event1", "back02"]);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("one queued render is persisted and the identical buffer is reused for Discord", async () => {
  const dataDir = tempData("discord");
  let calls = 0;
  const rendered = png("shared");
  const thumbnails = createThumbnailStore({
    dataDir,
    renderer: { enabled: true, renderRevisionPreview: async () => { calls += 1; return rendered; } }
  });
  const queue = createThumbnailQueue({ thumbnails });
  const delivered = [];
  let markDelivered;
  const delivery = new Promise((resolve) => { markDelivered = resolve; });
  const artifactMeta = meta();
  const notifier = createArtifactPreviewNotifier({
    artifacts: { readArtifact: () => ({ meta: artifactMeta, html: "<h1>shared</h1>" }) },
    thumbnailQueue: queue,
    notify: { emit: (...args) => { delivered.push(args); markDelivered(); } }
  });
  try {
    notifier.emit("published", "acme", { title: "Shared" }, { artifactMeta });
    await delivery;
    assert.equal(calls, 1);
    assert.deepEqual(delivered[0][3].preview, rendered);
    assert.deepEqual(await thumbnails.readThumbnail(artifactMeta, DIGEST_A), rendered);
    assert.equal(calls, 1, "gallery disk read does not start another render");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
