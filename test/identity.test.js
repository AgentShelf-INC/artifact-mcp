import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const identityDataDir = mkdtempSync(join(tmpdir(), "artifact-mcp-identity-unit-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = identityDataDir;
const orgs = await import("../lib/orgs.js");
test.after(() => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  rmSync(identityDataDir, { recursive: true, force: true });
});

let identityImportId = 0;
async function withIdentityEnv(values, fn) {
  const names = [
    "CF_ACCESS_TEAM_DOMAIN",
    "CF_ACCESS_AUD",
    "TRUST_ACCESS_HEADERS",
    "ADMIN_EMAILS",
    "ADMIN_EMAIL_DOMAINS",
    "ORG_EMAIL_DOMAINS"
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, values);
  try {
    const url = new URL(`../lib/identity.js?identity-test=${++identityImportId}`, import.meta.url);
    return await fn(await import(url.href));
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const NO_VIEWER = { email: null, org: null, isAdmin: false };
const JWT_ENV = {
  CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
  CF_ACCESS_AUD: "access-audience",
  ADMIN_EMAILS: "admin@example.test"
};

test("JWT identity prefers the assertion header and ignores the Access cookie", async () => {
  await withIdentityEnv(JWT_ENV, async ({ createViewerResolver }) => {
    const calls = [];
    const resolveViewer = createViewerResolver({
      verifyJwt: async (token, jwks, options) => {
        calls.push({ token, jwks, options });
        return { payload: { email: "member@acme.test" } };
      }
    });

    assert.deepEqual(await resolveViewer({ headers: {
      "cf-access-jwt-assertion": "header-token",
      cookie: "CF_Authorization=cookie-token"
    } }), { email: "member@acme.test", org: "acme.test", isAdmin: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].token, "header-token");
    assert.equal(typeof calls[0].jwks, "function");
    assert.deepEqual(calls[0].options, {
      issuer: "https://team.cloudflareaccess.com",
      audience: "access-audience",
      clockTolerance: 60
    });
  });
});

test("JWT identity falls back to a valid CF_Authorization cookie", async () => {
  await withIdentityEnv(JWT_ENV, async ({ createViewerResolver }) => {
    const tokens = [];
    const resolveViewer = createViewerResolver({
      verifyJwt: async (token) => {
        tokens.push(token);
        return { payload: { email: "ADMIN@EXAMPLE.TEST" } };
      }
    });

    assert.deepEqual(
      await resolveViewer({ headers: {
        "cf-access-jwt-assertion": "",
        cookie: "theme=dark; CF_Authorization=cookie.jwt=value; view=grid"
      } }),
      { email: "admin@example.test", org: "admin", isAdmin: true }
    );
    assert.deepEqual(tokens, ["cookie.jwt=value"]);
  });
});

test("invalid Access cookies fail closed for every verification failure mode", async () => {
  await withIdentityEnv(JWT_ENV, async ({ createViewerResolver }) => {
    for (const failure of ["expired", "wrong-audience", "wrong-issuer", "malformed"]) {
      const resolveViewer = createViewerResolver({
        verifyJwt: async () => { throw new Error(failure); }
      });
      assert.deepEqual(
        await resolveViewer({ headers: { cookie: `CF_Authorization=${failure}` } }),
        NO_VIEWER,
        failure
      );
    }
  });
});

test("missing, empty, and inexact Access cookies do not invoke verification", async () => {
  await withIdentityEnv(JWT_ENV, async ({ createViewerResolver }) => {
    let calls = 0;
    const resolveViewer = createViewerResolver({
      verifyJwt: async () => {
        calls += 1;
        return { payload: { email: "member@acme.test" } };
      }
    });

    for (const cookie of [undefined, "", "other=value", "CF_Authorization=   ", "CF_AuthorizationX=token"]) {
      assert.deepEqual(await resolveViewer({ headers: { cookie } }), NO_VIEWER);
    }
    assert.equal(calls, 0);
  });
});

test("Access cookie parsing handles arrays, whitespace, multiple cookies, and equals signs", async () => {
  await withIdentityEnv(JWT_ENV, async ({ readAccessCookie }) => {
    assert.equal(readAccessCookie({ headers: {
      cookie: ["first=one", "  theme=dark ;  CF_Authorization = eyJ.part=tail== ; last=value  "]
    } }), "eyJ.part=tail==");
    assert.equal(readAccessCookie({ headers: { cookie: "CF_AuthorizationX=wrong; CF_Authorization=right" } }), "right");
    assert.equal(readAccessCookie({ headers: { cookie: "CF_AuthorizationX=wrong" } }), "");
  });
});

test("Access session retry targets root and valid direct artifact navigations", async () => {
  await withIdentityEnv(JWT_ENV, async () => {
    const { accessRetryTarget } = await import("../lib/access-retry.js");
    const request = (url) => ({
      method: "GET",
      url,
      headers: { cookie: "CF_Authorization=session-token" }
    });

    assert.equal(
      accessRetryTarget(request("/"), { mode: "jwt", param: "cf_access_retry" }),
      "/?cf_access_retry=1"
    );
    assert.equal(
      accessRetryTarget(request("/abcdef123456"), { mode: "jwt", param: "cf_access_retry" }),
      "/abcdef123456?cf_access_retry=1"
    );
    assert.equal(
      accessRetryTarget(request("/abcdef123456?view=grid"), { mode: "jwt", param: "cf_access_retry" }),
      "/abcdef123456?view=grid&cf_access_retry=1"
    );
  });
});

test("Access session retry excludes non-shell, reserved, malformed, and multi-segment paths", async () => {
  await withIdentityEnv(JWT_ENV, async () => {
    const { accessRetryTarget } = await import("../lib/access-retry.js");
    const request = (url) => ({
      method: "GET",
      url,
      headers: { cookie: "CF_Authorization=session-token" }
    });
    const ineligible = [
      "/raw/abcdef123456",
      "/raw/abcdef123456/x.css",
      "/thumbnails/abcdef123456",
      "/s/sometoken",
      "/abcdef123456/history",
      "/abcdef123456/feedback",
      "/mcp",
      "/health",
      "/settings",
      "/raw",
      "/short",
      `/${"a".repeat(25)}`,
      "/ABCDEF123456",
      "/abcdef/second"
    ];

    for (const pathname of ineligible) {
      assert.equal(
        accessRetryTarget(request(pathname), { mode: "jwt", param: "cf_access_retry" }),
        null,
        pathname
      );
    }
  });
});

test("Access session retry preserves identity, method, assertion, and once-only guards", async () => {
  await withIdentityEnv(JWT_ENV, async () => {
    const { accessRetryTarget } = await import("../lib/access-retry.js");
    const base = {
      method: "GET",
      url: "/abcdef123456",
      headers: { cookie: "CF_Authorization=session-token" }
    };
    const target = (request, mode = "jwt") => accessRetryTarget(request, {
      mode,
      param: "cf_access_retry"
    });

    assert.equal(target({ ...base, headers: {} }), null);
    assert.equal(target({ ...base, headers: {
      ...base.headers,
      "cf-access-jwt-assertion": "signed-assertion"
    } }), null);
    assert.equal(target({ ...base, url: "/abcdef123456?cf_access_retry=1" }), null);
    assert.equal(target({ ...base, method: "POST" }), null);
    assert.equal(target(base, "header-trust"), null);
    assert.equal(target(base, "disabled"), null);
  });
});

test("header-trust and disabled identity modes are unaffected", async () => {
  await withIdentityEnv({ TRUST_ACCESS_HEADERS: "1" }, async ({ ACCESS_IDENTITY_MODE, createViewerResolver }) => {
    assert.equal(ACCESS_IDENTITY_MODE, "header-trust");
    const resolveViewer = createViewerResolver({ verifyJwt: async () => { throw new Error("not used"); } });
    assert.deepEqual(await resolveViewer({ headers: {
      "cf-access-authenticated-user-email": "MEMBER@ACME.TEST",
      cookie: "CF_Authorization=ignored"
    } }), { email: "member@acme.test", org: "acme.test", isAdmin: false });
  });

  await withIdentityEnv({}, async ({ ACCESS_IDENTITY_MODE, createViewerResolver }) => {
    assert.equal(ACCESS_IDENTITY_MODE, "disabled");
    const resolveViewer = createViewerResolver({ verifyJwt: async () => { throw new Error("not used"); } });
    assert.deepEqual(await resolveViewer({ headers: {
      "cf-access-authenticated-user-email": "member@acme.test",
      cookie: "CF_Authorization=ignored"
    } }), NO_VIEWER);
  });
});

test("explicit email membership wins before domain routing but never before admin identity", async () => {
  orgs.createOrg({ name: "identity-explicit" });
  orgs.createOrg({ name: "identity-domain", domain: "shared.test" });
  orgs.addEmailMember("identity-explicit", "contractor@shared.test");
  orgs.addEmailMember("identity-explicit", "admin@shared.test");
  orgs.addEmailMember("identity-explicit", "domain-admin@admin-shared.test");

  try {
    await withIdentityEnv({
      TRUST_ACCESS_HEADERS: "1",
      ORG_EMAIL_DOMAINS: "shared.test:identity-env,env.test:environment-org",
      ADMIN_EMAILS: "admin@shared.test",
      ADMIN_EMAIL_DOMAINS: "admin-shared.test"
    }, async ({ createViewerResolver }) => {
      const resolveViewer = createViewerResolver();
      const requestFor = (email) => ({ headers: { "cf-access-authenticated-user-email": email } });

      assert.deepEqual(await resolveViewer(requestFor("contractor@shared.test")), {
        email: "contractor@shared.test", org: "identity-explicit", isAdmin: false
      });
      assert.deepEqual(await resolveViewer(requestFor("admin@shared.test")), {
        email: "admin@shared.test", org: "admin", isAdmin: true
      });
      assert.deepEqual(await resolveViewer(requestFor("domain-admin@admin-shared.test")), {
        email: "domain-admin@admin-shared.test", org: "admin", isAdmin: true
      });

      assert.equal(orgs.removeEmailMember("identity-explicit", "contractor@shared.test"), true);
      assert.deepEqual(await resolveViewer(requestFor("contractor@shared.test")), {
        email: "contractor@shared.test", org: "identity-domain", isAdmin: false
      });

      orgs.addEmailMember("identity-explicit", "person@env.test");
      assert.equal((await resolveViewer(requestFor("person@env.test"))).org, "identity-explicit");
      orgs.removeEmailMember("identity-explicit", "person@env.test");
      assert.equal((await resolveViewer(requestFor("person@env.test"))).org, "environment-org");
      assert.equal((await resolveViewer(requestFor("person@fallback.test"))).org, "fallback.test");
    });
  } finally {
    orgs.deleteOrg("identity-domain");
    orgs.deleteOrg("identity-explicit");
  }
});

test("a whitespace-padded identity is normalized before admin, mapping, and domain resolution", async () => {
  orgs.createOrg({ name: "ws-explicit" });
  orgs.addEmailMember("ws-explicit", "boss@ws.test");
  try {
    await withIdentityEnv({
      TRUST_ACCESS_HEADERS: "1",
      ADMIN_EMAILS: "boss@ws.test"
    }, async ({ createViewerResolver }) => {
      const resolveViewer = createViewerResolver();
      // The verified email arrives with surrounding whitespace and mixed case. It must be
      // normalized before the admin check, or the trimmed mapping lookup would demote the
      // configured administrator into "ws-explicit" — the exact precedence the PBI forbids.
      assert.deepEqual(
        await resolveViewer({ headers: { "cf-access-authenticated-user-email": "  Boss@WS.test  " } }),
        { email: "boss@ws.test", org: "admin", isAdmin: true }
      );
    });
  } finally {
    orgs.deleteOrg("ws-explicit");
  }
});
