import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// orgs.js binds to the default db (like keys.js), so point DATA_DIR at a temp dir first.
const dir = mkdtempSync(path.join(tmpdir(), "artifact-orgs-"));
process.env.DATA_DIR = dir;
const { default: db } = await import("../lib/db.js");
const orgs = await import("../lib/orgs.js");

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("creating an org with a domain makes it resolvable and listed", () => {
  const created = orgs.createOrg({ name: "acme", label: "Acme Inc", domain: "Acme.TEST" });
  assert.equal(created.name, "acme");
  assert.deepEqual(created.domains, ["acme.test"]); // normalized to lowercase
  assert.equal(orgs.orgForDomain("acme.test"), "acme");
  assert.equal(orgs.orgExists("acme"), true);
  assert.ok(orgs.listOrgNames().includes("acme"));
  const row = orgs.listOrgs().find((o) => o.name === "acme");
  assert.equal(row.label, "Acme Inc");
  assert.deepEqual(row.categories, []);
});

test("duplicate orgs, bad domains, reserved names, and taken domains are rejected", () => {
  orgs.createOrg({ name: "beta", domain: "beta.test" });
  assert.throws(() => orgs.createOrg({ name: "beta" }), /already exists/);
  assert.throws(() => orgs.createOrg({ name: "admin" }), /reserved/);
  assert.throws(() => orgs.createOrg({ name: "gamma", domain: "not a domain" }), /valid email domain/);
  // A domain can belong to only one org.
  assert.throws(() => orgs.createOrg({ name: "gamma", domain: "beta.test" }), /already mapped to "beta"/);
});

test("domains and categories can be added and removed independently", () => {
  orgs.createOrg({ name: "delta" });
  orgs.addDomain("delta", "delta.test");
  orgs.addDomain("delta", "delta.io");
  assert.throws(() => orgs.addDomain("delta", "delta.test"), /already on this org/);
  assert.equal(orgs.orgForDomain("delta.io"), "delta");

  orgs.addCategory("delta", "Dashboards");
  orgs.addCategory("delta", "Reports");
  orgs.addCategory("delta", "Dashboards"); // INSERT OR IGNORE — no duplicate
  assert.deepEqual(orgs.categoriesFor("delta"), ["Dashboards", "Reports"]);

  assert.equal(orgs.removeDomain("delta", "delta.io"), true);
  assert.equal(orgs.orgForDomain("delta.io"), null);
  assert.equal(orgs.removeCategory("delta", "Reports"), true);
  assert.deepEqual(orgs.categoriesFor("delta"), ["Dashboards"]);
});

test("deleting an org cascades its domains and categories", () => {
  orgs.createOrg({ name: "epsilon", domain: "epsilon.test" });
  orgs.addCategory("epsilon", "Specs");
  assert.equal(orgs.deleteOrg("epsilon"), true);
  assert.equal(orgs.orgExists("epsilon"), false);
  assert.equal(orgs.orgForDomain("epsilon.test"), null);
  assert.deepEqual(orgs.categoriesFor("epsilon"), []);
});

test("adding a domain or category to an unknown org is rejected", () => {
  assert.throws(() => orgs.addDomain("ghost", "ghost.test"), /Unknown organization/);
  assert.throws(() => orgs.addCategory("ghost", "X"), /Unknown organization/);
});
