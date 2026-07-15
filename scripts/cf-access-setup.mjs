#!/usr/bin/env node
import { createHash } from "node:crypto";

const API_BASE = "https://api.cloudflare.com/client/v4";
const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  console.log(`Usage: node scripts/cf-access-setup.mjs [--apply]

Dry-run is the default. --apply creates or updates non-policy Cloudflare settings.

Required env:
  CF_API_TOKEN CF_ACCOUNT_ID PUBLIC_BASE_URL CF_ACCESS_IDP_ID

Optional env:
  CF_ZONE_ID CF_ACCESS_SESSION_DURATION
  CF_ACCESS_LOGIN_LOGO_URL CF_ACCESS_LOGIN_HEADER CF_ACCESS_LOGIN_FOOTER
  CF_ACCESS_LOGIN_BACKGROUND_COLOR CF_ACCESS_LOGIN_TEXT_COLOR`);
  process.exit(0);
}

for (const arg of args) {
  if (arg !== "--apply") throw new Error(`Unknown argument: ${arg}`);
}

const apply = args.has("--apply");
let config;

class CloudflareApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "CloudflareApiError";
    this.status = status;
  }
}

function env(name, { required = false, fallback = "" } = {}) {
  const value = String(process.env[name] || fallback).trim();
  if (required && !value) throw new Error(`${name} is required`);
  return value;
}

function publicHostname(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error("PUBLIC_BASE_URL must be a public HTTPS URL without embedded credentials");
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("PUBLIC_BASE_URL must identify a hostname, without a path, query, or fragment");
  }
  return url.hostname.toLowerCase();
}

function validateDuration(value) {
  if (!/^(?:\d+(?:ns|us|µs|ms|s|m|h))+$/.test(value)) {
    throw new Error("CF_ACCESS_SESSION_DURATION must use Cloudflare duration syntax, for example 24h");
  }
  return value;
}

function validateColor(name, value) {
  if (value && !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${name} must be a six-digit hex color such as #142235`);
  }
  return value;
}

function validateLogo(value) {
  if (!value) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CF_ACCESS_LOGIN_LOGO_URL must be a public HTTPS URL");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error("CF_ACCESS_LOGIN_LOGO_URL must be a public HTTPS URL without embedded credentials");
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sameValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

async function cf(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.apiToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch (error) {
    throw new CloudflareApiError(`Cloudflare API request failed: ${error.message}`, 0);
  }

  const text = await response.text();
  let envelope;
  try {
    envelope = text ? JSON.parse(text) : {};
  } catch {
    throw new CloudflareApiError(
      `Cloudflare API ${method} ${path} returned non-JSON status ${response.status}`,
      response.status
    );
  }
  if (!response.ok || envelope.success === false) {
    const details = [...(envelope.errors || []), ...(envelope.messages || [])]
      .map((entry) => [entry.code, entry.message].filter(Boolean).join(": "))
      .filter(Boolean)
      .join("; ");
    throw new CloudflareApiError(
      `Cloudflare API ${method} ${path} failed (${response.status})${details ? `: ${details}` : ""}`,
      response.status
    );
  }
  return envelope;
}

function normalizedTarget(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

function appMatchesHostname(app, hostname) {
  if (!app || app.type !== "self_hosted") return false;
  if (normalizedTarget(app.domain) === hostname) return true;
  return Array.isArray(app.destinations) && app.destinations.some(
    (destination) => destination?.type === "public" && normalizedTarget(destination.uri) === hostname
  );
}

async function listAccessApps() {
  const applications = [];
  let page = 1;
  let totalPages = 1;
  do {
    const envelope = await cf(
      `/accounts/${encodeURIComponent(config.accountId)}/access/apps?per_page=100&page=${page}`
    );
    applications.push(...(Array.isArray(envelope.result) ? envelope.result : []));
    totalPages = Math.max(1, Number(envelope.result_info?.total_pages) || 1);
    page += 1;
  } while (page <= totalPages);
  return applications;
}

const APP_UPDATE_FIELDS = [
  "name",
  "domain",
  "type",
  "allow_authenticate_via_warp",
  "allow_iframe",
  "allowed_idps",
  "app_launcher_visible",
  "auto_redirect_to_identity",
  "cors_headers",
  "custom_deny_message",
  "custom_deny_url",
  "custom_non_identity_deny_url",
  "custom_pages",
  "destinations",
  "mfa_config",
  "options_preflight_bypass",
  "read_service_tokens_from_header",
  "service_auth_401_redirect",
  "session_duration",
  "skip_interstitial",
  "tags",
  "use_clientless_isolation_app_launcher_url"
];

function pick(source, fields) {
  return Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
}

async function ensureAccessApp() {
  const matches = (await listAccessApps()).filter((app) => appMatchesHostname(app, config.hostname));
  if (matches.length > 1) {
    throw new Error(`More than one self-hosted Access application matches ${config.hostname}; resolve the duplicate before continuing`);
  }

  if (!matches.length) {
    const desired = {
      name: `artifact-mcp (${config.hostname})`,
      domain: config.hostname,
      type: "self_hosted",
      destinations: [{ type: "public", uri: config.hostname }],
      allowed_idps: [config.idpId],
      auto_redirect_to_identity: true,
      app_launcher_visible: false,
      session_duration: config.sessionDuration
    };
    if (!apply) {
      console.log(`[dry-run] Access application: would create catch-all ${config.hostname}`);
      return null;
    }
    const envelope = await cf(`/accounts/${encodeURIComponent(config.accountId)}/access/apps`, {
      method: "POST",
      body: desired
    });
    console.log(`Access application: created ${config.hostname}`);
    return envelope.result;
  }

  const current = matches[0];
  const correct = current.auto_redirect_to_identity === true &&
    sameValue(current.allowed_idps || [], [config.idpId]) &&
    current.session_duration === config.sessionDuration;
  if (correct) {
    console.log(`Access application: no-op (${current.id})`);
    return current;
  }

  const desired = {
    ...pick(current, APP_UPDATE_FIELDS),
    domain: current.domain || config.hostname,
    type: "self_hosted",
    allowed_idps: [config.idpId],
    auto_redirect_to_identity: true,
    session_duration: config.sessionDuration
  };
  if (!apply) {
    console.log(`[dry-run] Access application: would enable direct single-IdP login on ${current.id}`);
    return current;
  }
  const envelope = await cf(
    `/accounts/${encodeURIComponent(config.accountId)}/access/apps/${encodeURIComponent(current.id)}`,
    { method: "PUT", body: desired }
  );
  console.log(`Access application: updated ${current.id}`);
  return envelope.result;
}

const ORGANIZATION_UPDATE_FIELDS = [
  "allow_authenticate_via_warp",
  "auth_domain",
  "auto_redirect_to_identity",
  "custom_pages",
  "deny_unmatched_requests",
  "deny_unmatched_requests_exempted_zone_names",
  "is_ui_read_only",
  "login_design",
  "mfa_config",
  "mfa_piv_key_requirements",
  "mfa_required_for_all_apps",
  "name",
  "session_duration",
  "ui_read_only_toggle_reason",
  "user_seat_expiration_inactive_time",
  "warp_auth_session_duration"
];

async function getOrganization() {
  const envelope = await cf(`/accounts/${encodeURIComponent(config.accountId)}/access/organizations`);
  if (!envelope.result || typeof envelope.result !== "object") {
    throw new Error("Cloudflare did not return a Zero Trust organization for this account");
  }
  return envelope.result;
}

async function ensureLoginDesign(organization) {
  if (!Object.keys(config.loginDesign).length) {
    console.log("Account-wide login design: no inputs supplied; skipped");
    return organization;
  }
  const current = organization.login_design || {};
  const desired = { ...current, ...config.loginDesign };
  console.log("Account-wide login design (affects every Access application):");
  console.log(JSON.stringify({ current, desired }, null, 2));
  if (sameValue(current, desired)) {
    console.log("Account-wide login design: no-op");
    return organization;
  }
  if (!apply) {
    console.log("[dry-run] Account-wide login design: would update reusable Access Custom Page branding");
    return organization;
  }
  const body = { ...pick(organization, ORGANIZATION_UPDATE_FIELDS), login_design: desired };
  const envelope = await cf(`/accounts/${encodeURIComponent(config.accountId)}/access/organizations`, {
    method: "PUT",
    body
  });
  console.log("Account-wide login design: updated");
  return envelope.result;
}

function configurationRule() {
  const digest = createHash("sha256").update(config.hostname).digest("hex").slice(0, 12);
  return {
    ref: `artifact_mcp_email_off_${digest}`,
    expression: `http.host eq ${JSON.stringify(config.hostname)}`,
    description: `artifact-mcp: disable Email Obfuscation for ${config.hostname}`,
    action: "set_config",
    action_parameters: { email_obfuscation: false },
    enabled: true
  };
}

function ruleIsCorrect(current, desired) {
  return current?.action === desired.action && current?.expression === desired.expression &&
    current?.enabled !== false && sameValue(current?.action_parameters || {}, desired.action_parameters);
}

async function ensureConfigurationRule() {
  if (!config.zoneId) {
    console.warn("Configuration Rule: skipped (CF_ZONE_ID is unset; origin no-transform remains active)");
    return;
  }
  const desired = configurationRule();
  try {
    const listed = await cf(`/zones/${encodeURIComponent(config.zoneId)}/rulesets?per_page=100`);
    const phaseRulesets = (Array.isArray(listed.result) ? listed.result : []).filter(
      (ruleset) => ruleset.kind === "zone" && ruleset.phase === "http_config_settings"
    );
    if (phaseRulesets.length > 1) {
      throw new Error("multiple zone entry-point rulesets exist for http_config_settings");
    }

    if (!phaseRulesets.length) {
      if (!apply) {
        console.log(`[dry-run] Configuration Rule: would create for ${config.hostname}`);
        return;
      }
      await cf(`/zones/${encodeURIComponent(config.zoneId)}/rulesets`, {
        method: "POST",
        body: {
          name: "artifact-mcp configuration rules",
          description: "Host-specific response transformation safeguards for artifact-mcp",
          kind: "zone",
          phase: "http_config_settings",
          rules: [desired]
        }
      });
      console.log("Configuration Rule: created with the phase ruleset");
      return;
    }

    const ruleset = (await cf(
      `/zones/${encodeURIComponent(config.zoneId)}/rulesets/${encodeURIComponent(phaseRulesets[0].id)}`
    )).result;
    const current = (ruleset.rules || []).find(
      (rule) => rule.ref === desired.ref || rule.description === desired.description
    );
    if (current && ruleIsCorrect(current, desired)) {
      console.log("Configuration Rule: no-op");
      return;
    }
    if (!apply) {
      console.log(`[dry-run] Configuration Rule: would ${current ? "update" : "add"} for ${config.hostname}`);
      return;
    }
    if (current) {
      await cf(
        `/zones/${encodeURIComponent(config.zoneId)}/rulesets/${encodeURIComponent(ruleset.id)}/rules/${encodeURIComponent(current.id)}`,
        { method: "PATCH", body: desired }
      );
      console.log("Configuration Rule: updated");
    } else {
      await cf(
        `/zones/${encodeURIComponent(config.zoneId)}/rulesets/${encodeURIComponent(ruleset.id)}/rules`,
        { method: "POST", body: desired }
      );
      console.log("Configuration Rule: added");
    }
  } catch (error) {
    console.warn(`Configuration Rule: skipped (${error.message}; origin no-transform remains active)`);
  }
}

function operatorActions(app) {
  console.log("\nRuntime values:");
  if (app?.aud) console.log(`CF_ACCESS_AUD=${app.aud}`);
  else if (!apply) console.log("CF_ACCESS_AUD=<created by a subsequent --apply run>");
  if (config.organization?.auth_domain) {
    console.log(`CF_ACCESS_TEAM_DOMAIN=${config.organization.auth_domain}`);
  } else {
    console.warn("CF_ACCESS_TEAM_DOMAIN was not returned; copy the organization auth domain from Zero Trust");
  }

  console.log(`\nRemaining operator-owned security actions (this script never changes policies):
  1. Create or retain an Access application for ${config.hostname}/mcp with Bypass -> Everyone.
  2. Create or retain an Access application for ${config.hostname}/s/* with Bypass -> Everyone.
  3. Create or retain the intended-viewer Allow policy on the catch-all ${config.hostname} app${app?.id ? ` (${app.id})` : ""}.
  4. Set CF_ACCESS_AUD, CF_ACCESS_TEAM_DOMAIN, and REQUIRE_ACCESS_JWT=1 in the runtime environment.
  5. Fully restart artifact-mcp; editing an env file does not update module-initialized identity settings.`);
}

function readConfig() {
  const loginDesignEntries = [
    ["logo_path", validateLogo(env("CF_ACCESS_LOGIN_LOGO_URL"))],
    ["header_text", env("CF_ACCESS_LOGIN_HEADER")],
    ["footer_text", env("CF_ACCESS_LOGIN_FOOTER")],
    ["background_color", validateColor("CF_ACCESS_LOGIN_BACKGROUND_COLOR", env("CF_ACCESS_LOGIN_BACKGROUND_COLOR"))],
    ["text_color", validateColor("CF_ACCESS_LOGIN_TEXT_COLOR", env("CF_ACCESS_LOGIN_TEXT_COLOR"))]
  ].filter(([, value]) => value);
  return {
    apiToken: env("CF_API_TOKEN", { required: true }),
    accountId: env("CF_ACCOUNT_ID", { required: true }),
    hostname: publicHostname(env("PUBLIC_BASE_URL", { required: true })),
    idpId: env("CF_ACCESS_IDP_ID", { required: true }),
    zoneId: env("CF_ZONE_ID"),
    sessionDuration: validateDuration(env("CF_ACCESS_SESSION_DURATION", { fallback: "24h" })),
    loginDesign: Object.fromEntries(loginDesignEntries),
    organization: null
  };
}

async function main() {
  config = readConfig();
  console.log(`artifact-mcp Cloudflare Access setup (${apply ? "apply" : "dry-run"})`);
  console.log(`Hostname: ${config.hostname}`);
  config.organization = await getOrganization();
  const app = await ensureAccessApp();
  config.organization = await ensureLoginDesign(config.organization);
  await ensureConfigurationRule();
  operatorActions(app);
}

main().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
});
