import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const importDataDir = mkdtempSync(path.join(tmpdir(), "artifact-store-import-"));
process.env.DATA_DIR = importDataDir;
const { default: defaultDb, openDatabase } = await import("../lib/db.js");
const { createArtifactStore } = await import("../lib/store.js");

after(() => {
  defaultDb.close();
  rmSync(importDataDir, { recursive: true, force: true });
});

test("single-file publication exposes metadata and body without staging residue", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-store-single-"));
  const runtime = openDatabase({ dataDir });
  const store = createArtifactStore({ db: runtime.db, artifactDir: runtime.artifactDir });

  try {
    const created = store.publish({
      clientId: "publisher",
      org: "acme",
      uploaderLabel: "Agent",
      html: "<!doctype html><h1>Hello</h1>",
      title: "Hello"
    });

    assert.ok(existsSync(path.join(runtime.artifactDir, `${created.id}.html`)));
    assert.equal(store.readArtifact(created.id).html, "<!doctype html><h1>Hello</h1>");
    assert.deepEqual(readdirSync(runtime.artifactDir).filter((name) => name.includes(".staging-")), []);
  } finally {
    runtime.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("bundle publication exposes the selected entry and linked assets atomically", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-store-bundle-"));
  const runtime = openDatabase({ dataDir });
  const store = createArtifactStore({ db: runtime.db, artifactDir: runtime.artifactDir });

  try {
    const created = store.publishBundle({
      clientId: "publisher",
      org: "acme",
      files: {
        "index.html": '<link rel="stylesheet" href="styles/site.css"><h1>Bundle</h1>',
        "styles/site.css": "h1{color:navy}"
      },
      title: "Bundle"
    });

    assert.ok(existsSync(path.join(runtime.artifactDir, created.id, "index.html")));
    assert.equal(store.readBundleFile(created.id, "").content.toString(), '<link rel="stylesheet" href="styles/site.css"><h1>Bundle</h1>');
    assert.equal(store.readBundleFile(created.id, "styles/site.css").contentType, "text/css; charset=utf-8");
    assert.deepEqual(readdirSync(runtime.artifactDir).filter((name) => name.includes(".staging-")), []);
  } finally {
    runtime.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("failed finalization compensates metadata and staged files", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-store-failure-"));
  const runtime = openDatabase({ dataDir });
  const store = createArtifactStore({
    db: runtime.db,
    artifactDir: runtime.artifactDir,
    idFactory: () => "fail123",
    files: { ...fs, renameSync: () => { throw new Error("simulated rename failure"); } }
  });

  try {
    assert.throws(
      () => store.publish({ clientId: "publisher", org: "acme", html: "<h1>Failure</h1>" }),
      /simulated rename failure/
    );
    assert.equal(runtime.db.prepare("SELECT COUNT(*) FROM artifacts WHERE id = 'fail123'").pluck().get(), 0);
    assert.deepEqual(readdirSync(runtime.artifactDir), []);
  } finally {
    runtime.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("artifact deletion removes bodies, metadata, and reactions together", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-store-delete-"));
  const runtime = openDatabase({ dataDir });
  const store = createArtifactStore({ db: runtime.db, artifactDir: runtime.artifactDir });

  try {
    const created = store.publish({ clientId: "publisher", org: "acme", html: "<h1>Delete me</h1>" });
    runtime.db.prepare("INSERT INTO reactions (email, artifact_id, favorite, vote) VALUES (?, ?, 1, 1)")
      .run("viewer@example.com", created.id);

    assert.equal(store.deleteArtifactById(created.id), true);
    assert.equal(existsSync(path.join(runtime.artifactDir, `${created.id}.html`)), false);
    assert.equal(runtime.db.prepare("SELECT COUNT(*) FROM artifacts WHERE id = ?").pluck().get(created.id), 0);
    assert.equal(runtime.db.prepare("SELECT COUNT(*) FROM reactions WHERE artifact_id = ?").pluck().get(created.id), 0);
  } finally {
    runtime.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("failed metadata deletion restores the artifact body", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-store-delete-failure-"));
  const runtime = openDatabase({ dataDir });
  const store = createArtifactStore({ db: runtime.db, artifactDir: runtime.artifactDir });

  try {
    const created = store.publish({ clientId: "publisher", org: "acme", html: "<h1>Keep me</h1>" });
    runtime.db.exec("CREATE TRIGGER block_artifact_delete BEFORE DELETE ON artifacts BEGIN SELECT RAISE(ABORT, 'blocked'); END");

    assert.throws(() => store.deleteArtifactById(created.id), /blocked/);
    assert.ok(existsSync(path.join(runtime.artifactDir, `${created.id}.html`)));
    assert.equal(runtime.db.prepare("SELECT COUNT(*) FROM artifacts WHERE id = ?").pluck().get(created.id), 1);
    assert.deepEqual(readdirSync(runtime.artifactDir).filter((name) => name.includes(".trash-")), []);
  } finally {
    runtime.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("storage audit reports divergence and cleans only transient paths", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-store-audit-"));
  const runtime = openDatabase({ dataDir });
  const store = createArtifactStore({ db: runtime.db, artifactDir: runtime.artifactDir });

  try {
    runtime.db.prepare(`
      INSERT INTO artifacts (id, client_id, org, title, description, bytes, uploader_label, is_bundle, entry)
      VALUES ('missing1', 'publisher', 'acme', 'Missing', '', 0, '', 0, '')
    `).run();
    fs.writeFileSync(path.join(runtime.artifactDir, "orphan1.html"), "<h1>Orphan</h1>");
    fs.writeFileSync(path.join(runtime.artifactDir, ".temp123.staging-dead"), "partial");

    const report = store.auditStorage({ cleanTransient: true });
    assert.deepEqual(report.missingBodies, ["missing1"]);
    assert.deepEqual(report.orphanBodies, ["orphan1.html"]);
    assert.deepEqual(report.transientPaths, [".temp123.staging-dead"]);
    assert.ok(existsSync(path.join(runtime.artifactDir, "orphan1.html")));
    assert.equal(existsSync(path.join(runtime.artifactDir, ".temp123.staging-dead")), false);
  } finally {
    runtime.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("storage audit recovers interrupted staging and trash moves for live metadata", () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "artifact-store-recover-"));
  const runtime = openDatabase({ dataDir });
  const store = createArtifactStore({ db: runtime.db, artifactDir: runtime.artifactDir });

  try {
    const insert = runtime.db.prepare(`
      INSERT INTO artifacts (id, client_id, org, title, description, bytes, uploader_label, is_bundle, entry)
      VALUES (?, 'publisher', 'acme', 'Interrupted', '', 16, '', 0, '')
    `);
    insert.run("stage123");
    insert.run("trash123");
    fs.writeFileSync(path.join(runtime.artifactDir, ".stage123.staging-dead"), "<h1>Staged</h1>");
    fs.writeFileSync(path.join(runtime.artifactDir, ".trash123.trash-dead"), "<h1>Trashed</h1>");

    const report = store.auditStorage({ cleanTransient: true });

    assert.equal(store.readArtifact("stage123").html, "<h1>Staged</h1>");
    assert.equal(store.readArtifact("trash123").html, "<h1>Trashed</h1>");
    assert.deepEqual(report.missingBodies, []);
    assert.deepEqual(report.recoveredPaths.sort(), [".stage123.staging-dead", ".trash123.trash-dead"]);
    assert.deepEqual(readdirSync(runtime.artifactDir).filter((name) => name.startsWith(".")), []);
  } finally {
    runtime.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
