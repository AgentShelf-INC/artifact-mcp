import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../lib/app.js";
import { createArtifactPreviewNotifier } from "../lib/preview.js";

const identityDataDir = mkdtempSync(join(tmpdir(), "artifact-mcp-identity-"));
process.env.DATA_DIR = identityDataDir;
test.after(() => rmSync(identityDataDir, { recursive: true, force: true }));

let identityImportId = 0;
async function withIdentityEnv(values, fn) {
  const names = [
    "CF_ACCESS_TEAM_DOMAIN",
    "CF_ACCESS_AUD",
    "TRUST_ACCESS_HEADERS",
    "REQUIRE_ACCESS_JWT",
    "LISTEN_HOST",
    "HEADER_TRUST_ALLOW_INSECURE",
    "ADMIN_EMAILS",
    "ADMIN_EMAIL_DOMAINS",
    "ORG_EMAIL_DOMAINS"
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, values);
  try {
    const url = new URL(`../lib/identity.js?test=${++identityImportId}`, import.meta.url);
    return await fn(await import(url.href));
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function dependencies(overrides = {}) {
  const artifact = { id: "abc123", org: "acme", title: "Artifact", client_id: "publisher", is_bundle: 0 };
  return {
    checkPublisherKey: () => ({ ok: false }),
    handleMcp: async () => null,
    resolveViewer: async () => ({ email: "viewer@other.test", org: "other", isAdmin: false }),
    artifacts: {
      getArtifactMeta: () => artifact,
      readArtifact: () => ({ meta: artifact, html: "<h1>Artifact</h1>" }),
      readBundleFile: () => null,
      listOrgArtifacts: () => [],
      listAllGroupedByOrg: () => new Map(),
      listOrgIds: () => [artifact.id],
      deleteArtifactById: () => true,
      listRevisions: () => ({ current: 1, revisions: [] }),
      restoreArtifactRevision: () => ({ ok: true, id: artifact.id, revision: 2, restoredFrom: 1 }),
      readHistoryArtifact: () => null,
      readHistoryBundleFile: () => null
    },
    keys: { list: () => [], create: () => ({}), revoke: () => false },
    orgs: {
      list: () => [],
      names: () => [],
      has: () => true,
      create: () => ({}),
      remove: () => true,
      addDomain: () => ({}),
      removeDomain: () => true,
      addCategory: () => ({}),
      removeCategory: () => true,
      setColor: () => ({}),
      colorMap: () => ({})
    },
    reactions: {
      get: () => ({ favorite: 0, vote: 0 }),
      set: () => ({ favorite: 0, vote: 0 }),
      forViewer: () => new Map(),
      sentiment: () => new Map()
    },
    feedback: { listForArtifact: () => [] },
    pages: {
      gallery: () => "gallery",
      shell: () => "shell",
      notFound: () => "not found",
      notSignedIn: () => "not signed in",
      settings: () => "settings"
    },
    logger: { info() {}, error() {} },
    ...overrides
  };
}

async function serve(app, fn) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

// Exercise a createApp route without opening a socket. Route middleware is unnecessary for
// these cases because the request body is already decoded by the test harness.
async function invokeRoute(app, method, path, { headers = {}, params = {}, query = {}, body } = {}) {
  const route = app._router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]);
  assert.ok(route, `${method.toUpperCase()} ${path} route exists`);
  const handler = route.route.stack.at(-1).handle;
  const result = { status: 200, headers: {}, body: undefined };
  const res = {
    status(code) { result.status = code; return this; },
    set(name, value) {
      if (typeof name === "object") Object.assign(result.headers, name);
      else result.headers[String(name).toLowerCase()] = value;
      return this;
    },
    send(value) { result.body = value; return this; },
    json(value) { result.body = value; return this; },
    end() { return this; },
    redirect(code, location) { result.status = code; result.headers.location = location; return this; }
  };
  await handler({ headers, params, query, body }, res);
  return result;
}

test("Access identity fails closed when JWT and explicit header trust are both off", async () => {
  await withIdentityEnv({ ADMIN_EMAILS: "admin@example.test" }, async (identity) => {
    assert.equal(identity.ACCESS_IDENTITY_MODE, "disabled");
    const headers = { "cf-access-authenticated-user-email": "admin@example.test" };
    assert.deepEqual(await identity.resolveViewer({ headers }), { email: null, org: null, isAdmin: false });

    const app = createApp(dependencies({ resolveViewer: identity.resolveViewer }));
    const gallery = await invokeRoute(app, "get", "/", { headers });
    assert.equal(gallery.status, 403);
    assert.equal(gallery.body, "not signed in");
    assert.equal((await invokeRoute(app, "get", "/settings", { headers })).status, 403);
  });
});

test("signed-in viewers can advance only their own notification watermark", async () => {
  const seen = [];
  const app = createApp(dependencies({
    resolveViewer: async () => ({ email: "viewer@acme.test", org: "acme", isAdmin: false }),
    notifications: { recentForViewer: () => [], unreadCount: () => 0, markSeen: (email) => seen.push(email) }
  }));
  const response = await invokeRoute(app, "post", "/notifications/seen");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
  assert.deepEqual(seen, ["viewer@acme.test"]);

  const unsigned = createApp(dependencies({
    resolveViewer: async () => ({ email: null, org: null, isAdmin: false }),
    notifications: { recentForViewer: () => [], unreadCount: () => 0, markSeen: (email) => seen.push(email) }
  }));
  const denied = await invokeRoute(unsigned, "post", "/notifications/seen");
  assert.equal(denied.status, 403);
  assert.deepEqual(seen, ["viewer@acme.test"]);
});

test("TRUST_ACCESS_HEADERS=1 explicitly restores local-development header identity", async () => {
  await withIdentityEnv(
    { TRUST_ACCESS_HEADERS: "1", ADMIN_EMAILS: "admin@example.test" },
    async (identity) => {
      assert.equal(identity.ACCESS_IDENTITY_MODE, "header-trust");
      const headers = { "cf-access-authenticated-user-email": "admin@example.test" };
      assert.deepEqual(
        await identity.resolveViewer({ headers }),
        { email: "admin@example.test", org: "admin", isAdmin: true }
      );
      const app = createApp(dependencies({ resolveViewer: identity.resolveViewer }));
      assert.equal((await invokeRoute(app, "get", "/", { headers })).status, 200);
      assert.equal((await invokeRoute(app, "get", "/settings", { headers })).status, 200);
    }
  );
});

test("MCP keys and share tokens remain identity-independent in every Access mode", async () => {
  const modes = [
    [{}, "disabled"],
    [{ TRUST_ACCESS_HEADERS: "1" }, "header-trust"],
    [{ CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", CF_ACCESS_AUD: "aud" }, "jwt"]
  ];
  for (const [env, expectedMode] of modes) {
    await withIdentityEnv(env, async (identity) => {
      assert.equal(identity.ACCESS_IDENTITY_MODE, expectedMode);
      const app = createApp(dependencies({
        checkPublisherKey: () => ({ ok: true, clientId: "publisher", org: "acme", label: "Agent" }),
        handleMcp: async () => ({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
        shares: { resolve: () => ({ artifact_id: "abc123", org: "acme" }) },
        resolveViewer: async () => { throw new Error("identity-independent route resolved viewer"); }
      }));
      const mcp = await invokeRoute(app, "post", "/mcp", {
        headers: { authorization: "Bearer secret" },
        body: { jsonrpc: "2.0", id: 1, method: "ping" }
      });
      assert.equal(mcp.status, 200);
      assert.deepEqual(mcp.body, { jsonrpc: "2.0", id: 1, result: { ok: true } });
      const share = await invokeRoute(app, "get", "/s/:token", { params: { token: "valid" } });
      assert.equal(share.status, 200);
      assert.equal(share.body, "<h1>Artifact</h1>");
    });
  }
});

test("REQUIRE_ACCESS_JWT=1 rejects startup readiness without complete JWT configuration", async () => {
  await withIdentityEnv({ REQUIRE_ACCESS_JWT: "1" }, async (identity) => {
    assert.equal(identity.ACCESS_IDENTITY_MODE, "disabled");
    assert.throws(() => identity.assertReady(), /REQUIRE_ACCESS_JWT=1.*CF_ACCESS_TEAM_DOMAIN.*CF_ACCESS_AUD/);
  });
});

test("header-trust refuses a non-loopback bind unless explicitly acknowledged", async () => {
  await withIdentityEnv({ TRUST_ACCESS_HEADERS: "1", LISTEN_HOST: "0.0.0.0" }, async (identity) => {
    assert.equal(identity.ACCESS_IDENTITY_MODE, "header-trust");
    assert.throws(() => identity.assertReady(), /non-loopback bind/);
  });
  await withIdentityEnv({ TRUST_ACCESS_HEADERS: "1", LISTEN_HOST: "127.0.0.1" }, async (identity) => {
    assert.doesNotThrow(() => identity.assertReady());
  });
  await withIdentityEnv({ TRUST_ACCESS_HEADERS: "1", LISTEN_HOST: "0.0.0.0", HEADER_TRUST_ALLOW_INSECURE: "1" }, async (identity) => {
    assert.doesNotThrow(() => identity.assertReady());
  });
});

test("cross-organization artifact reads are concealed as not found", async () => {
  await serve(createApp(dependencies()), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/abc123`);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "not found");
  });
});

test("public shares serve sandboxed live artifacts while invalid states are the same 404", async () => {
  const artifact = { id: "abc123", org: "acme", title: "Artifact", client_id: "publisher", is_bundle: 0 };
  let state = "valid";
  const app = createApp(dependencies({
    artifacts: { ...dependencies().artifacts, getArtifactMeta: () => artifact },
    shares: { resolve: () => state === "valid" ? { artifact_id: "abc123", org: "acme" } : null, listForArtifact: () => [], revoke: () => false },
    resolveViewer: async () => { throw new Error("public share must not resolve viewer"); }
  }));
  await serve(app, async (baseUrl) => {
    const valid = await fetch(`${baseUrl}/s/token`);
    assert.equal(valid.status, 200);
    assert.match(valid.headers.get("content-security-policy"), /sandbox/);
    assert.equal(valid.headers.get("x-robots-tag"), "noindex");
    assert.doesNotMatch(await valid.text(), /artifact-anchor-bridge/);
    const statuses = [];
    for (const invalid of ["unknown", "expired", "revoked"]) {
      state = invalid;
      const response = await fetch(`${baseUrl}/s/token`);
      statuses.push([response.status, await response.text()]);
    }
    assert.deepEqual(statuses, [[404, "not found"], [404, "not found"], [404, "not found"]]);
  });
});

test("share management requires artifact access and bundle shares guard paths", async () => {
  const bundle = { id: "abc123", org: "acme", title: "Bundle", client_id: "publisher", is_bundle: 1, entry: "index.html" };
  const calls = [];
  const base = dependencies({
    resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false }),
    artifacts: {
      ...dependencies().artifacts,
      getArtifactMeta: () => bundle,
      readBundleFile(_id, rel) { return rel === "index.html" || !rel ? { content: "<h1>Entry</h1>", contentType: "text/html; charset=utf-8" } : rel === "assets/site.css" ? { content: "body{}", contentType: "text/css; charset=utf-8" } : null; }
    },
    shares: {
      resolve: () => ({ artifact_id: "abc123", org: "acme" }),
      create(input) { calls.push(input); return { token: "a".repeat(24), expires_at: null }; },
      listForArtifact: () => [],
      revoke: () => true
    },
    publicBase: "https://artifact.test"
  });
  await serve(createApp(base), async (baseUrl) => {
    const created = await fetch(`${baseUrl}/abc123/share`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expires: "never" }) });
    assert.equal(created.status, 200);
    assert.equal((await created.json()).url, `https://artifact.test/s/${"a".repeat(24)}`);
    const entry = await fetch(`${baseUrl}/s/token/`, { redirect: "manual" });
    assert.equal(entry.status, 200);
    assert.match(entry.headers.get("cache-control") || "", /no-store/); // revocation must be immediate
    assert.equal((await fetch(`${baseUrl}/s/token/assets/site.css`)).status, 200);
    // A missing sub-file 404s. Path-traversal containment lives in the shared readBundleFile
    // (store-tested); the share route reuses it, so `..` escapes are rejected there.
    assert.equal((await fetch(`${baseUrl}/s/token/missing.js`)).status, 404);
  });
  assert.equal(calls[0].createdBy, "member@acme.test");
  await serve(createApp({ ...base, resolveViewer: async () => ({ email: "other@other.test", org: "other", isAdmin: false }) }), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/abc123/shares`)).status, 403);
  });
  await serve(createApp({ ...base, resolveViewer: async () => ({ email: "", org: "", isAdmin: false }) }), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/abc123/shares`)).status, 401);
  });
});

test("administrators can open artifacts across organizations", async () => {
  const app = createApp(dependencies({
    resolveViewer: async () => ({ email: "admin@example.test", org: "admin", isAdmin: true })
  }));
  await serve(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/abc123`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "shell");
    // Identity-dependent HTML must not be cached (else a stale pre-auth page can be served).
    assert.match(response.headers.get("cache-control") || "", /no-store/);
  });
});

test("hidden direct URLs still render, while visibility mutations use artifact access", async () => {
  const artifact = { id: "abc123", org: "acme", title: "Hidden", client_id: "publisher", is_bundle: 0, hidden: 1 };
  let hidden;
  const base = dependencies({
    resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false })
  });
  base.artifacts = { ...base.artifacts, getArtifactMeta: () => artifact, setHidden(_id, next) { hidden = next; return { ok: true, id: artifact.id, hidden: next }; } };
  await serve(createApp(base), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/abc123`)).status, 200);
    const allowed = await fetch(`${baseUrl}/abc123/visibility`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hidden: false }) });
    assert.equal(allowed.status, 200);
    assert.equal(hidden, false);
  });

  base.resolveViewer = async () => ({ email: "member@other.test", org: "other", isAdmin: false });
  await serve(createApp(base), async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/abc123/visibility`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hidden: false }) });
    assert.equal(denied.status, 403);
  });
});

test("non-admins cannot re-tenant artifacts", async () => {
  let moved = false;
  const base = dependencies({ resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false }) });
  base.artifacts = { ...base.artifacts, moveArtifactToOrg() { moved = true; } };
  await serve(createApp(base), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/abc123/move`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ org: "other" }) });
    assert.equal(response.status, 403);
    assert.equal(moved, false);
  });
});

test("artifact shell records named member views but never records admin views", async () => {
  const calls = [];
  let shellAnalytics;
  const base = dependencies({
    resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false }),
    views: {
      record(...args) { calls.push(args); },
      countsFor: () => ({ views: 3, unique_viewers: 2, last_viewed_at: "2026-07-11 12:00:00" }),
      viewersFor: () => [{ email: "audience@acme.test" }],
      countsForOrg: () => new Map(),
      topForOrg: () => []
    },
    pages: {
      ...dependencies().pages,
      shell(_meta, _nav, _reaction, _feedback, analytics) { shellAnalytics = analytics; return "shell"; }
    }
  });
  await serve(createApp(base), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/abc123`);
    assert.equal(response.status, 200);
  });
  assert.deepEqual(calls, [["abc123", "acme", "member@acme.test"]]);
  assert.deepEqual(shellAnalytics.viewers, null);

  base.resolveViewer = async () => ({ email: "admin@example.test", org: "admin", isAdmin: true });
  await serve(createApp(base), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/abc123`);
    assert.equal(response.status, 200);
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(shellAnalytics.viewers, [{ email: "audience@acme.test" }]);
});

test("raw artifact fetches never record a view", async () => {
  let recorded = 0;
  const app = createApp(dependencies({
    resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false }),
    views: { record() { recorded += 1; }, countsFor: () => null, countsForOrg: () => new Map(), viewersFor: () => [], topForOrg: () => [] }
  }));
  await serve(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/raw/abc123`);
    assert.equal(response.status, 200);
  });
  assert.equal(recorded, 0);
});

test("unsigned artifact reads are concealed as not found", async () => {
  const app = createApp(dependencies({
    resolveViewer: async () => ({ email: "", org: "", isAdmin: false })
  }));
  await serve(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/raw/abc123`);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "not found");
  });
});

test("publisher-key creation preserves its display label", async () => {
  let received;
  const app = createApp(dependencies({
    resolveViewer: async () => ({ email: "admin@example.test", org: "admin", isAdmin: true }),
    keys: {
      list: () => [],
      revoke: () => false,
      create(input) {
        received = input;
        return { ...input, secret: "one-time-secret" };
      }
    }
  }));

  await serve(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/settings/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "agent-one", org: "acme", label: "Acme research agent" })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received, { clientId: "agent-one", org: "acme", label: "Acme research agent" });
    assert.equal((await response.json()).label, "Acme research agent");
  });
});

test("non-admins cannot create organizations", async () => {
  let created = 0;
  const base = dependencies({
    resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false })
  });
  base.orgs = { ...base.orgs, create() { created += 1; return {}; } };
  await serve(createApp(base), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/settings/orgs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "sneaky" })
    });
    assert.equal(response.status, 403);
    assert.equal(created, 0);
  });
});

test("admins create organizations through the registry", async () => {
  let received;
  const base = dependencies({
    resolveViewer: async () => ({ email: "admin@example.test", org: "admin", isAdmin: true })
  });
  base.orgs = {
    ...base.orgs,
    create(input) { received = input; return { name: input.name, label: "", domains: [], categories: [], keyCount: 0 }; }
  };
  await serve(createApp(base), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/settings/orgs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "newco", domain: "newco.test" })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received, { name: "newco", domain: "newco.test", label: undefined });
    assert.equal((await response.json()).name, "newco");
  });
});

test("issuing a key to an unregistered org is refused", async () => {
  const base = dependencies({
    resolveViewer: async () => ({ email: "admin@example.test", org: "admin", isAdmin: true })
  });
  base.orgs = { ...base.orgs, has: () => false, create: () => ({}) };
  await serve(createApp(base), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/settings/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "x", org: "ghost", label: "" })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Unknown organization/);
  });
});

test("reaction updates reject invalid values without writing them", async () => {
  let writes = 0;
  const base = dependencies({
    resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false })
  });
  base.reactions = {
    ...base.reactions,
    set() {
      writes += 1;
      return { favorite: 0, vote: 0 };
    }
  };

  await serve(createApp(base), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/abc123/react`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorite: "yes", vote: 4 })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /favorite|vote/i);
    assert.equal(writes, 0);
  });
});

test("same-org raw HTML is served with an opaque-origin sandbox", async () => {
  const app = createApp(dependencies({
    resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false })
  }));

  await serve(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/raw/abc123`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /sandbox/);
    assert.doesNotMatch(response.headers.get("content-security-policy"), /allow-same-origin/);
    assert.equal(await response.text(), "<h1>Artifact</h1>");
  });
});

test("raw and download HTML stay byte-for-byte original while the anchor variant adds only the bridge", async () => {
  const app = createApp(dependencies({
    resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false })
  }));

  await serve(app, async (baseUrl) => {
    const raw = await fetch(`${baseUrl}/raw/abc123`);
    const download = await fetch(`${baseUrl}/raw/abc123?download`);
    const anchored = await fetch(`${baseUrl}/raw/abc123?anchor=1`);
    assert.equal(await raw.text(), "<h1>Artifact</h1>");
    assert.equal(await download.text(), "<h1>Artifact</h1>");
    assert.match(await anchored.text(), /artifact-anchor-bridge/);
  });
});

test("every anchored bundle HTML page receives a page-aware bridge", async () => {
  const artifact = { id: "abc123", org: "acme", title: "Bundle", client_id: "publisher", is_bundle: 1, entry: "index.html", revision: 1 };
  const base = dependencies({ resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false }) });
  base.artifacts = {
    ...base.artifacts,
    getArtifactMeta: () => artifact,
    readBundleFile: (_id, page) => ({ content: `<h1>${page}</h1>`, contentType: "text/html; charset=utf-8" })
  };

  const response = await invokeRoute(createApp(base), "get", "/raw/:id/*", {
    params: { id: "abc123", 0: "pages/two.html" }, query: { anchor: "1" }
  });

  assert.equal(response.status, 200);
  assert.match(String(response.body), /artifact-anchor-bridge/);
  assert.match(String(response.body), /pages\/two\.html/);
});

test("feedback derives organization and revision from the artifact, not request anchor metadata", async () => {
  let received;
  const artifact = { id: "abc123", org: "acme", title: "Artifact", client_id: "publisher", is_bundle: 0, revision: 7 };
  const base = dependencies({ resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false }) });
  base.artifacts = { ...base.artifacts, getArtifactMeta: () => artifact };
  base.feedback = {
    listForArtifact: () => [],
    add(input) {
      received = input;
      return { id: "feedback1", viewer_email: input.viewerEmail, body: input.body, created_at: "2026-07-12", artifact_revision: input.artifactRevision, anchor_path: input.anchor.path, anchor_x: input.anchor.x, anchor_y: input.anchor.y, anchor_approx: 0 };
    }
  };
  await serve(createApp(base), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/abc123/feedback`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Pinned", org: "other", artifactRevision: 999, anchor: { path: "body", x: 0.5, y: 0.5 } })
    });
    assert.equal(response.status, 200);
  });
  assert.equal(received.org, "acme");
  assert.equal(received.artifactRevision, 7);
});

test("bundle feedback records a validated anchor page and exposes it on create", async () => {
  let received;
  const artifact = { id: "abc123", org: "acme", title: "Bundle", client_id: "publisher", is_bundle: 1, entry: "index.html", revision: 7 };
  const base = dependencies({ resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false }) });
  base.artifacts = {
    ...base.artifacts,
    getArtifactMeta: () => artifact,
    readBundleFile: (_id, page) => page === "pages/two.html" ? { content: "<h1>Two</h1>", contentType: "text/html; charset=utf-8" } : null
  };
  base.feedback = {
    listForArtifact: () => [],
    add(input) {
      received = input;
      return {
        id: "feedback-page-2", viewer_email: input.viewerEmail, body: input.body,
        created_at: "2026-07-14", artifact_revision: input.artifactRevision,
        anchor_path: input.anchor.path, anchor_x: input.anchor.x, anchor_y: input.anchor.y,
        anchor_w: null, anchor_h: null, anchor_approx: 0, anchor_page: input.anchorPage,
        parent_id: null
      };
    }
  };

  const response = await invokeRoute(createApp(base), "post", "/:id/feedback", {
    params: { id: "abc123" },
    body: { body: "Pinned on page two", anchor: { path: "body", x: 0.5, y: 0.5 }, anchor_page: "pages/two.html" }
  });

  assert.equal(response.status, 200);
  assert.equal(received.anchorPage, "pages/two.html");
  assert.equal(response.body.anchor_page, "pages/two.html");
});

test("bundle anchor pages reject traversal, absolute, missing, and non-HTML paths", async () => {
  const artifact = { id: "abc123", org: "acme", title: "Bundle", client_id: "publisher", is_bundle: 1, entry: "index.html", revision: 7 };
  const base = dependencies({ resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false }) });
  base.artifacts = {
    ...base.artifacts,
    getArtifactMeta: () => artifact,
    readBundleFile: (_id, page) => page === "styles/site.css" ? { content: "", contentType: "text/css; charset=utf-8" } : null
  };
  base.feedback = { listForArtifact: () => [], add() { throw new Error("invalid page reached feedback store"); } };
  const app = createApp(base);

  for (const anchorPage of [undefined, "../two.html", "pages/../two.html", "/pages/two.html", "C:\\pages\\two.html", "pages/missing.html", "styles/site.css"]) {
    const response = await invokeRoute(app, "post", "/:id/feedback", {
      params: { id: "abc123" },
      body: { body: "Invalid", anchor: { x: 0.5, y: 0.5 }, anchor_page: anchorPage }
    });
    assert.equal(response.status, 400, anchorPage);
    assert.match(response.body.error, /anchor_page/);
  }
});

test("bundle shell marks anchors stale when their recorded page no longer exists", async () => {
  let shellFeedback;
  const artifact = { id: "abc123", org: "acme", title: "Bundle", client_id: "publisher", is_bundle: 1, entry: "index.html", revision: 7 };
  const base = dependencies({ resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false }) });
  base.artifacts = { ...base.artifacts, getArtifactMeta: () => artifact, readBundleFile: () => null };
  base.feedback = { listForArtifact: () => [{ id: "missing-page", anchor_page: "removed.html", anchor_x: 0.5, anchor_y: 0.5 }] };
  base.pages = {
    ...base.pages,
    shell(_meta, _nav, _reaction, rows) { shellFeedback = rows; return "shell"; }
  };

  const response = await invokeRoute(createApp(base), "get", "/:id", { params: { id: "abc123" } });

  assert.equal(response.status, 200);
  assert.equal(shellFeedback[0].anchor_page_stale, true);
});

test("viewer feedback management routes scope feedback to the artifact and enforce own-or-admin results", async () => {
  const calls = [];
  const base = dependencies({ resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false }) });
  base.feedback = {
    listForArtifact: () => [],
    getFeedback(id) {
      return id === "foreign" ? { id, artifact_id: "other", org: "acme", viewer_email: "member@acme.test" }
        : { id, artifact_id: "abc123", org: "acme", viewer_email: "member@acme.test" };
    },
    deleteFeedback(id, actor) { calls.push(["delete", id, actor]); return { ok: id !== "blocked", id, reason: id === "blocked" ? "forbidden" : undefined }; },
    resolveByViewer(id, actor) { calls.push(["resolve", id, actor]); return { ok: id !== "blocked", id, reason: id === "blocked" ? "forbidden" : undefined }; }
  };
  await serve(createApp(base), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/abc123/feedback/owned`, { method: "DELETE" })).status, 200);
    assert.equal((await fetch(`${baseUrl}/abc123/feedback/foreign`, { method: "DELETE" })).status, 404);
    assert.equal((await fetch(`${baseUrl}/abc123/feedback/blocked/resolve`, { method: "POST" })).status, 403);
  });
  assert.deepEqual(calls, [
    ["delete", "owned", { viewerEmail: "member@acme.test", isAdmin: false }],
    ["resolve", "blocked", { viewerEmail: "member@acme.test", isAdmin: false }]
  ]);
});

test("bundle assets keep their content type but still receive the opaque-origin sandbox", async () => {
  // An uploaded .svg/.xml executes scripts on direct navigation, so EVERY raw response —
  // not just text/html — must carry the sandbox CSP. The content type is still preserved.
  const artifact = { id: "abc123", org: "acme", title: "Bundle", client_id: "publisher", is_bundle: 1, entry: "index.html" };
  const base = dependencies({
    resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false })
  });
  base.artifacts = {
    ...base.artifacts,
    getArtifactMeta: () => artifact,
    readBundleFile: () => ({ content: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>0</script></svg>"), contentType: "image/svg+xml" })
  };

  await serve(createApp(base), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/raw/abc123/logo.svg`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /sandbox/);
    assert.doesNotMatch(response.headers.get("content-security-policy"), /allow-same-origin/);
    assert.match(response.headers.get("content-type"), /^image\/svg\+xml/);
  });
});

test("bundle HTML responses receive the same opaque-origin sandbox", async () => {
  const artifact = { id: "abc123", org: "acme", title: "Bundle", client_id: "publisher", is_bundle: 1, entry: "index.html" };
  const base = dependencies({
    resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false })
  });
  base.artifacts = {
    ...base.artifacts,
    getArtifactMeta: () => artifact,
    readBundleFile: () => ({ content: Buffer.from("<h1>Bundle</h1>"), contentType: "text/html; charset=utf-8" })
  };

  await serve(createApp(base), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/raw/abc123/index.html`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /sandbox/);
    assert.doesNotMatch(response.headers.get("content-security-policy"), /allow-same-origin/);
  });
});

test("valid reaction updates are normalized and persisted", async () => {
  let received;
  const base = dependencies({
    resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false })
  });
  base.reactions = {
    ...base.reactions,
    set(_email, _id, update) {
      received = update;
      return update;
    }
  };

  await serve(createApp(base), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/abc123/react`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorite: true, vote: -1 })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received, { favorite: 1, vote: -1 });
    assert.deepEqual(await response.json(), received);
  });
});

test("authorized MCP requests retain their JSON-RPC response contract", async () => {
  let context;
  const app = createApp(dependencies({
    checkPublisherKey: () => ({ ok: true, clientId: "publisher", org: "acme", label: "Agent" }),
    async handleMcp(_payload, auth) {
      context = auth;
      return { jsonrpc: "2.0", id: 7, result: { accepted: true } };
    }
  }));

  await serve(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer secret" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(context, { clientId: "publisher", org: "acme", label: "Agent" });
    assert.deepEqual(await response.json(), { jsonrpc: "2.0", id: 7, result: { accepted: true } });
  });
});

test("viewer restores pass the updated artifact revision to the notifier seam", async () => {
  const emitted = [];
  const artifact = { id: "abc123", org: "acme", title: "Artifact", client_id: "publisher", is_bundle: 0, revision: 2 };
  const base = dependencies({
    resolveViewer: async () => ({ email: "member@acme.test", org: "acme", isAdmin: false }),
    notify: { emit: (...args) => emitted.push(args), test: async () => ({ ok: true }) }
  });
  base.artifacts = {
    ...base.artifacts,
    getArtifactMeta: () => artifact,
    restoreArtifactRevision: () => ({ ok: true, id: artifact.id, revision: 2, restoredFrom: 1, bytes: 10 })
  };

  const response = await invokeRoute(createApp(base), "post", "/:id/restore", {
    params: { id: artifact.id },
    body: { revision: 1 }
  });
  assert.equal(response.status, 200);
  assert.equal(emitted[0][0], "restored");
  assert.deepEqual(emitted[0][3].artifactMeta, artifact);
});

test("preview notifier preserves the admin webhook test action", async () => {
  const webhook = { id: "wh1", org: "acme", url: "https://discord.com/api/webhooks/1/test" };
  const notify = createArtifactPreviewNotifier({
    artifacts: dependencies().artifacts,
    renderer: { enabled: false },
    notify: { emit() {}, test: async (row) => ({ ok: row === webhook }) }
  });
  const app = createApp(dependencies({
    resolveViewer: async () => ({ email: "admin@example.test", org: "admin", isAdmin: true }),
    webhooks: { get: () => webhook },
    notify
  }));

  const response = await invokeRoute(app, "post", "/settings/orgs/:name/webhooks/:id/test", {
    params: { name: "acme", id: "wh1" }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
});
