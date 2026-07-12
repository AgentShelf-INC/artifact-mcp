// Direct streamable-HTTP MCP (JSON-RPC over POST). Same approach as the context hub:
// SvelteKit/Express expose plain req/res, so a minimal compliant JSON-RPC server is
// simpler and more robust than bridging the SDK transport.
import { publish, publishBundle, update, restore, listRevisions, listForClient, remove, getArtifactMeta, setHidden } from "./store.js";
import {
  listForClient as feedbackForClient,
  listAll as feedbackListAll,
  getFeedback,
  resolveFeedback,
  reopenFeedback
} from "./feedback.js";
import { validateSchemaInput } from "./contracts.js";
import { emit as notify } from "./notify.js";
import { countsFor as viewCountsFor, viewersFor as viewViewersFor } from "./views.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "neilblackman-artifacts", version: "1.1.0" };

const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || "https://artifact.neilblackman.dev";

export const TOOL_DEFS = [
  {
    name: "publish_artifact",
    description:
      "Publish a self-contained HTML document. Returns a public URL that renders it at artifact.neilblackman.dev/<id>. Provide a title and a short description for the artifact index.",
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

async function callTool(params, auth) {
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
    if (meta) notify("published", meta.org, artifactPayload(meta));
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
    if (meta) notify("published", meta.org, artifactPayload(meta));
    return toolResult({ id: r.id, url: urlFor(r.id), org, entry: r.entry, files: r.files, bytes: r.bytes });
  }

  if (name === "list_artifacts") {
    const rows = listForClient(clientId).map((r) => ({
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
    const ok = remove({ id: args.id, clientId, isAdmin: auth.org === "admin" });
    if (ok && meta) notify("deleted", meta.org, artifactPayload(meta));
    return toolResult({ id: args.id, deleted: ok });
  }

  if (name === "update_artifact") {
    if (typeof args.id !== "string" || !args.id) {
      throw Object.assign(new Error("id is required"), { rpcCode: -32602 });
    }
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
    if (meta) notify("updated", meta.org, artifactPayload(meta));
    return toolResult({ id: result.id, url: urlFor(result.id), revision: result.revision, bytes: result.bytes, entry: result.entry, category: result.category });
  }

  if (name === "set_visibility") {
    const meta = getArtifactMeta(args.id);
    if (!meta) throw new Error(`Unknown artifact: ${args.id}`);
    if (auth.org !== "admin" && meta.client_id !== clientId) {
      throw new Error("You can only change visibility of your own artifacts");
    }
    const result = setHidden(args.id, args.hidden);
    return toolResult({ id: result.id, hidden: result.hidden });
  }

  if (name === "list_revisions") {
    if (typeof args.id !== "string" || !args.id) {
      throw Object.assign(new Error("id is required"), { rpcCode: -32602 });
    }
    const meta = getArtifactMeta(args.id);
    if (!meta) throw new Error(`Unknown artifact: ${args.id}`);
    if (auth.org !== "admin" && meta.client_id !== clientId) {
      throw new Error("You can only view history of your own artifacts");
    }
    const history = listRevisions(args.id) || { current: meta.revision, revisions: [] };
    return toolResult({ id: args.id, current: history.current, revisions: history.revisions });
  }

  if (name === "artifact_stats") {
    const meta = getArtifactMeta(args.id);
    if (!meta) throw new Error(`Unknown artifact: ${args.id}`);
    if (auth.org !== "admin" && meta.client_id !== clientId) {
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
    if (meta) notify("restored", meta.org, artifactPayload(meta));
    return toolResult({ id: result.id, url: urlFor(result.id), revision: result.revision, restoredFrom: result.restoredFrom, bytes: result.bytes });
  }

  if (name === "list_feedback") {
    const isAdmin = auth.org === "admin";
    if (typeof args.id === "string" && args.id) {
      const meta = getArtifactMeta(args.id);
      if (!meta) throw new Error(`Unknown artifact: ${args.id}`);
      if (!isAdmin && meta.client_id !== clientId) throw new Error("You can only read feedback on your own artifacts");
      const items = feedbackListAll(args.id).map(feedbackJson);
      return toolResult({ artifact_id: args.id, count: items.length, feedback: items });
    }
    const rows = isAdmin ? feedbackListAll() : feedbackForClient(clientId);
    return toolResult({ count: rows.length, feedback: rows.map(feedbackJson) });
  }

  if (name === "resolve_feedback") {
    if (typeof args.feedback_id !== "string" || !args.feedback_id) {
      throw Object.assign(new Error("feedback_id is required"), { rpcCode: -32602 });
    }
    const fb = getFeedback(args.feedback_id);
    if (!fb) throw new Error(`Unknown feedback: ${args.feedback_id}`);
    const meta = getArtifactMeta(fb.artifact_id);
    if (auth.org !== "admin" && (!meta || meta.client_id !== clientId)) {
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
    if (auth.org !== "admin" && (!meta || meta.client_id !== clientId)) {
      throw new Error("You can only reopen feedback on your own artifacts");
    }
    const reopened = reopenFeedback(args.feedback_id);
    return toolResult({ feedback_id: args.feedback_id, reopened });
  }

  throw Object.assign(new Error(`Tool is not implemented: ${name}`), { rpcCode: -32603 });
}

async function dispatch(msg, auth) {
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
      return callTool(msg.params, auth);
    default:
      throw Object.assign(new Error(`Method not found: ${msg.method}`), { rpcCode: -32601 });
  }
}

async function handleOne(msg, auth) {
  const isObj = msg && typeof msg === "object" && !Array.isArray(msg);
  if (!isObj || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(isObj && "id" in msg ? msg.id : null, -32600, "Invalid Request");
  }
  const expects = "id" in msg && msg.id !== null && msg.id !== undefined;
  try {
    const result = await dispatch(msg, auth);
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

export async function handleMcp(payload, auth) {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return rpcError(null, -32600, "Invalid Request");
    const out = (await Promise.all(payload.map((m) => handleOne(m, auth)))).filter(Boolean);
    return out.length ? out : null;
  }
  return handleOne(payload, auth);
}
