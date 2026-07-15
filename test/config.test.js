import test from "node:test";
import assert from "node:assert/strict";
import { mcpJsonLimitFor } from "../lib/config.js";

test("the largest valid worst-case bundle fits the MCP request limit", () => {
  const maxBundleBytes = 8 * 1024 * 1024;
  const largestValidBundle = "\u0000".repeat(maxBundleBytes);
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "publish_bundle",
      arguments: {
        files: { "index.html": largestValidBundle },
        entry: "index.html",
        title: "Largest valid bundle"
      }
    }
  };
  const limit = mcpJsonLimitFor(maxBundleBytes);

  assert.equal(Buffer.byteLength(largestValidBundle), maxBundleBytes);
  assert.ok(Buffer.byteLength(JSON.stringify(request)) <= limit);
});
