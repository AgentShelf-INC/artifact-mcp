import test from "node:test";
import assert from "node:assert/strict";
import { createArtifactPreviewNotifier, createPreviewRenderer, renderPreview } from "../lib/preview.js";

test("renderPreview is a no-op when PREVIEW_RENDERER_URL is unset", async () => {
  const before = process.env.PREVIEW_RENDERER_URL;
  delete process.env.PREVIEW_RENDERER_URL;
  try {
    assert.equal(await renderPreview("<h1>off</h1>"), null);
  } finally {
    if (before === undefined) delete process.env.PREVIEW_RENDERER_URL;
    else process.env.PREVIEW_RENDERER_URL = before;
  }
});

test("preview renderer posts HTML and returns PNG bytes", async () => {
  const calls = [];
  const renderer = createPreviewRenderer({
    rendererUrl: "http://artifact-preview:3000",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(Buffer.from("png-data"), { status: 200, headers: { "content-type": "image/png" } });
    }
  });

  const png = await renderer.renderPreview("<h1>Preview</h1>");
  assert.deepEqual(png, Buffer.from("png-data"));
  assert.equal(calls[0].url, "http://artifact-preview:3000/render");
  assert.deepEqual(JSON.parse(calls[0].init.body), { html: "<h1>Preview</h1>", width: 1200, height: 630 });
  assert.deepEqual(calls[0].init.headers, { "content-type": "application/json" });
  assert.equal(calls[0].init.redirect, "error");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("preview renderer errors and timeouts return null without throwing", async () => {
  const erroring = createPreviewRenderer({
    rendererUrl: "http://artifact-preview:3000",
    fetchImpl: async () => { throw new Error("renderer down"); }
  });
  assert.equal(await erroring.renderPreview("<p>fallback</p>"), null);

  const timingOut = createPreviewRenderer({
    rendererUrl: "http://artifact-preview:3000",
    timeoutMs: 5,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    })
  });
  assert.equal(await timingOut.renderPreview("<p>slow</p>"), null);
});

test("per-revision preview cache coalesces in-flight and repeated renders", async () => {
  let calls = 0;
  let release;
  const renderer = createPreviewRenderer({
    rendererUrl: "http://artifact-preview:3000",
    fetchImpl: async () => {
      calls += 1;
      await new Promise((resolve) => { release = resolve; });
      return new Response(Buffer.from(`png-${calls}`), { headers: { "content-type": "image/png" } });
    }
  });

  const first = renderer.renderRevisionPreview("artifact-1", 3, "<h1>one</h1>");
  const duplicate = renderer.renderRevisionPreview("artifact-1", 3, "<h1>one</h1>");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, Buffer.from("png-1"));
  assert.deepEqual(await duplicate, Buffer.from("png-1"));
  assert.deepEqual(await renderer.renderRevisionPreview("artifact-1", 3, "ignored after cache"), Buffer.from("png-1"));
  assert.equal(calls, 1);

  const nextRevision = renderer.renderRevisionPreview("artifact-1", 4, "<h1>two</h1>");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  release();
  assert.deepEqual(await nextRevision, Buffer.from("png-2"));
});

test("artifact preview notifier skips bundles and detaches single-file rendering", async () => {
  const delivered = [];
  let tested = false;
  let renderCalls = 0;
  let release;
  const renderer = {
    enabled: true,
    async renderRevisionPreview() {
      renderCalls += 1;
      await new Promise((resolve) => { release = resolve; });
      return Buffer.from("preview");
    }
  };
  const notifier = createArtifactPreviewNotifier({
    artifacts: { readArtifact: () => ({ html: "<h1>single</h1>" }) },
    renderer,
    notify: {
      emit: (...args) => delivered.push(args),
      test: async () => { tested = true; return { ok: true }; }
    }
  });

  assert.deepEqual(await notifier.test({ url: "https://discord.test" }), { ok: true });
  assert.equal(tested, true);

  notifier.emit("published", "acme", { title: "Bundle" }, {
    artifactMeta: { id: "bundle-1", revision: 1, is_bundle: 1 }
  });
  assert.equal(renderCalls, 0);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0][3]?.preview, undefined);

  notifier.emit("feedback", "acme", { title: "Single", body: "No preview for feedback" }, {
    artifactMeta: { id: "single-1", revision: 2, is_bundle: 0 }
  });
  assert.equal(renderCalls, 0);
  assert.equal(delivered.length, 2);
  assert.equal(delivered[1][3]?.preview, undefined);

  notifier.emit("updated", "acme", { title: "Single" }, {
    artifactMeta: { id: "single-1", revision: 2, is_bundle: 0 }
  });
  assert.equal(renderCalls, 1);
  assert.equal(delivered.length, 2, "notification waits for preview without blocking emit");
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delivered.length, 3);
  assert.deepEqual(delivered[2][3].preview, Buffer.from("preview"));
});

test("artifact preview notifier falls back to text when rendering fails", async () => {
  const delivered = [];
  const notifier = createArtifactPreviewNotifier({
    artifacts: { readArtifact: () => ({ html: "<h1>single</h1>" }) },
    renderer: { enabled: true, renderRevisionPreview: async () => null },
    notify: { emit: (...args) => delivered.push(args) }
  });

  notifier.emit("restored", "acme", { title: "Single" }, {
    artifactMeta: { id: "single-1", revision: 4, is_bundle: 0 }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0][3].preview, null);
});
