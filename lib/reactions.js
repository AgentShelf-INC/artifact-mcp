// Per-viewer reactions: favorite (float to top of their gallery) + vote (sentiment).
import db from "./db.js";

const getStmt = db.prepare("SELECT favorite, vote FROM reactions WHERE email = ? AND artifact_id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO reactions (email, artifact_id, favorite, vote, updated_at)
  VALUES (?, ?, ?, ?, datetime('now'))
  ON CONFLICT(email, artifact_id) DO UPDATE SET favorite = excluded.favorite, vote = excluded.vote, updated_at = datetime('now')
`);
const mineStmt = db.prepare("SELECT artifact_id, favorite, vote FROM reactions WHERE email = ?");
const sentimentStmt = db.prepare(`
  SELECT artifact_id,
         SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END)  AS up,
         SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS down,
         SUM(favorite)                              AS favorites
  FROM reactions GROUP BY artifact_id
`);

export function getReaction(email, id) {
  return getStmt.get(email, id) || { favorite: 0, vote: 0 };
}

// Partial update: pass only the field(s) you want to change.
export function setReaction(email, id, { favorite, vote } = {}) {
  const cur = getReaction(email, id);
  const fav = favorite === undefined ? cur.favorite : favorite ? 1 : 0;
  const v = vote === undefined ? cur.vote : vote > 0 ? 1 : vote < 0 ? -1 : 0;
  upsertStmt.run(email, id, fav, v);
  return { favorite: fav, vote: v };
}

// Map<artifact_id, {favorite, vote}> for one viewer — used to render gallery + shell state.
export function reactionsFor(email) {
  const m = new Map();
  for (const r of mineStmt.all(email)) m.set(r.artifact_id, { favorite: r.favorite, vote: r.vote });
  return m;
}

// Aggregate sentiment across all viewers (admin insight). Map<id, {up,down,favorites}>.
export function sentimentMap() {
  const m = new Map();
  for (const r of sentimentStmt.all()) m.set(r.artifact_id, { up: r.up, down: r.down, favorites: r.favorites });
  return m;
}
