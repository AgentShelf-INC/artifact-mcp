import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../lib/app.js";

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
      removeCategory: () => true
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

test("cross-organization artifact reads are concealed as not found", async () => {
  await serve(createApp(dependencies()), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/abc123`);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "not found");
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
