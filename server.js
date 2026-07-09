import express from "express";
import { seedKeysFromEnv } from "./lib/db.js";
import { sha256Hex, checkKey } from "./lib/auth.js";
import { handleMcp } from "./lib/mcp.js";
import {
  readArtifact,
  isReserved,
  listOrgArtifacts,
  listAllGroupedByOrg,
  getArtifactMeta,
  deleteArtifactById
} from "./lib/store.js";
import { resolveViewer, JWT_VERIFICATION_ON } from "./lib/identity.js";
import { renderGallery } from "./lib/portal.js";
import { renderSettings } from "./lib/settings.js";
import { listKeys, createKey, revokeKey } from "./lib/keys.js";

const PORT = Number(process.env.PORT || 3480);

console.log(`[artifact-mcp] seeded ${seedKeysFromEnv(sha256Hex)} key(s) from env`);
console.log(`[artifact-mcp] Access JWT verification: ${JWT_VERIFICATION_ON ? "ON" : "OFF (trusting header — set CF_ACCESS_TEAM_DOMAIN+CF_ACCESS_AUD for production)"}`);

const app = express();
app.disable("x-powered-by");

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// --- MCP upload endpoint (API-key auth; Cloudflare Access bypasses this path) ---
app.post("/mcp", express.json({ limit: "8mb" }), async (req, res) => {
  const auth = checkKey(req);
  if (!auth.ok) {
    return res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } });
  }
  try {
    const out = await handleMcp(req.body, { clientId: auth.clientId, org: auth.org });
    if (!out) return res.status(202).end();
    return res.json(out);
  } catch (err) {
    return res
      .status(400)
      .json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: String(err.message || err) } });
  }
});
app.options("/mcp", (_req, res) =>
  res.set({ "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" }).status(204).end()
);

// --- Gallery portal, scoped to the viewer's org (behind Cloudflare Access) ---
app.get("/", async (req, res) => {
  const viewer = await resolveViewer(req);
  res.set("content-type", "text/html; charset=utf-8");

  if (!viewer.email) {
    return res
      .status(403)
      .send(`<!doctype html><meta charset="utf-8"><title>Artifacts</title><body style="font:16px system-ui;margin:4rem auto;max-width:40rem;padding:0 1.25rem"><h1>Artifacts</h1><p style="opacity:.6">Not signed in.</p></body>`);
  }

  let sections;
  if (viewer.isAdmin) {
    sections = [...listAllGroupedByOrg().entries()].map(([org, items]) => ({ org, items }));
  } else if (viewer.org) {
    sections = [{ org: viewer.org, items: listOrgArtifacts(viewer.org) }];
  } else {
    sections = [];
  }

  res.send(renderGallery(viewer, sections));
});

// --- Settings (admin only): manage per-org upload API keys ---
function denyNonAdmin(viewer, res, json) {
  const status = viewer.email ? 403 : 401;
  const msg = viewer.email ? "Admins only" : "Not signed in";
  json ? res.status(status).json({ error: msg }) : res.status(status).send(msg);
  return true;
}

app.get("/settings", async (req, res) => {
  const viewer = await resolveViewer(req);
  if (!viewer.isAdmin) return denyNonAdmin(viewer, res, false);
  const keys = listKeys();
  const orgs = [...new Set(keys.map((k) => k.org))];
  res.set("content-type", "text/html; charset=utf-8").send(renderSettings(viewer, keys, orgs));
});

app.post("/settings/keys", express.json({ limit: "64kb" }), async (req, res) => {
  const viewer = await resolveViewer(req);
  if (!viewer.isAdmin) return denyNonAdmin(viewer, res, true);
  try {
    const { clientId, org, secret } = createKey({ clientId: req.body?.clientId, org: req.body?.org });
    console.log(`[artifact-mcp] key created ${clientId} (org=${org}) by ${viewer.email}`);
    return res.json({ clientId, org, secret, created_at: new Date().toISOString() });
  } catch (err) {
    return res.status(400).json({ error: String(err.message || err) });
  }
});

app.post("/settings/keys/:id/revoke", async (req, res) => {
  const viewer = await resolveViewer(req);
  if (!viewer.isAdmin) return denyNonAdmin(viewer, res, true);
  const revoked = revokeKey(req.params.id);
  console.log(`[artifact-mcp] key revoke ${req.params.id} by ${viewer.email} -> ${revoked}`);
  return res.json({ id: req.params.id, revoked });
});

// --- Serve a published artifact by id, scoped to the viewer's org ---
app.get("/:id", async (req, res) => {
  const id = req.params.id;
  if (isReserved(id)) return res.status(404).send("Not found");
  const found = readArtifact(id);
  if (!found) return res.status(404).send("Not found");

  const viewer = await resolveViewer(req);
  const allowed = viewer.isAdmin || (viewer.org && viewer.org === found.meta.org);
  if (!allowed) return res.status(404).send("Not found"); // don't reveal existence across orgs

  res
    .set({
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "private, max-age=60"
    })
    .send(found.html);
});

// --- Delete an artifact from the portal (admin, or a viewer within their own org) ---
// Behind Cloudflare Access -> resolveViewer() gives a verified identity.
app.delete("/:id", async (req, res) => {
  const id = req.params.id;
  if (isReserved(id)) return res.status(404).json({ error: "Not found" });
  const meta = getArtifactMeta(id);
  if (!meta) return res.status(404).json({ error: "Not found" });

  const viewer = await resolveViewer(req);
  if (!viewer.email) return res.status(401).json({ error: "Not signed in" });
  const allowed = viewer.isAdmin || (viewer.org && viewer.org === meta.org);
  if (!allowed) return res.status(403).json({ error: "You can only delete artifacts in your own org" });

  const deleted = deleteArtifactById(id);
  console.log(`[artifact-mcp] delete ${id} (org=${meta.org}) by ${viewer.email} -> ${deleted}`);
  return res.json({ id, deleted });
});

app.listen(PORT, () => console.log(`[artifact-mcp] listening on :${PORT}`));
