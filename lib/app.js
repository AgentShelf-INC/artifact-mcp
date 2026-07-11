import express from "express";
import { adminAccess, artifactAccess } from "./access.js";
import { rawArtifactHeaders } from "./artifact-http.js";
import { parseReactionInput } from "./contracts.js";

function jsonError(res, decision, fallback) {
  return res.status(decision.status).json({ error: fallback || decision.error });
}

export function createApp({
  checkPublisherKey,
  handleMcp,
  resolveViewer,
  artifacts,
  keys,
  reactions,
  feedback,
  pages,
  logger = console,
  healthCheck = () => ({ status: "ok" }),
  limits = {}
}) {
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => {
    try {
      return res.json(healthCheck());
    } catch (error) {
      logger.error?.("[artifact-mcp] health check failed", error);
      return res.status(503).json({ status: "error" });
    }
  });

  app.post("/mcp", express.json({ limit: limits.mcpJson || "8mb" }), async (req, res) => {
    const auth = checkPublisherKey(req);
    if (!auth.ok) {
      return res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } });
    }
    try {
      const output = await handleMcp(req.body, { clientId: auth.clientId, org: auth.org, label: auth.label });
      if (!output) return res.status(202).end();
      return res.json(output);
    } catch (error) {
      return res.status(400).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: String(error.message || error) }
      });
    }
  });

  app.options("/mcp", (_req, res) =>
    res.set({ "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" }).status(204).end()
  );

  app.get("/", async (req, res) => {
    const viewer = await resolveViewer(req);
    res.set("content-type", "text/html; charset=utf-8");
    if (!viewer.email) {
      return res.status(403).send(
        '<!doctype html><meta charset="utf-8"><title>Artifacts</title><body style="font:16px system-ui;margin:4rem auto;max-width:40rem;padding:0 1.25rem"><h1>Artifacts</h1><p style="opacity:.6">Not signed in.</p></body>'
      );
    }

    let sections;
    if (viewer.isAdmin) {
      sections = [...artifacts.listAllGroupedByOrg().entries()].map(([org, items]) => ({ org, items }));
    } else if (viewer.org) {
      sections = [{ org: viewer.org, items: artifacts.listOrgArtifacts(viewer.org) }];
    } else {
      sections = [];
    }
    return res.send(pages.gallery(
      viewer,
      sections,
      reactions.forViewer(viewer.email),
      viewer.isAdmin ? reactions.sentiment() : new Map()
    ));
  });

  app.get("/settings", async (req, res) => {
    const viewer = await resolveViewer(req);
    const decision = adminAccess(viewer);
    if (!decision.ok) return res.status(decision.status).send(decision.error);
    const entries = keys.list();
    const orgs = [...new Set(entries.map((entry) => entry.org))];
    return res.set("content-type", "text/html; charset=utf-8").send(pages.settings(viewer, entries, orgs));
  });

  app.post("/settings/keys", express.json({ limit: limits.keyJson || "64kb" }), async (req, res) => {
    const viewer = await resolveViewer(req);
    const decision = adminAccess(viewer);
    if (!decision.ok) return jsonError(res, decision);
    try {
      const { clientId, org, label, secret } = keys.create({
        clientId: req.body?.clientId,
        org: req.body?.org,
        label: req.body?.label
      });
      logger.info?.(`[artifact-mcp] key created ${clientId} (org=${org}) by ${viewer.email}`);
      return res.json({ clientId, org, label, secret, created_at: new Date().toISOString() });
    } catch (error) {
      return res.status(400).json({ error: String(error.message || error) });
    }
  });

  app.post("/settings/keys/:id/revoke", async (req, res) => {
    const viewer = await resolveViewer(req);
    const decision = adminAccess(viewer);
    if (!decision.ok) return jsonError(res, decision);
    const revoked = keys.revoke(req.params.id);
    logger.info?.(`[artifact-mcp] key revoke ${req.params.id} by ${viewer.email} -> ${revoked}`);
    return res.json({ id: req.params.id, revoked });
  });

  app.get("/raw/:id/*", async (req, res) => {
    const id = req.params.id;
    if (artifacts.isReserved?.(id)) return res.status(404).send(pages.notFound());
    const meta = artifacts.getArtifactMeta(id);
    if (!meta || !meta.is_bundle) return res.status(404).send(pages.notFound());
    const viewer = await resolveViewer(req);
    const decision = artifactAccess(viewer, meta, { conceal: true });
    if (!decision.ok) return res.status(404).send(pages.notFound());
    const file = artifacts.readBundleFile(id, req.params[0] || "");
    if (!file) return res.status(404).send(pages.notFound());
    return res.set(rawArtifactHeaders(file.contentType)).send(file.content);
  });

  app.get("/raw/:id", async (req, res) => {
    const id = req.params.id;
    if (artifacts.isReserved?.(id)) return res.status(404).send(pages.notFound());
    const meta = artifacts.getArtifactMeta(id);
    if (!meta) return res.status(404).send(pages.notFound());
    const viewer = await resolveViewer(req);
    const decision = artifactAccess(viewer, meta, { conceal: true });
    if (!decision.ok) return res.status(404).send(pages.notFound());
    if (meta.is_bundle) return res.redirect(302, `/raw/${id}/`);
    const found = artifacts.readArtifact(id);
    if (!found) return res.status(404).send(pages.notFound());

    let downloadName;
    if (req.query.download !== undefined) {
      const name = (meta.title || "artifact").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "artifact";
      downloadName = `${name}.html`;
    }
    return res.set(rawArtifactHeaders("text/html; charset=utf-8", { downloadName })).send(found.html);
  });

  app.get("/:id", async (req, res) => {
    const id = req.params.id;
    if (artifacts.isReserved?.(id)) return res.status(404).send(pages.notFound());
    const meta = artifacts.getArtifactMeta(id);
    if (!meta) return res.status(404).send(pages.notFound());
    const viewer = await resolveViewer(req);
    const decision = artifactAccess(viewer, meta, { conceal: true });
    if (!decision.ok) return res.status(404).send(pages.notFound());

    const ids = artifacts.listOrgIds(meta.org);
    const index = ids.indexOf(id);
    const nav = {
      prevId: index > 0 ? ids[index - 1] : null,
      nextId: index >= 0 && index < ids.length - 1 ? ids[index + 1] : null,
      index: index >= 0 ? index + 1 : 1,
      total: ids.length || 1
    };
    return res.set("content-type", "text/html; charset=utf-8")
      .send(pages.shell(meta, nav, reactions.get(viewer.email, id), feedback.listForArtifact(id)));
  });

  app.delete("/:id", async (req, res) => {
    const id = req.params.id;
    if (artifacts.isReserved?.(id)) return res.status(404).json({ error: "Not found" });
    const meta = artifacts.getArtifactMeta(id);
    if (!meta) return res.status(404).json({ error: "Not found" });
    const viewer = await resolveViewer(req);
    const decision = artifactAccess(viewer, meta);
    if (!decision.ok) {
      const message = decision.status === 403 ? "You can only delete artifacts in your own org" : decision.error;
      return jsonError(res, decision, message);
    }
    const deleted = artifacts.deleteArtifactById(id);
    logger.info?.(`[artifact-mcp] delete ${id} (org=${meta.org}) by ${viewer.email} -> ${deleted}`);
    return res.json({ id, deleted });
  });

  app.post("/:id/react", express.json({ limit: limits.reactionJson || "8kb" }), async (req, res) => {
    const id = req.params.id;
    if (artifacts.isReserved?.(id)) return res.status(404).json({ error: "Not found" });
    const meta = artifacts.getArtifactMeta(id);
    if (!meta) return res.status(404).json({ error: "Not found" });
    const viewer = await resolveViewer(req);
    const decision = artifactAccess(viewer, meta);
    if (!decision.ok) return jsonError(res, decision);
    try {
      return res.json(reactions.set(viewer.email, id, parseReactionInput(req.body)));
    } catch (error) {
      return res.status(400).json({ error: String(error.message || error) });
    }
  });

  app.post("/:id/feedback", express.json({ limit: limits.feedbackJson || "16kb" }), async (req, res) => {
    const id = req.params.id;
    if (artifacts.isReserved?.(id)) return res.status(404).json({ error: "Not found" });
    const meta = artifacts.getArtifactMeta(id);
    if (!meta) return res.status(404).json({ error: "Not found" });
    const viewer = await resolveViewer(req);
    const decision = artifactAccess(viewer, meta);
    if (!decision.ok) return jsonError(res, decision);
    try {
      const created = feedback.add({
        artifactId: id,
        org: meta.org,
        viewerEmail: viewer.email,
        body: req.body?.body,
        artifactRevision: meta.revision
      });
      logger.info?.(`[artifact-mcp] feedback ${created.id} on ${id} (org=${meta.org}) by ${viewer.email}`);
      return res.json({
        id: created.id,
        artifact_id: id,
        viewer_email: created.viewer_email,
        body: created.body,
        created_at: created.created_at
      });
    } catch (error) {
      return res.status(400).json({ error: String(error.message || error) });
    }
  });

  return app;
}
