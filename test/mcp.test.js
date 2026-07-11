import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "artifact-mcp-rpc-"));
process.env.DATA_DIR = dataDir;
const { handleMcp } = await import("../lib/mcp.js");

test.after(() => rmSync(dataDir, { recursive: true, force: true }));

const auth = { clientId: "publisher", org: "acme", label: "Agent" };

async function call(name, args, id = 1) {
  return handleMcp({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args }
  }, auth);
}

test("MCP enforces the published tool input schemas", async () => {
  const missing = await call("publish_artifact", { surprise: true });
  assert.equal(missing.error.code, -32602);
  assert.match(missing.error.message, /html is required/);
  assert.match(missing.error.message, /surprise is not allowed/);

  const nested = await call("publish_bundle", { files: { "index.html": 42 } }, 2);
  assert.equal(nested.error.code, -32602);
  assert.match(nested.error.message, /files\.index\.html must be a string/);
});
