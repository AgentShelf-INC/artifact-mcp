import test from "node:test";
import assert from "node:assert/strict";
import { artifactAccess, adminAccess } from "../lib/access.js";

test("artifact access expresses tenant and concealment policy consistently", () => {
  const artifact = { id: "abc123", org: "acme" };

  assert.deepEqual(artifactAccess({ email: "admin@example.com", isAdmin: true, org: "admin" }, artifact), { ok: true });
  assert.deepEqual(artifactAccess({ email: "a@acme.test", isAdmin: false, org: "acme" }, artifact), { ok: true });
  assert.deepEqual(artifactAccess({ email: null, isAdmin: false, org: null }, artifact), { ok: false, status: 401, error: "Not signed in" });
  assert.deepEqual(artifactAccess({ email: "b@other.test", isAdmin: false, org: "other" }, artifact), { ok: false, status: 403, error: "Forbidden" });
  assert.deepEqual(artifactAccess({ email: "b@other.test", isAdmin: false, org: "other" }, artifact, { conceal: true }), { ok: false, status: 404, error: "Not found" });
});

test("admin access distinguishes unsigned and non-admin viewers", () => {
  assert.deepEqual(adminAccess({ email: null, isAdmin: false }), { ok: false, status: 403, error: "Not signed in" });
  assert.deepEqual(adminAccess({ email: "member@example.com", isAdmin: false }), { ok: false, status: 403, error: "Admins only" });
  assert.deepEqual(adminAccess({ email: "admin@example.com", isAdmin: true }), { ok: true });
});
