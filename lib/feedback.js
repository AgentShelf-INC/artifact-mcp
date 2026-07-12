// Org-scoped viewer feedback threads (PBI-010). Viewers add from the trusted shell;
// publishing agents list + resolve via MCP. org + artifact_revision are derived from the
// artifact row, never from viewer input.
import { customAlphabet } from "nanoid";
import db from "./db.js";
import { FEEDBACK_MAX_BODY } from "./config.js";

const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);

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

export function createFeedbackStore({ db: database }) {
  const insertStmt = database.prepare(`
    INSERT INTO feedback (id, artifact_id, org, viewer_email, body, artifact_revision, parent_id, anchor_path, anchor_x, anchor_y, anchor_approx)
    VALUES (@id, @artifact_id, @org, @viewer_email, @body, @artifact_revision, @parent_id, @anchor_path, @anchor_x, @anchor_y, @anchor_approx)
  `);
  const getStmt = database.prepare("SELECT * FROM feedback WHERE id = ?");
  const byArtifactStmt = database.prepare(
    "SELECT * FROM feedback WHERE artifact_id = ? ORDER BY (resolved_at IS NOT NULL), created_at ASC, id ASC"
  );
  const resolveStmt = database.prepare(
    "UPDATE feedback SET resolved_at = datetime('now'), resolved_by = ? WHERE id = ? AND resolved_at IS NULL"
  );
  const reopenStmt = database.prepare(
    "UPDATE feedback SET resolved_at = NULL, resolved_by = NULL WHERE id = ? AND resolved_at IS NOT NULL"
  );
  const deleteStmt = database.prepare("DELETE FROM feedback WHERE id = ?");
  // Agent (MCP) listings, scoped to the key's own artifacts.
  const byClientStmt = database.prepare(`
    SELECT f.* FROM feedback f JOIN artifacts a ON a.id = f.artifact_id AND a.org = f.org
    WHERE a.client_id = ? ORDER BY (f.resolved_at IS NOT NULL), f.created_at DESC, f.id DESC
  `);
  const byClientArtifactStmt = database.prepare(`
    SELECT f.* FROM feedback f JOIN artifacts a ON a.id = f.artifact_id AND a.org = f.org
    WHERE a.client_id = ? AND f.artifact_id = ? ORDER BY (f.resolved_at IS NOT NULL), f.created_at DESC, f.id DESC
  `);
  const allStmt = database.prepare(
    "SELECT * FROM feedback ORDER BY (resolved_at IS NOT NULL), created_at DESC, id DESC"
  );

  function addFeedback({ artifactId, org, viewerEmail, body, artifactRevision, anchor, parentId }) {
    const trimmed = String(body || "").trim();
    if (!trimmed) throw new Error("Feedback can’t be empty.");
    if (trimmed.length > FEEDBACK_MAX_BODY) throw new Error(`Feedback is too long (max ${FEEDBACK_MAX_BODY} characters).`);

    const parent_id = parentId == null || parentId === "" ? null : String(parentId);
    if (parent_id) {
      const parent = getStmt.get(parent_id);
      if (!parent) throw new Error("Reply parent not found.");
      if (parent.artifact_id !== artifactId || parent.org !== org) throw new Error("Reply parent belongs to a different artifact.");
      if (parent.parent_id != null) throw new Error("Replies can only be added to top-level feedback.");
    }

    const id = newId();
    insertStmt.run({
      id,
      artifact_id: artifactId,
      org,
      viewer_email: viewerEmail,
      body: trimmed,
      artifact_revision: Number(artifactRevision) || 1,
      parent_id,
      ...(parent_id ? normalizeAnchor(null) : normalizeAnchor(anchor))
    });
    return getStmt.get(id);
  }

  function listForArtifact(artifactId) {
    return byArtifactStmt.all(artifactId);
  }

  function getFeedback(id) {
    return getStmt.get(id);
  }

  // Existing agent/owner path: the caller performs artifact ownership checks first.
  function resolveFeedback(id, resolvedBy) {
    return resolveStmt.run(resolvedBy, id).changes > 0;
  }

  function resolveByViewer(id, { viewerEmail, isAdmin }) {
    const row = getStmt.get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.viewer_email !== viewerEmail && !isAdmin) return { ok: false, reason: "forbidden" };
    // changed=false when it was already resolved (no state transition) — callers use this
    // to avoid re-emitting a "resolved" notification on a retried resolve.
    const changed = resolveStmt.run(isAdmin ? `admin:${viewerEmail}` : viewerEmail, id).changes > 0;
    return { ok: true, id, changed };
  }

  function deleteFeedback(id, { viewerEmail, isAdmin }) {
    const row = getStmt.get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.viewer_email !== viewerEmail && !isAdmin) return { ok: false, reason: "forbidden" };
    deleteStmt.run(id);
    return { ok: true, id };
  }

  function reopenFeedback(id) {
    return reopenStmt.run(id).changes > 0;
  }

  // Agent view: the key's own artifacts (optionally one artifact); admin sees all.
  function listForClient(clientId, artifactId) {
    return artifactId ? byClientArtifactStmt.all(clientId, artifactId) : byClientStmt.all(clientId);
  }

  function listAll(artifactId) {
    return artifactId ? byArtifactStmt.all(artifactId) : allStmt.all();
  }

  return { addFeedback, listForArtifact, getFeedback, resolveFeedback, resolveByViewer, deleteFeedback, reopenFeedback, listForClient, listAll };
}

const feedback = createFeedbackStore({ db });

export const { addFeedback, listForArtifact, getFeedback, resolveFeedback, resolveByViewer, deleteFeedback, reopenFeedback, listForClient, listAll } = feedback;
