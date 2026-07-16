import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const identityDataDir = mkdtempSync(join(tmpdir(), "artifact-mcp-identity-unit-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = identityDataDir;
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
      audience: "access-audience"
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
