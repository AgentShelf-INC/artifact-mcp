// Org-scoped viewer feedback threads (PBI-010). Viewers add from the trusted shell;
// publishing agents list + resolve via MCP. org + artifact_revision are derived from the
// artifact row, never from viewer input.
import { customAlphabet } from "nanoid";
import db from "./db.js";
import { FEEDBACK_MAX_BODY } from "./config.js";

const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);

const insertStmt = db.prepare(`
  INSERT INTO feedback (id, artifact_id, org, viewer_email, body, artifact_revision, anchor_path, anchor_x, anchor_y, anchor_approx)
  VALUES (@id, @artifact_id, @org, @viewer_email, @body, @artifact_revision, @anchor_path, @anchor_x, @anchor_y, @anchor_approx)
`);
const getStmt = db.prepare("SELECT * FROM feedback WHERE id = ?");
const byArtifactStmt = db.prepare(
  "SELECT * FROM feedback WHERE artifact_id = ? ORDER BY (resolved_at IS NOT NULL), created_at ASC, id ASC"
);
const resolveStmt = db.prepare(
  "UPDATE feedback SET resolved_at = datetime('now'), resolved_by = ? WHERE id = ? AND resolved_at IS NULL"
);
const reopenStmt = db.prepare(
  "UPDATE feedback SET resolved_at = NULL, resolved_by = NULL WHERE id = ? AND resolved_at IS NOT NULL"
);
// Agent (MCP) listings, scoped to the key's own artifacts.
const byClientStmt = db.prepare(`
  SELECT f.* FROM feedback f JOIN artifacts a ON a.id = f.artifact_id AND a.org = f.org
  WHERE a.client_id = ? ORDER BY (f.resolved_at IS NOT NULL), f.created_at DESC, f.id DESC
`);
const byClientArtifactStmt = db.prepare(`
  SELECT f.* FROM feedback f JOIN artifacts a ON a.id = f.artifact_id AND a.org = f.org
  WHERE a.client_id = ? AND f.artifact_id = ? ORDER BY (f.resolved_at IS NOT NULL), f.created_at DESC, f.id DESC
`);
const allStmt = db.prepare(
  "SELECT * FROM feedback ORDER BY (resolved_at IS NOT NULL), created_at DESC, id DESC"
);

function normalizeAnchor(anchor) {
  if (anchor == null) return { anchor_path: null, anchor_x: null, anchor_y: null, anchor_approx: 0 };
  if (typeof anchor !== "object" || Array.isArray(anchor)) throw new Error("Anchor must be an object.");
  if (!Number.isFinite(anchor.x) || anchor.x < 0 || anchor.x > 1 || !Number.isFinite(anchor.y) || anchor.y < 0 || anchor.y > 1) {
    throw new Error("Anchor x and y must be finite numbers between 0 and 1.");
  }
  return {
    anchor_path: anchor.path == null ? null : String(anchor.path).slice(0, 512),
    anchor_x: anchor.x,
    anchor_y: anchor.y,
    anchor_approx: anchor.approx ? 1 : 0
  };
}

export function addFeedback({ artifactId, org, viewerEmail, body, artifactRevision, anchor }) {
  const trimmed = String(body || "").trim();
  if (!trimmed) throw new Error("Feedback can’t be empty.");
  if (trimmed.length > FEEDBACK_MAX_BODY) throw new Error(`Feedback is too long (max ${FEEDBACK_MAX_BODY} characters).`);
  const id = newId();
  insertStmt.run({
    id,
    artifact_id: artifactId,
    org,
    viewer_email: viewerEmail,
    body: trimmed,
    artifact_revision: Number(artifactRevision) || 1,
    ...normalizeAnchor(anchor)
  });
  return getStmt.get(id);
}

export function listForArtifact(artifactId) {
  return byArtifactStmt.all(artifactId);
}

export function getFeedback(id) {
  return getStmt.get(id);
}

export function resolveFeedback(id, resolvedBy) {
  return resolveStmt.run(resolvedBy, id).changes > 0;
}

export function reopenFeedback(id) {
  return reopenStmt.run(id).changes > 0;
}

// Agent view: the key's own artifacts (optionally one artifact); admin sees all.
export function listForClient(clientId, artifactId) {
  return artifactId ? byClientArtifactStmt.all(clientId, artifactId) : byClientStmt.all(clientId);
}

export function listAll(artifactId) {
  return artifactId ? byArtifactStmt.all(artifactId) : allStmt.all();
}
