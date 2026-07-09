import express from "express";
import { seedKeysFromEnv } from "./lib/db.js";
import { sha256Hex, checkKey } from "./lib/auth.js";
import { handleMcp } from "./lib/mcp.js";
import { readArtifact, listGroupedByClient, isReserved } from "./lib/store.js";

const PORT = Number(process.env.PORT || 3480);

const seeded = seedKeysFromEnv(sha256Hex);
console.log(`[artifact-mcp] seeded ${seeded} key(s) from env`);

const app = express();
app.disable("x-powered-by");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// --- MCP upload endpoint (API-key auth; Cloudflare Access bypasses this path) ---
app.post("/mcp", express.json({ limit: "8mb" }), async (req, res) => {
  const auth = checkKey(req);
  if (!auth.ok) {
    return res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } });
  }
  try {
    const out = await handleMcp(req.body, auth.clientId);
    if (!out) return res.status(202).end();
    return res.json(out);
  } catch (err) {
    return res
      .status(400)
      .json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: String(err.message || err) } });
  }
});
app.options("/mcp", (_req, res) => res.set({ "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" }).status(204).end());

// --- Homepage index: artifacts grouped by uploader (behind Cloudflare Access) ---
app.get("/", (_req, res) => {
  const groups = listGroupedByClient();
  let body = "";
  if (groups.size === 0) {
    body = `<p class="empty">No artifacts published yet.</p>`;
  } else {
    for (const [clientId, rows] of groups) {
      body += `<section><h2>${esc(clientId)}</h2><ul>`;
      for (const r of rows) {
        const desc = r.description ? ` &mdash; ${esc(r.description)}` : "";
        body += `<li><a href="/${esc(r.id)}">${esc(r.title)}</a><span class="d">${desc}</span></li>`;
      }
      body += `</ul></section>`;
    }
  }
  res.set("content-type", "text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Artifacts &middot; neilblackman.dev</title>
<style>
:root{color-scheme:light dark}
body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:3rem auto;padding:0 1.25rem}
h1{font-size:1.6rem;margin:0 0 .25rem} .sub{opacity:.6;margin:0 0 2rem}
h2{font-size:1rem;text-transform:uppercase;letter-spacing:.05em;opacity:.7;margin:2rem 0 .5rem;border-bottom:1px solid #8884;padding-bottom:.3rem}
ul{list-style:none;padding:0;margin:0} li{padding:.35rem 0}
a{font-weight:600;text-decoration:none;color:#3b82f6} a:hover{text-decoration:underline}
.d{opacity:.65} .empty{opacity:.6}
</style></head><body>
<h1>Artifacts</h1><p class="sub">Hosted at artifact.neilblackman.dev</p>
${body}
</body></html>`);
});

// --- Serve a published artifact by id (behind Cloudflare Access) ---
app.get("/:id", (req, res) => {
  const id = req.params.id;
  if (isReserved(id)) return res.status(404).send("Not found");
  const found = readArtifact(id);
  if (!found) return res.status(404).send("Not found");
  res
    .set({
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "public, max-age=300"
    })
    .send(found.html);
});

app.listen(PORT, () => console.log(`[artifact-mcp] listening on :${PORT}`));
