// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
export function artifactAccess(viewer, artifact, { conceal = false } = {}) {
  if (!artifact) return { ok: false, status: 404, error: "Not found" };
  if (!viewer?.email) {
    return conceal
      ? { ok: false, status: 404, error: "Not found" }
      : { ok: false, status: 401, error: "Not signed in" };
  }
  if (viewer.isAdmin || (viewer.org && viewer.org === artifact.org)) return { ok: true };
  return conceal
    ? { ok: false, status: 404, error: "Not found" }
    : { ok: false, status: 403, error: "Forbidden" };
}

export function adminAccess(viewer) {
  if (!viewer?.email) return { ok: false, status: 403, error: "Not signed in" };
  if (!viewer.isAdmin) return { ok: false, status: 403, error: "Admins only" };
  return { ok: true };
}
