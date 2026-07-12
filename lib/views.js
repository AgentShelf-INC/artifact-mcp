// Per-viewer artifact view analytics. Recording is deliberately best-effort so it can
// never make an otherwise authorized artifact render fail.
import db from "./db.js";

const recordStmt = db.prepare(`
  INSERT INTO artifact_views (artifact_id, org, email)
  VALUES (?, ?, ?)
  ON CONFLICT(artifact_id, email) DO UPDATE SET
    count = count + 1,
    last_viewed_at = datetime('now')
`);
const countsStmt = db.prepare(`
  SELECT COALESCE(SUM(count), 0) AS views,
         COUNT(*) AS unique_viewers,
         MAX(last_viewed_at) AS last_viewed_at
  FROM artifact_views WHERE artifact_id = ?
`);
const countsForOrgStmt = db.prepare(`
  SELECT artifact_id, SUM(count) AS views, COUNT(*) AS unique_viewers
  FROM artifact_views WHERE org = ? GROUP BY artifact_id
`);
const viewersStmt = db.prepare(`
  SELECT email, count, first_viewed_at, last_viewed_at
  FROM artifact_views WHERE artifact_id = ?
  ORDER BY last_viewed_at DESC
`);
const topStmt = db.prepare(`
  SELECT a.id AS artifact_id, a.title, SUM(v.count) AS views, COUNT(*) AS unique_viewers,
         MAX(v.last_viewed_at) AS last_viewed_at
  FROM artifact_views v
  INNER JOIN artifacts a ON a.id = v.artifact_id AND a.org = v.org
  WHERE v.org = ?
  GROUP BY a.id, a.title
  ORDER BY views DESC, last_viewed_at DESC
  LIMIT ?
`);

export function record(artifactId, org, email) {
  try {
    recordStmt.run(artifactId, org, email);
  } catch {
    // Analytics must never affect the artifact response path.
  }
}

export function countsFor(artifactId) {
  return countsStmt.get(artifactId);
}

export function countsForOrg(org) {
  const result = new Map();
  for (const row of countsForOrgStmt.all(org)) {
    result.set(row.artifact_id, { views: row.views, unique_viewers: row.unique_viewers });
  }
  return result;
}

export function viewersFor(artifactId) {
  return viewersStmt.all(artifactId);
}

export function topForOrg(org, limit = 10) {
  return topStmt.all(org, Math.max(1, Number(limit) || 10));
}
