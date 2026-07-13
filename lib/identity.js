// Resolve the viewing user's org from the Cloudflare Access identity.
//
// Cloudflare Access injects, on every request that passed the front door:
//   Cf-Access-Authenticated-User-Email : the user's email
//   Cf-Access-Jwt-Assertion            : a signed JWT proving it
//
// Production identity comes only from a verified JWT. Trusting the email header is an
// explicit local-development mode because a client that can reach the origin can forge it.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { orgForDomain } from "./orgs.js";

const TEAM_DOMAIN = (process.env.CF_ACCESS_TEAM_DOMAIN || "").trim(); // e.g. yourteam.cloudflareaccess.com
const AUD = (process.env.CF_ACCESS_AUD || "").trim(); // Access application AUD tag
const TRUST_HEADERS = process.env.TRUST_ACCESS_HEADERS === "1";

// domain -> org, e.g. "example.com:acme,team.example.org:teamb"
const DOMAIN_ORG = new Map(
  (process.env.ORG_EMAIL_DOMAINS || "")
    .split(",")
    .map((p) => p.split(":").map((s) => s.trim()))
    .filter(([d, o]) => d && o)
    .map(([d, o]) => [d.toLowerCase(), o])
);

// Admins see every org. Match by explicit email or by domain.
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
);
const ADMIN_DOMAINS = new Set(
  (process.env.ADMIN_EMAIL_DOMAINS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
);

let jwks = null;
function getJwks() {
  if (!jwks && TEAM_DOMAIN) {
    jwks = createRemoteJWKSet(new URL(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`));
  }
  return jwks;
}

export const JWT_VERIFICATION_ON = Boolean(TEAM_DOMAIN && AUD);
export const ACCESS_IDENTITY_MODE = JWT_VERIFICATION_ON
  ? "jwt"
  : TRUST_HEADERS
    ? "header-trust"
    : "disabled";

export function assertReady() {
  if (process.env.REQUIRE_ACCESS_JWT === "1" && !JWT_VERIFICATION_ON) {
    throw new Error(
      "REQUIRE_ACCESS_JWT=1 requires both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD; refusing to start"
    );
  }
}

function domainOf(email) {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

function orgForEmail(email) {
  const domain = domainOf(email);
  const isAdmin = ADMIN_EMAILS.has(email.toLowerCase()) || ADMIN_DOMAINS.has(domain);
  if (isAdmin) return { org: "admin", isAdmin: true };
  // Resolution order: the org registry (managed in Settings) -> the ORG_EMAIL_DOMAINS env
  // map -> the domain is its own org. So any domain allowed in Cloudflare Access still
  // auto-tenants with zero config, while the registry lets an admin give it a pretty org
  // name or merge several domains into one org.
  const org = orgForDomain(domain) || DOMAIN_ORG.get(domain) || domain;
  return { org, isAdmin: false };
}

// -> { email, org, isAdmin }. email/org null means "no access".
export async function resolveViewer(req) {
  let email = "";

  if (ACCESS_IDENTITY_MODE === "jwt") {
    const token = req.headers["cf-access-jwt-assertion"];
    if (!token) return { email: null, org: null, isAdmin: false };
    try {
      const { payload } = await jwtVerify(Array.isArray(token) ? token[0] : token, getJwks(), {
        issuer: `https://${TEAM_DOMAIN}`,
        audience: AUD
      });
      email = String(payload.email || "").toLowerCase();
    } catch {
      return { email: null, org: null, isAdmin: false };
    }
  } else if (ACCESS_IDENTITY_MODE === "header-trust") {
    const h = req.headers["cf-access-authenticated-user-email"];
    email = String((Array.isArray(h) ? h[0] : h) || "").toLowerCase();
  } else {
    return { email: null, org: null, isAdmin: false };
  }

  if (!email) return { email: null, org: null, isAdmin: false };
  const { org, isAdmin } = orgForEmail(email);
  return { email, org, isAdmin };
}
