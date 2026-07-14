// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
// Run against a started renderer: npm run smoke
const baseUrl = process.env.PREVIEW_RENDERER_URL || "http://127.0.0.1:3000";
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 10000);

try {
  const response = await fetch(new URL("/render", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: "<!doctype html><style>body{background:#123;color:white}</style><h1>preview smoke</h1>", width: 1200, height: 630 }),
    signal: controller.signal,
    redirect: "error"
  });
  if (!response.ok) throw new Error(`renderer returned HTTP ${response.status}`);
  if (!String(response.headers.get("content-type") || "").startsWith("image/png")) {
    throw new Error("renderer did not return image/png");
  }
  const png = Buffer.from(await response.arrayBuffer());
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("renderer response is not a PNG");
  }
  console.log(`preview renderer smoke test passed (${png.length} bytes)`);
} finally {
  clearTimeout(timer);
}
