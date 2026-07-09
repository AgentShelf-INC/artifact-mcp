import express from "express";
import { seedKeysFromEnv } from "./lib/db.js";
import { sha256Hex, checkKey } from "./lib/auth.js";
import { handleMcp } from "./lib/mcp.js";
import { readArtifact, isReserved, listOrgGroupedByClient, listAllGroupedByOrg } from "./lib/store.js";
import { resolveViewer, JWT_VERIFICATION_ON } from "./lib/identity.js";

const PORT = Number(process.env.PORT || 3480);

console.log(`[artifact-mcp] seeded ${seedKeysFromEnv(sha256Hex)} key(s) from env`);
console.log(`[artifact-mcp] Access JWT verification: ${JWT_VERIFICATION_ON ? "ON" : "OFF (trusting header — set CF_ACCESS_TEAM_DOMAIN+CF_ACCESS_AUD for production)"}`);

const app = express();
app.disable("x-powered-by");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function page(title, bodyHtml) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light dark}
body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:3rem auto;padding:0 1.25rem}
h1{font-size:1.6rem;margin:0 0 .25rem} .sub{opacity:.6;margin:0 0 2rem}
h2{font-size:1rem;text-transform:uppercase;letter-spacing:.05em;opacity:.7;margin:2rem 0 .5rem;border-bottom:1px solid #8884;padding-bottom:.3rem}
h3{font-size:.85rem;opacity:.55;margin:1.2rem 0 .3rem;font-weight:600}
ul{list-style:none;padding:0;margin:0} li{padding:.35rem 0}
a{font-weight:600;text-decoration:none;color:#3b82f6} a:hover{text-decoration:underline}
.d{opacity:.65} .empty{opacity:.6}
</style></head><body>${bodyHtml}</body></html>`;
}

function renderClientGroups(groups) {
  let html = "";
  for (const [clientId, rows] of groups) {
    html += `<section><h2>${esc(clientId)}</h2><ul>`;
    for (const r of rows) {
      const desc = r.description ? ` &mdash; <span class="d">${esc(r.description)}</span>` : "";
      html += `<li><a href="/${esc(r.id)}">${esc(r.title)}</a>${desc}</li>`;
    }
    html += `</ul></section>`;
  }
  return html;
}

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

// --- Homepage index: scoped to the viewer's org (behind Cloudflare Access) ---
app.get("/", async (req, res) => {
  const viewer = await resolveViewer(req);
  res.set("content-type", "text/html; charset=utf-8");

  if (!viewer.email) {
    return res.status(403).send(page("Artifacts", `<h1>Artifacts</h1><p class="empty">Not signed in.</p>`));
  }

  let body = `<h1>Artifacts</h1><p class="sub">Signed in as ${esc(viewer.email)}</p>`;

  if (viewer.isAdmin) {
    const byOrg = listAllGroupedByOrg();
    if (byOrg.size === 0) body += `<p class="empty">No artifacts published yet.</p>`;
    for (const [org, rows] of byOrg) {
      body += `<h2>org: ${esc(org)}</h2>`;
      const byClient = new Map();
      for (const r of rows) {
        if (!byClient.has(r.client_id)) byClient.set(r.client_id, []);
        byClient.get(r.client_id).push(r);
      }
      for (const [clientId, crows] of byClient) {
        body += `<h3>${esc(clientId)}</h3><ul>`;
        for (const r of crows) {
          const desc = r.description ? ` &mdash; <span class="d">${esc(r.description)}</span>` : "";
          body += `<li><a href="/${esc(r.id)}">${esc(r.title)}</a>${desc}</li>`;
        }
        body += `</ul>`;
      }
    }
  } else if (viewer.org) {
    const groups = listOrgGroupedByClient(viewer.org);
    body += groups.size === 0 ? `<p class="empty">No artifacts for your organization yet.</p>` : renderClientGroups(groups);
  } else {
    body += `<p class="empty">Your account isn't mapped to an organization. Contact the owner.</p>`;
  }

  res.send(page("Artifacts · neilblackman.dev", body));
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

app.listen(PORT, () => console.log(`[artifact-mcp] listening on :${PORT}`));
