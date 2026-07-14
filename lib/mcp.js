// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
// Direct streamable-HTTP MCP (JSON-RPC over POST). A minimal compliant JSON-RPC server (no SDK transport):
// Express exposes plain req/res, so a minimal compliant JSON-RPC server is
// simpler and more robust than bridging the SDK transport.
import { publish, publishBundle, update, restore, listRevisions, listForClient, remove, getArtifactMeta, setHidden, setCategory } from "./store.js";
import { categoriesFor as orgCategoriesFor, addCategory as orgAddCategory, removeCategory as orgRemoveCategory, orgExists } from "./orgs.js";
import {
  listForClient as feedbackForClient,
  listAll as feedbackListAll,
  getFeedback,
  resolveFeedback,
  reopenFeedback
} from "./feedback.js";
import { validateSchemaInput } from "./contracts.js";
import { emit as defaultNotify } from "./notify.js";
import { countsFor as viewCountsFor, viewersFor as viewViewersFor } from "./views.js";
import * as shares from "./shares.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "artifact-mcp", version: "1.3.0" };

const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || "http://localhost:3480";

export const TOOL_DEFS = [
  {
    name: "publish_artifact",
    description:
      "Publish a self-contained HTML document. Returns a public URL that renders it at your configured domain, /<id>. Provide a title and a short description for the artifact index.",
    inputSchema: {
      type: "object",
      properties: {
        html: { type: "string", description: "Full self-contained HTML document to host." },
        title: { type: "string", description: "Short title shown on the artifact index." },
        description: { type: "string", description: "One-line description shown next to the link on the index." },
        category: { type: "string", description: "Optional category to group the artifact within its org (e.g. 'Dashboards'). Blank = Uncategorized." },
        org: { type: "string", description: "Target org (admin keys only; org keys are locked to their own org)." }
      },
      required: ["html"],
      additionalProperties: false
    }
  },
  {
    name: "publish_bundle",
    description:
      "Publish a multi-file artifact (e.g. several HTML pages that link to each other and a shared stylesheet). Provide files as a map of relative-path -> file contents; relative links between files resolve. Returns a public URL. Use this instead of publish_artifact when the HTML references other files like _shared.css or additional pages.",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "object",
          description: "Map of relative path to file contents, e.g. {\"index.html\":\"...\",\"_shared.css\":\"...\"}. Paths are relative; no leading slash or '..'.",
          additionalProperties: { type: "string" }
        },
        entry: { type: "string", description: "The HTML file to open first. Defaults to index.html, or the first .html file." },
        title: { type: "string", description: "Short title shown on the artifact index." },
        description: { type: "string", description: "One-line description shown on the index." },
        category: { type: "string", description: "Optional category to group the artifact within its org. Blank = Uncategorized." },
        org: { type: "string", description: "Target org (admin keys only)." }
      },
      required: ["files"],
      additionalProperties: false
    }
  },
  {
    name: "list_artifacts",
    description: "List the artifacts you (this API key) have published, with their URLs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "delete_artifact",
    description: "Delete one of your artifacts by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Artifact id to delete." } },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "update_artifact",
    description:
      "Replace an existing artifact's content and/or metadata in place, keeping the SAME id and URL so existing links keep working. Pass `html` for a single-file artifact or `files` for a bundle — the artifact type cannot change. Omitted title/description are preserved. Each update increments the artifact's revision.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Artifact id to update." },
        html: { type: "string", description: "New HTML for a single-file artifact." },
        files: {
          type: "object",
          description: "New complete bundle snapshot (relative path -> content) for a bundle artifact; omitted files are removed.",
          additionalProperties: { type: "string" }
        },
        entry: { type: "string", description: "Entry file for a bundle (defaults to the current entry, then index.html)." },
        title: { type: "string", description: "New title (omit to keep the current one)." },
        description: { type: "string", description: "New description (omit to keep current; empty string clears it)." },
        category: { type: "string", description: "New category (omit to keep current; empty string moves it to Uncategorized)." }
      },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "set_visibility",
    description: "Unlist or relist one of your artifacts. Hidden artifacts remain accessible by direct URL to organization members; this is not access control.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Artifact id." },
        hidden: { type: "boolean", description: "True unlists it from the gallery; false relists it." }
      },
      required: ["id", "hidden"],
      additionalProperties: false
    }
  },
  {
    name: "list_categories",
    description: "List the categories registered for your organization (used to group artifacts in the gallery). Admin keys may pass an org.",
    inputSchema: {
      type: "object",
      properties: { org: { type: "string", description: "Org to list (admin keys only; defaults to your org)." } },
      additionalProperties: false
    }
  },
  {
    name: "set_category",
    description: "Move one of your artifacts into a category (empty string = Uncategorized). Also adds the category to your org's list so it appears in the picker. Does NOT create a new revision.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Artifact id." },
        category: { type: "string", description: "Target category; empty string moves it to Uncategorized." }
      },
      required: ["id", "category"],
      additionalProperties: false
    }
  },
  {
    name: "create_category",
    description: "Add a category to your organization's category list. Admin keys may pass an org.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Category name." },
        org: { type: "string", description: "Org (admin keys only; defaults to your org)." }
      },
      required: ["name"],
      additionalProperties: false
    }
  },
  {
    name: "delete_category",
    description: "Remove a category from your organization's category list. Artifacts already tagged with it keep their tag. Admin keys may pass an org.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Category name to remove." },
        org: { type: "string", description: "Org (admin keys only; defaults to your org)." }
      },
      required: ["name"],
      additionalProperties: false
    }
  },
  {
    name: "list_revisions",
    description:
      "List the version history of one of your artifacts — each retained revision's number, title, size, and timestamp. Use with restore_artifact to roll back.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Artifact id." } },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "create_share",
    description: "Create an unlisted public, read-only share link for one of your artifacts. It serves the live artifact until it expires or is revoked.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Artifact id." },
        expires: { type: "string", description: "'24h', 'never', or a future ISO date." }
      },
      required: ["id", "expires"],
      additionalProperties: false
    }
  },
  {
    name: "list_shares",
    description: "List active public share links for one of your artifacts.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Artifact id." } },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "revoke_share",
    description: "Revoke an active public share link you own. Revocation takes effect immediately.",
    inputSchema: {
      type: "object",
      properties: { token: { type: "string", description: "Share token returned by create_share or list_shares." } },
      required: ["token"],
      additionalProperties: false
    }
  },
  {
    name: "artifact_stats",
    description: "Get named audience-view analytics for one of your artifacts: total views, unique viewers, last viewed time, and each viewer's count and timestamps.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Artifact id." } },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "restore_artifact",
    description:
      "Restore a past revision of your artifact by number. Its content is re-published as a NEW revision at the same id/URL, so nothing is lost and the restore is itself undoable. Get revision numbers from list_revisions.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Artifact id." },
        revision: { type: "number", description: "Revision number to restore (from list_revisions)." }
      },
      required: ["id", "revision"],
      additionalProperties: false
    }
  },
  {
    name: "list_feedback",
    description: "List viewer feedback left on your artifacts. Pass an artifact id to scope to one; omit to list across all of your artifacts.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Optional artifact id to scope the feedback to." } },
      additionalProperties: false
    }
  },
  {
    name: "resolve_feedback",
    description: "Mark a piece of viewer feedback as resolved once you've addressed it.",
    inputSchema: {
      type: "object",
      properties: { feedback_id: { type: "string", description: "Feedback id to resolve." } },
      required: ["feedback_id"],
      additionalProperties: false
    }
  },
  {
    name: "reopen_feedback",
    description: "Reopen previously resolved viewer feedback when more work is needed.",
    inputSchema: {
      type: "object",
      properties: { feedback_id: { type: "string", description: "Feedback id to reopen." } },
      required: ["feedback_id"],
      additionalProperties: false
    }
  }
];

function feedbackJson(f) {
  return {
    id: f.id,
    artifact_id: f.artifact_id,
    parent_id: f.parent_id,
    viewer_email: f.viewer_email,
    body: f.body,
    artifact_revision: f.artifact_revision,
    anchor_path: f.anchor_path,
    anchor_x: f.anchor_x,
    anchor_y: f.anchor_y,
    anchor_w: f.anchor_w,
    anchor_h: f.anchor_h,
    anchor_approx: f.anchor_approx,
    anchor_page: f.anchor_page,
    created_at: f.created_at,
    resolved_at: f.resolved_at,
    resolved_by: f.resolved_by
  };
}

function urlFor(id) {
  return `${PUBLIC_BASE}/${id}`;
}

function artifactPayload(meta) {
  return {
    title: meta.title,
    url: urlFor(meta.id),
    description: meta.description,
    uploaderLabel: meta.uploader_label,
    category: meta.category,
    revision: meta.revision,
    bytes: meta.bytes
  };
}

function toolResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }], structuredContent: obj };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function callTool(params, auth, notify = defaultNotify) {
  const name = params?.name;
  const definition = TOOL_DEFS.find((tool) => tool.name === name);
  if (!definition) {
    throw Object.assign(new Error(`Unknown tool: ${name}`), { rpcCode: -32602 });
  }
  const args = params?.arguments === undefined ? {} : params.arguments;
  const inputErrors = validateSchemaInput(definition.inputSchema, args);
  if (inputErrors.length) {
    throw Object.assign(new Error(`Invalid arguments: ${inputErrors.join("; ")}`), { rpcCode: -32602 });
  }
  const clientId = auth.clientId;
  // A non-admin key may only act on an artifact it published AND that still lives in its own
  // org — so control does not follow an artifact after an admin re-tenants it (org move keeps
  // client_id, which must NOT by itself re-grant the original tenant access to the new org).
  const owns = (meta) => auth.org === "admin" || (!!meta && meta.client_id === clientId && meta.org === auth.org);

  if (name === "publish_artifact") {
    // Org is fixed by the key, except an 'admin' key may target any org explicitly.
    const org =
      auth.org === "admin" && typeof args.org === "string" && args.org.trim()
        ? args.org.trim()
        : auth.org;
    const { id, bytes } = publish({
      clientId,
      org,
      uploaderLabel: auth.label || "",
      html: args.html,
      title: args.title,
      description: args.description,
      category: args.category
    });
    const meta = getArtifactMeta(id);
    if (meta) notify("published", meta.org, artifactPayload(meta), { artifactMeta: meta });
    return toolResult({ id, url: urlFor(id), org, bytes });
  }

  if (name === "publish_bundle") {
    const org =
      auth.org === "admin" && typeof args.org === "string" && args.org.trim() ? args.org.trim() : auth.org;
    const r = publishBundle({
      clientId,
      org,
      uploaderLabel: auth.label || "",
      files: args.files,
      entry: args.entry,
      title: args.title,
      description: args.description,
      category: args.category
    });
    const meta = getArtifactMeta(r.id);
    if (meta) notify("published", meta.org, artifactPayload(meta), { artifactMeta: meta });
    return toolResult({ id: r.id, url: urlFor(r.id), org, entry: r.entry, files: r.files, bytes: r.bytes });
  }

  if (name === "list_artifacts") {
    const rows = listForClient(clientId, auth.org === "admin" ? undefined : auth.org).map((r) => ({
      id: r.id,
      url: urlFor(r.id),
      title: r.title,
      description: r.description,
      created_at: r.created_at
    }));
    return toolResult({ count: rows.length, artifacts: rows });
  }

  if (name === "delete_artifact") {
    if (typeof args.id !== "string" || !args.id) {
      throw Object.assign(new Error("id is required"), { rpcCode: -32602 });
    }
    const meta = getArtifactMeta(args.id);
    if (meta && !owns(meta)) throw new Error("You can only delete your own artifacts");
    const ok = remove({ id: args.id, clientId, isAdmin: auth.org === "admin" });
    if (ok && meta) notify("deleted", meta.org, artifactPayload(meta));
    return toolResult({ id: args.id, deleted: ok });
  }

  if (name === "update_artifact") {
    if (typeof args.id !== "string" || !args.id) {
      throw Object.assign(new Error("id is required"), { rpcCode: -32602 });
    }
    const pre = getArtifactMeta(args.id);
    if (pre && !owns(pre)) throw new Error("You can only update your own artifacts");
    const result = update({
      id: args.id,
      clientId,
      isAdmin: auth.org === "admin",
      html: args.html,
      files: args.files,
      entry: args.entry,
      title: args.title,
      description: args.description,
      category: args.category
    });
    if (!result.ok) {
      throw new Error(result.reason === "not_found" ? `Unknown artifact: ${args.id}` : "You can only update your own artifacts");
    }
    const meta = getArtifactMeta(result.id);
    if (meta) notify("updated", meta.org, artifactPayload(meta), { artifactMeta: meta });
    return toolResult({ id: result.id, url: urlFor(result.id), revision: result.revision, bytes: result.bytes, entry: result.entry, category: result.category });
  }

  if (name === "set_visibility") {
    const meta = getArtifactMeta(args.id);
    if (!meta) throw new Error(`Unknown artifact: ${args.id}`);
    if (!owns(meta)) {
      throw new Error("You can only change visibility of your own artifacts");
    }
    const result = setHidden(args.id, args.hidden);
    return toolResult({ id: result.id, hidden: result.hidden });
  }

  if (name === "list_categories") {
    const targetOrg = auth.org === "admin" ? String(args.org || "").trim() : auth.org;
    if (!targetOrg) throw new Error("org is required for admin keys");
    return toolResult({ org: targetOrg, categories: orgCategoriesFor(targetOrg) });
  }

  if (name === "set_category") {
    const meta = getArtifactMeta(args.id);
    if (!meta) throw new Error(`Unknown artifact: ${args.id}`);
    if (!owns(meta)) throw new Error("You can only categorize your own artifacts");
    const result = setCategory(args.id, args.category);
    // Best-effort: register the normalized category on the org so it shows in the picker.
    if (result.category) { try { orgAddCategory(meta.org, result.category); } catch {} }
    return toolResult({ id: args.id, category: result.category });
  }

  if (name === "create_category") {
    const targetOrg = auth.org === "admin" ? String(args.org || "").trim() : auth.org;
    if (!targetOrg) throw new Error("org is required for admin keys");
    return toolResult(orgAddCategory(targetOrg, args.name));
  }

  if (name === "delete_category") {
    const targetOrg = auth.org === "admin" ? String(args.org || "").trim() : auth.org;
    if (!targetOrg) throw new Error("org is required for admin keys");
    return toolResult({ org: targetOrg, name: args.name, removed: orgRemoveCategory(targetOrg, args.name) });
  }

  if (name === "list_revisions") {
    if (typeof args.id !== "string" || !args.id) {
      throw Object.assign(new Error("id is required"), { rpcCode: -32602 });
    }
    const meta = getArtifactMeta(args.id);
    if (!meta) throw new Error(`Unknown artifact: ${args.id}`);
    if (!owns(meta)) {
      throw new Error("You can only view history of your own artifacts");
    }
    const history = listRevisions(args.id) || { current: meta.revision, revisions: [] };
    return toolResult({ id: args.id, current: history.current, revisions: history.revisions });
  }

  if (name === "create_share") {
    const meta = getArtifactMeta(args.id);
    if (!meta) throw new Error(`Unknown artifact: ${args.id}`);
    if (!owns(meta)) {
      throw new Error("You can only create shares for your own artifacts");
    }
    const share = shares.create({ artifactId: args.id, org: meta.org, createdBy: `agent:${clientId}`, expires: args.expires });
    return toolResult({ id: args.id, ...share, url: `${PUBLIC_BASE}/s/${share.token}` });
  }

  if (name === "list_shares") {
    const meta = getArtifactMeta(args.id);
    if (!meta) throw new Error(`Unknown artifact: ${args.id}`);
    if (!owns(meta)) {
      throw new Error("You can only list shares for your own artifacts");
    }
    return toolResult({ id: args.id, shares: shares.listForArtifact(args.id) });
  }

  if (name === "revoke_share") {
    // resolve intentionally yields null for unknown, expired, and revoked links, so this
    // management action does not turn a token probe into an oracle either.
    const share = shares.resolve(args.token);
    if (!share) throw new Error("Unknown share");
    const meta = getArtifactMeta(share.artifact_id);
    if (!meta || meta.org !== share.org) throw new Error("Unknown share");
    if (!owns(meta)) {
      throw new Error("You can only revoke shares for your own artifacts");
    }
    return toolResult({ token: args.token, revoked: shares.revoke(meta.id, args.token) });
  }

  if (name === "artifact_stats") {
    const meta = getArtifactMeta(args.id);
    if (!meta) throw new Error(`Unknown artifact: ${args.id}`);
    if (!owns(meta)) {
      throw new Error("You can only view analytics for your own artifacts");
    }
    return toolResult({ id: args.id, ...viewCountsFor(args.id), viewers: viewViewersFor(args.id) });
  }

  if (name === "restore_artifact") {
    if (typeof args.id !== "string" || !args.id) {
      throw Object.assign(new Error("id is required"), { rpcCode: -32602 });
    }
    const revision = Number(args.revision);
    if (!Number.isInteger(revision) || revision < 1) {
      throw Object.assign(new Error("revision must be a positive integer"), { rpcCode: -32602 });
    }
    const pre = getArtifactMeta(args.id);
    if (pre && !owns(pre)) throw new Error("You can only restore your own artifacts");
    const result = restore({ id: args.id, revision, clientId, isAdmin: auth.org === "admin" });
    if (!result.ok) {
      const msg =
        result.reason === "not_found" ? `Unknown artifact: ${args.id}`
          : result.reason === "forbidden" ? "You can only restore your own artifacts"
          : result.reason === "revision_not_found" ? `No such revision: ${revision}`
          : result.reason === "body_missing" ? `Revision ${revision} is no longer retained`
          : result.reason === "type_mismatch" ? "Revision type does not match the current artifact"
          : "Restore failed";
      throw new Error(msg);
    }
    const meta = getArtifactMeta(result.id);
    if (meta) notify("restored", meta.org, artifactPayload(meta), { artifactMeta: meta });
    return toolResult({ id: result.id, url: urlFor(result.id), revision: result.revision, restoredFrom: result.restoredFrom, bytes: result.bytes });
  }

  if (name === "list_feedback") {
    const isAdmin = auth.org === "admin";
    if (typeof args.id === "string" && args.id) {
      const meta = getArtifactMeta(args.id);
      if (!meta) throw new Error(`Unknown artifact: ${args.id}`);
      if (!owns(meta)) throw new Error("You can only read feedback on your own artifacts");
      const items = feedbackListAll(args.id).map(feedbackJson);
      return toolResult({ artifact_id: args.id, count: items.length, feedback: items });
    }
    const rows = isAdmin ? feedbackListAll() : feedbackForClient(clientId, undefined, auth.org);
    return toolResult({ count: rows.length, feedback: rows.map(feedbackJson) });
  }

  if (name === "resolve_feedback") {
    if (typeof args.feedback_id !== "string" || !args.feedback_id) {
      throw Object.assign(new Error("feedback_id is required"), { rpcCode: -32602 });
    }
    const fb = getFeedback(args.feedback_id);
    if (!fb) throw new Error(`Unknown feedback: ${args.feedback_id}`);
    const meta = getArtifactMeta(fb.artifact_id);
    if (!owns(meta)) {
      throw new Error("You can only resolve feedback on your own artifacts");
    }
    const resolved = resolveFeedback(args.feedback_id, `agent:${clientId}`);
    if (resolved && meta) notify("resolved", meta.org, {
      ...artifactPayload(meta),
      resolver: `agent:${clientId}`
    });
    return toolResult({ feedback_id: args.feedback_id, resolved });
  }

  if (name === "reopen_feedback") {
    if (typeof args.feedback_id !== "string" || !args.feedback_id) {
      throw Object.assign(new Error("feedback_id is required"), { rpcCode: -32602 });
    }
    const fb = getFeedback(args.feedback_id);
    if (!fb) throw new Error(`Unknown feedback: ${args.feedback_id}`);
    const meta = getArtifactMeta(fb.artifact_id);
    if (!owns(meta)) {
      throw new Error("You can only reopen feedback on your own artifacts");
    }
    const reopened = reopenFeedback(args.feedback_id);
    return toolResult({ feedback_id: args.feedback_id, reopened });
  }

  throw Object.assign(new Error(`Tool is not implemented: ${name}`), { rpcCode: -32603 });
}

async function dispatch(msg, auth, notify) {
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: msg.params?.protocolVersion || PROTOCOL_VERSION,
        // This stateless JSON-RPC-over-HTTP POST transport cannot push list-change notifications; clients must reconnect after updates.
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO
      };
    case "ping":
      return {};
    case "notifications/initialized":
      return {};
    case "tools/list":
      return { tools: TOOL_DEFS };
    case "tools/call":
      return callTool(msg.params, auth, notify);
    default:
      throw Object.assign(new Error(`Method not found: ${msg.method}`), { rpcCode: -32601 });
  }
}

async function handleOne(msg, auth, notify) {
  const isObj = msg && typeof msg === "object" && !Array.isArray(msg);
  if (!isObj || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(isObj && "id" in msg ? msg.id : null, -32600, "Invalid Request");
  }
  const expects = "id" in msg && msg.id !== null && msg.id !== undefined;
  try {
    const result = await dispatch(msg, auth, notify);
    return expects ? { jsonrpc: "2.0", id: msg.id, result } : null;
  } catch (err) {
    if (!expects) return null;
    // Tool execution failures surface as an isError tool result, not a protocol error,
    // unless they are protocol-level (rpcCode set).
    if (err.rpcCode) return rpcError(msg.id, err.rpcCode, err.message);
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: { content: [{ type: "text", text: String(err.message || err) }], isError: true }
    };
  }
}

export async function handleMcp(payload, auth, { notify = defaultNotify } = {}) {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return rpcError(null, -32600, "Invalid Request");
    const out = (await Promise.all(payload.map((m) => handleOne(m, auth, notify)))).filter(Boolean);
    return out.length ? out : null;
  }
  return handleOne(payload, auth, notify);
}
