// Direct streamable-HTTP MCP (JSON-RPC over POST). Same approach as the context hub:
// SvelteKit/Express expose plain req/res, so a minimal compliant JSON-RPC server is
// simpler and more robust than bridging the SDK transport.
import { publish, listForClient, remove } from "./store.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "neilblackman-artifacts", version: "1.0.0" };

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
        org: { type: "string", description: "Target org (admin keys only; org keys are locked to their own org)." }
      },
      required: ["html"],
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
  }
];

function urlFor(id) {
  return `${PUBLIC_BASE}/${id}`;
}

function toolResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }], structuredContent: obj };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function callTool(params, auth) {
  const name = params?.name;
  const args = params?.arguments && typeof params.arguments === "object" ? params.arguments : {};
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
      description: args.description
    });
    return toolResult({ id, url: urlFor(id), org, bytes });
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
    const ok = remove({ id: args.id, clientId });
    return toolResult({ id: args.id, deleted: ok });
  }

  throw Object.assign(new Error(`Unknown tool: ${name}`), { rpcCode: -32602 });
}

async function dispatch(msg, auth) {
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: msg.params?.protocolVersion || PROTOCOL_VERSION,
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
