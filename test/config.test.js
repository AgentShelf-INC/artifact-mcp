import test from "node:test";
import assert from "node:assert/strict";
import { mcpJsonLimitFor } from "../lib/config.js";

test("the MCP request limit includes bundle encoding and protocol overhead", () => {
  const maxBundleBytes = 8 * 1024 * 1024;
  const limit = mcpJsonLimitFor(maxBundleBytes);
  assert.ok(limit >= maxBundleBytes * 2 + 256 * 1024);
});
