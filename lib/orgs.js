// Admin org registry: organizations, their email domains (which auto-tenant a signed-in
// viewer), and their category registry. Domain->org here is the source of truth used by
// identity.js, falling back to the ORG_EMAIL_DOMAINS env map, then to the domain itself.
import db from "./db.js";

const listOrgsStmt = db.prepare("SELECT name, label, color, created_at FROM orgs ORDER BY name ASC");
const setColorStmt = db.prepare("UPDATE orgs SET color = ? WHERE name = ?");
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const domainsForStmt = db.prepare("SELECT domain FROM org_domains WHERE org = ? ORDER BY domain ASC");
const categoriesForStmt = db.prepare("SELECT name FROM org_categories WHERE org = ? ORDER BY name ASC");
const activeKeyCountsStmt = db.prepare(
  "SELECT org, COUNT(*) AS n FROM api_keys WHERE revoked_at IS NULL GROUP BY org"
);
const orgExistsStmt = db.prepare("SELECT 1 FROM orgs WHERE name = ?");
const insertOrgStmt = db.prepare("INSERT INTO orgs (name, label) VALUES (?, ?)");
const deleteOrgStmt = db.prepare("DELETE FROM orgs WHERE name = ?");
const insertDomainStmt = db.prepare("INSERT INTO org_domains (domain, org) VALUES (?, ?)");
const deleteDomainStmt = db.prepare("DELETE FROM org_domains WHERE org = ? AND domain = ?");
const domainOwnerStmt = db.prepare("SELECT org FROM org_domains WHERE domain = ?");
const insertCategoryStmt = db.prepare("INSERT OR IGNORE INTO org_categories (org, name) VALUES (?, ?)");
const deleteCategoryStmt = db.prepare("DELETE FROM org_categories WHERE org = ? AND name = ?");

const ORG_RE = /^[a-z0-9][a-z0-9._-]{0,40}$/i;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function normDomain(s) {
  return String(s || "").trim().toLowerCase();
}
function normCategory(s) {
  return String(s || "").trim().replace(/\s+/g, " ").slice(0, 60);
}

export function orgExists(name) {
  return !!orgExistsStmt.get(String(name || "").trim());
}

// domain -> org name, or null when the domain is not registered.
export function orgForDomain(domain) {
  const row = domainOwnerStmt.get(normDomain(domain));
  return row ? row.org : null;
}

export function categoriesFor(org) {
  return categoriesForStmt.all(String(org || "").trim()).map((r) => r.name);
}

export function listOrgNames() {
  return listOrgsStmt.all().map((o) => o.name);
}

export function listOrgs() {
  const counts = new Map(activeKeyCountsStmt.all().map((r) => [r.org, r.n]));
  return listOrgsStmt.all().map((o) => ({
    name: o.name,
    label: o.label,
    color: o.color || null,
    created_at: o.created_at,
    domains: domainsForStmt.all(o.name).map((r) => r.domain),
    categories: categoriesForStmt.all(o.name).map((r) => r.name),
    keyCount: counts.get(o.name) || 0
  }));
}

// Map of org name -> stored accent color (null when unset). Cheap; for gallery/shell rendering.
export function colorMap() {
  const map = {};
  for (const o of listOrgsStmt.all()) map[o.name] = o.color || null;
  return map;
}

// Set (hex like #356B9F or #abc) or clear (empty) an org's accent color. NULL = derived color.
export function setColor(name, color) {
  name = String(name || "").trim();
  color = String(color || "").trim();
  if (!orgExists(name)) throw new Error(`Unknown organization "${name}".`);
  if (color && !HEX_RE.test(color)) throw new Error("Color must be a hex value like #356B9F.");
  setColorStmt.run(color || null, name);
  return { name, color: color || null };
}

export function createOrg({ name, label, domain } = {}) {
  // Case-fold the org id: authorization compares org strings exactly and domains resolve to
  // lowercase, so accepting "Acme" alongside "acme" would silently split one tenant in two.
  name = String(name || "").trim().toLowerCase();
  label = String(label || "").trim().slice(0, 80);
  if (!ORG_RE.test(name)) throw new Error("Org name must be letters, numbers, dot, dash, or underscore (max 41).");
  if (name === "admin") throw new Error('"admin" is a reserved org name.');
  if (orgExists(name)) throw new Error(`Organization "${name}" already exists.`);
  const dom = domain ? normDomain(domain) : "";
  if (dom) {
    if (!DOMAIN_RE.test(dom)) throw new Error(`"${dom}" is not a valid email domain.`);
    const owner = domainOwnerStmt.get(dom);
    if (owner) throw new Error(`Domain "${dom}" is already mapped to "${owner.org}".`);
  }
  db.transaction(() => {
    insertOrgStmt.run(name, label);
    if (dom) insertDomainStmt.run(dom, name);
  })();
  return { name, label, domains: dom ? [dom] : [], categories: [], keyCount: 0 };
}

export function deleteOrg(name) {
  return deleteOrgStmt.run(String(name || "").trim()).changes > 0;
}

export function addDomain(org, domain) {
  org = String(org || "").trim();
  const dom = normDomain(domain);
  if (!orgExists(org)) throw new Error(`Unknown organization "${org}".`);
  if (!DOMAIN_RE.test(dom)) throw new Error(`"${dom}" is not a valid email domain.`);
  const owner = domainOwnerStmt.get(dom);
  if (owner) {
    throw new Error(owner.org === org ? `"${dom}" is already on this org.` : `Domain "${dom}" is already mapped to "${owner.org}".`);
  }
  insertDomainStmt.run(dom, org);
  return { org, domain: dom };
}

export function removeDomain(org, domain) {
  return deleteDomainStmt.run(String(org || "").trim(), normDomain(domain)).changes > 0;
}

export function addCategory(org, name) {
  org = String(org || "").trim();
  const cat = normCategory(name);
  if (!orgExists(org)) throw new Error(`Unknown organization "${org}".`);
  if (!cat) throw new Error("Category name is required.");
  insertCategoryStmt.run(org, cat);
  return { org, name: cat };
}

export function removeCategory(org, name) {
  return deleteCategoryStmt.run(String(org || "").trim(), normCategory(name)).changes > 0;
}
