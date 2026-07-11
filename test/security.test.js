import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Docker build context excludes deployment secrets and persistent data", () => {
  const patterns = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  for (const required of [".env", ".env.*", "!.env.example", "data/", ".git/", ".local/", "node_modules/"]) {
    assert.ok(patterns.includes(required), `.dockerignore must exclude ${required}`);
  }
});
