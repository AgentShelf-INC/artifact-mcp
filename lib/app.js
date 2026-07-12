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
  orgs,
  webhooks = { listForOrg: () => [], create: () => undefined, remove: () => false, setEvents: () => undefined, get: () => undefined },
  notify = { emit() {}, test: async () => ({ ok: false, error: "Notifications are unavailable." }) },
  reactions,
  views = { record() {}, countsFor: () => null, countsForOrg: () => new Map(), viewersFor: () => [], topForOrg: () => [] },
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
      sections = [...artifacts.listAllGroupedByOrg({ includeHidden: true }).entries()].map(([org, items]) => ({ org, items }));
    } else if (viewer.org) {
      sections = [{ org: viewer.org, items: artifacts.listOrgArtifacts(viewer.org) }];
    } else {
      sections = [];
    }
    const viewCounts = new Map();
    const topViewed = new Map();
    for (const { org } of sections) {
      try {
        for (const [id, counts] of views.countsForOrg(org)) viewCounts.set(id, counts);
        if (viewer.isAdmin) topViewed.set(org, views.topForOrg(org));
      } catch (error) {
        logger.error?.("[artifact-mcp] view analytics gallery read failed", error);
      }
    }
    return res.send(pages.gallery(
      viewer,
      sections,
      reactions.forViewer(viewer.email),
      viewer.isAdmin ? reactions.sentiment() : new Map(),
      viewCounts,
      topViewed
    ));
  });

  app.get("/settings", async (req, res) => {
    const viewer = await resolveViewer(req);
    const decision = adminAccess(viewer);
    if (!decision.ok) return res.status(decision.status).send(decision.error);
    const entries = keys.list();
    const orgList = orgs.list().map((org) => ({ ...org, webhooks: webhooks.listForOrg(org.name) }));
    return res.set("content-type", "text/html; charset=utf-8").send(pages.settings(viewer, entries, orgList));
  });

  app.post("/settings/keys", express.json({ limit: limits.keyJson || "64kb" }), async (req, res) => {
    const viewer = await resolveViewer(req);
    const decision = adminAccess(viewer);
    if (!decision.ok) return jsonError(res, decision);
    const targetOrg = String(req.body?.org || "").trim();
    if (!orgs.has(targetOrg)) {
      return res.status(400).json({ error: `Unknown organization "${targetOrg}". Create it in the Organizations section first.` });
    }
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

  // --- Organization registry (admin only) ---------------------------------------------
  async function requireAdmin(req, res) {
    const viewer = await resolveViewer(req);
    const decision = adminAccess(viewer);
    if (!decision.ok) {
      jsonError(res, decision);
      return null;
    }
    return viewer;
  }

  app.post("/settings/orgs", express.json({ limit: limits.keyJson || "64kb" }), async (req, res) => {
    const viewer = await requireAdmin(req, res);
    if (!viewer) return;
    try {
      const org = orgs.create({ name: req.body?.name, label: req.body?.label, domain: req.body?.domain });
      logger.info?.(`[artifact-mcp] org created ${org.name} by ${viewer.email}`);
      return res.json(org);
    } catch (error) {
      return res.status(400).json({ error: String(error.message || error) });
    }
  });

  app.delete("/settings/orgs/:name", async (req, res) => {
    const viewer = await requireAdmin(req, res);
    if (!viewer) return;
    const removed = orgs.remove(req.params.name);
    logger.info?.(`[artifact-mcp] org delete ${req.params.name} by ${viewer.email} -> ${removed}`);
    return res.json({ name: req.params.name, removed });
  });

  app.post("/settings/orgs/:name/domains", express.json({ limit: limits.keyJson || "64kb" }), async (req, res) => {
    const viewer = await requireAdmin(req, res);
    if (!viewer) return;
    try {
      const result = orgs.addDomain(req.params.name, req.body?.domain);
      logger.info?.(`[artifact-mcp] domain +${result.domain} -> ${result.org} by ${viewer.email}`);
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: String(error.message || error) });
    }
  });

  app.delete("/settings/orgs/:name/domains/:domain", async (req, res) => {
    const viewer = await requireAdmin(req, res);
    if (!viewer) return;
    const removed = orgs.removeDomain(req.params.name, req.params.domain);
    return res.json({ org: req.params.name, domain: req.params.domain, removed });
  });

  app.post("/settings/orgs/:name/categories", express.json({ limit: limits.keyJson || "64kb" }), async (req, res) => {
    const viewer = await requireAdmin(req, res);
    if (!viewer) return;
    try {
      const result = orgs.addCategory(req.params.name, req.body?.name);
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: String(error.message || error) });
    }
  });

  app.delete("/settings/orgs/:name/categories", express.json({ limit: limits.keyJson || "64kb" }), async (req, res) => {
    const viewer = await requireAdmin(req, res);
    if (!viewer) return;
    const removed = orgs.removeCategory(req.params.name, req.body?.name);
    return res.json({ org: req.params.name, name: req.body?.name, removed });
  });

  app.post("/settings/orgs/:name/webhooks", express.json({ limit: limits.keyJson || "64kb" }), async (req, res) => {
    const viewer = await requireAdmin(req, res);
    if (!viewer) return;
    try {
      const webhook = webhooks.create({ org: req.params.name, url: req.body?.url, label: req.body?.label, events: req.body?.events });
      return res.json(webhook);
    } catch (error) {
      return res.status(400).json({ error: String(error.message || error) });
    }
  });

  app.delete("/settings/orgs/:name/webhooks/:id", async (req, res) => {
    const viewer = await requireAdmin(req, res);
    if (!viewer) return;
    return res.json({ org: req.params.name, id: req.params.id, removed: webhooks.remove(req.params.name, req.params.id) });
  });

  app.patch("/settings/orgs/:name/webhooks/:id", express.json({ limit: limits.keyJson || "64kb" }), async (req, res) => {
    const viewer = await requireAdmin(req, res);
    if (!viewer) return;
    try {
      const webhook = webhooks.setEvents(req.params.name, req.params.id, req.body?.events);
      if (!webhook) return res.status(404).json({ error: "Webhook not found" });
      return res.json(webhook);
    } catch (error) {
      return res.status(400).json({ error: String(error.message || error) });
    }
  });

  app.post("/settings/orgs/:name/webhooks/:id/test", async (req, res) => {
    const viewer = await requireAdmin(req, res);
    if (!viewer) return;
    const webhook = webhooks.get(req.params.id);
    if (!webhook || webhook.org !== req.params.name) return res.status(404).json({ error: "Webhook not found" });
    const result = await notify.test(webhook);
    return res.json(result);
  });

  // Past-revision raw delivery (version history). Registered BEFORE /raw/:id/* so the
  // /rev/:n path is not swallowed by the bundle wildcard.
  async function rawAccessOr404(req, res) {
    const id = req.params.id;
    if (artifacts.isReserved?.(id)) { res.status(404).send(pages.notFound()); return null; }
    const meta = artifacts.getArtifactMeta(id);
    if (!meta) { res.status(404).send(pages.notFound()); return null; }
    const viewer = await resolveViewer(req);
    const decision = artifactAccess(viewer, meta, { conceal: true });
    if (!decision.ok) { res.status(404).send(pages.notFound()); return null; }
    return meta;
  }

  app.get("/raw/:id/rev/:n/*", async (req, res) => {
    const meta = await rawAccessOr404(req, res);
    if (!meta) return;
    const file = artifacts.readHistoryBundleFile(req.params.id, req.params.n, req.params[0] || "");
    if (!file) return res.status(404).send(pages.notFound());
    return res.set(rawArtifactHeaders(file.contentType)).send(file.content);
  });

  app.get("/raw/:id/rev/:n", async (req, res) => {
    const meta = await rawAccessOr404(req, res);
    if (!meta) return;
    const rev = Number(req.params.n);
    if (meta.is_bundle) return res.redirect(302, `/raw/${req.params.id}/rev/${rev}/`);
    const found = artifacts.readHistoryArtifact(req.params.id, rev);
    if (!found) return res.status(404).send(pages.notFound());
    return res.set(rawArtifactHeaders("text/html; charset=utf-8")).send(found.html);
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

    // Shell renders are the single attribution point; raw iframe/subresource requests
    // intentionally bypass analytics so they cannot double-count a visit.
    if (!viewer.isAdmin && viewer.email) {
      try {
        views.record(id, meta.org, viewer.email);
      } catch (error) {
        logger.error?.("[artifact-mcp] view analytics record failed", error);
      }
    }

    let counts = null;
    let viewers = null;
    try {
      counts = views.countsFor(id);
      if (viewer.isAdmin) viewers = views.viewersFor(id);
    } catch (error) {
      logger.error?.("[artifact-mcp] view analytics shell read failed", error);
    }

    const ids = artifacts.listOrgIds(meta.org, { includeHidden: viewer.isAdmin });
    const index = ids.indexOf(id);
    const nav = {
      prevId: index > 0 ? ids[index - 1] : null,
      nextId: index >= 0 && index < ids.length - 1 ? ids[index + 1] : null,
      index: index >= 0 ? index + 1 : 1,
      total: ids.length || 1
    };
    return res.set("content-type", "text/html; charset=utf-8")
      .send(pages.shell(meta, nav, reactions.get(viewer.email, id), feedback.listForArtifact(id), { counts, viewers }));
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
    if (deleted) notify.emit("deleted", meta.org, artifactPayload(meta));
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
      notify.emit("feedback", meta.org, {
        ...artifactPayload(meta), viewerEmail: viewer.email, body: created.body
      });
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

  app.post("/:id/category", express.json({ limit: limits.categoryJson || "8kb" }), async (req, res) => {
    const id = req.params.id;
    if (artifacts.isReserved?.(id)) return res.status(404).json({ error: "Not found" });
    const meta = artifacts.getArtifactMeta(id);
    if (!meta) return res.status(404).json({ error: "Not found" });
    const viewer = await resolveViewer(req);
    const decision = artifactAccess(viewer, meta);
    if (!decision.ok) return jsonError(res, decision);
    const result = artifacts.setCategory(id, req.body?.category);
    logger.info?.(`[artifact-mcp] category ${id} -> "${result.category}" by ${viewer.email}`);
    return res.json({ id, category: result.category });
  });

  app.post("/:id/visibility", express.json({ limit: limits.categoryJson || "8kb" }), async (req, res) => {
    const id = req.params.id;
    if (artifacts.isReserved?.(id)) return res.status(404).json({ error: "Not found" });
    const meta = artifacts.getArtifactMeta(id);
    if (!meta) return res.status(404).json({ error: "Not found" });
    const viewer = await resolveViewer(req);
    const decision = artifactAccess(viewer, meta);
    if (!decision.ok) return jsonError(res, decision);
    if (typeof req.body?.hidden !== "boolean") return res.status(400).json({ error: "hidden must be a boolean" });
    const result = artifacts.setHidden(id, req.body.hidden);
    logger.info?.(`[artifact-mcp] visibility ${id} -> ${result.hidden ? "hidden" : "visible"} by ${viewer.email}`);
    return res.json({ id, hidden: result.hidden });
  });

  app.post("/:id/move", express.json({ limit: limits.categoryJson || "8kb" }), async (req, res) => {
    const id = req.params.id;
    if (artifacts.isReserved?.(id)) return res.status(404).json({ error: "Not found" });
    const meta = artifacts.getArtifactMeta(id);
    if (!meta) return res.status(404).json({ error: "Not found" });
    const viewer = await resolveViewer(req);
    const decision = adminAccess(viewer);
    if (!decision.ok) return jsonError(res, decision);
    try {
      const result = req.body?.org !== undefined
        ? artifacts.moveArtifactToOrg(id, req.body.org, req.body.category)
        : artifacts.setCategory(id, req.body?.category);
      if (!result.ok) return res.status(404).json({ error: "Not found" });
      const current = artifacts.getArtifactMeta(id);
      logger.info?.(`[artifact-mcp] move ${id} -> ${current.org}/${current.category} by ${viewer.email}`);
      return res.json({ id, org: current.org, category: current.category });
    } catch (error) {
      return res.status(400).json({ error: String(error.message || error) });
    }
  });

  app.get("/:id/history", async (req, res) => {
    const id = req.params.id;
    if (artifacts.isReserved?.(id)) return res.status(404).json({ error: "Not found" });
    const meta = artifacts.getArtifactMeta(id);
    if (!meta) return res.status(404).json({ error: "Not found" });
    const viewer = await resolveViewer(req);
    const decision = artifactAccess(viewer, meta, { conceal: true });
    if (!decision.ok) return res.status(404).json({ error: "Not found" });
    return res.json(artifacts.listRevisions(id) || { current: meta.revision, revisions: [] });
  });

  app.post("/:id/restore", express.json({ limit: limits.categoryJson || "8kb" }), async (req, res) => {
    const id = req.params.id;
    if (artifacts.isReserved?.(id)) return res.status(404).json({ error: "Not found" });
    const meta = artifacts.getArtifactMeta(id);
    if (!meta) return res.status(404).json({ error: "Not found" });
    const viewer = await resolveViewer(req);
    const decision = artifactAccess(viewer, meta);
    if (!decision.ok) return jsonError(res, decision);
    const revision = Number(req.body?.revision);
    if (!Number.isInteger(revision) || revision < 1) {
      return res.status(400).json({ error: "revision must be a positive integer" });
    }
    const result = artifacts.restoreArtifactRevision(id, revision);
    if (!result.ok) {
      const status = { not_found: 404, revision_not_found: 404, body_missing: 410, type_mismatch: 409 }[result.reason] || 400;
      return res.status(status).json({ error: result.reason || "restore failed" });
    }
    logger.info?.(`[artifact-mcp] restore ${id} -> rev ${result.revision} (from ${result.restoredFrom}) by ${viewer.email}`);
    const updatedMeta = artifacts.getArtifactMeta(id) || { ...meta, revision: result.revision, bytes: result.bytes };
    notify.emit("restored", meta.org, artifactPayload(updatedMeta));
    return res.json({ id, revision: result.revision, restoredFrom: result.restoredFrom });
  });

  return app;
}

function artifactPayload(meta) {
  return {
    title: meta.title,
    url: `${process.env.PUBLIC_BASE_URL || "https://artifact.neilblackman.dev"}/${meta.id}`,
    description: meta.description,
    uploaderLabel: meta.uploader_label,
    category: meta.category,
    revision: meta.revision,
    bytes: meta.bytes
  };
}
