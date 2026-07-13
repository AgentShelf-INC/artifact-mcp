import test from "node:test";
import assert from "node:assert/strict";
import { orgColor } from "../lib/portal.js";

test("orgColor derives a stable, distinct color from any org name", () => {
  // Deterministic: same name -> same color (so an org keeps its color across renders).
  assert.equal(orgColor("acme"), orgColor("acme"));
  assert.equal(orgColor("homelab"), orgColor("homelab"));
  // Distinct: different names get different hues (no hardcoded tenant list needed).
  assert.notEqual(orgColor("acme"), orgColor("globex"));
  assert.notEqual(orgColor("acme"), orgColor("admin"));
  // Valid CSS color.
  assert.match(orgColor("acme"), /^hsl\(/);
});
