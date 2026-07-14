// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
import { accessSync, constants } from "node:fs";
import { createApp } from "./lib/app.js";
import { MCP_JSON_LIMIT } from "./lib/config.js";
import db, { ARTIFACT_DIR, seedKeysFromEnv } from "./lib/db.js";
import { sha256Hex, checkKey } from "./lib/auth.js";
import { handleMcp } from "./lib/mcp.js";
import * as artifactStore from "./lib/store.js";
import { ACCESS_IDENTITY_MODE, assertReady, resolveViewer } from "./lib/identity.js";
import { renderGallery, renderArtifactShell, notFoundPage, notSignedInPage } from "./lib/portal.js";
import { renderSettings } from "./lib/settings.js";
import { listKeys, createKey, revokeKey } from "./lib/keys.js";
import * as orgs from "./lib/orgs.js";
import { getReaction, setReaction, reactionsFor, sentimentMap } from "./lib/reactions.js";
import * as views from "./lib/views.js";
import * as shares from "./lib/shares.js";
import { addFeedback, listForArtifact as feedbackForArtifact, getFeedback, deleteFeedback, resolveByViewer } from "./lib/feedback.js";
import * as webhooks from "./lib/webhooks.js";
import * as notify from "./lib/notify.js";
import * as notifications from "./lib/notifications.js";

const PORT = Number(process.env.PORT || 3480);
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || "http://localhost:3480";

assertReady();
const seededKeys = seedKeysFromEnv(sha256Hex);
console.log(`[artifact-mcp] seeded ${seededKeys} key(s) from env`);
if (seededKeys === 0 && listKeys().filter((k) => !k.revoked_at).length === 0) {
  console.warn(
    "[artifact-mcp] WARNING: no upload keys configured — no agent can publish yet. " +
    "Set ARTIFACT_API_KEYS in .env (see .env.example), or create a key in Settings once signed in. " +
    "See GETTING_STARTED.md Phase 2."
  );
}
if (ACCESS_IDENTITY_MODE === "jwt") {
  console.log("[artifact-mcp] Access identity: JWT-verified");
} else if (ACCESS_IDENTITY_MODE === "header-trust") {
  console.warn(
    "[artifact-mcp] WARNING: Access identity: HEADER-TRUST (unverified header; " +
    "TRUST_ACCESS_HEADERS=1 is unsafe outside loopback)"
  );
} else {
  console.log(
    "[artifact-mcp] Access identity: DISABLED (fail closed) — set CF_ACCESS_* for production " +
    "or TRUST_ACCESS_HEADERS=1 for local dev"
  );
}
const storageReport = artifactStore.auditStorage({ cleanTransient: true });
if (storageReport.recoveredPaths.length) {
  console.log(`[artifact-mcp] recovered ${storageReport.recoveredPaths.length} interrupted artifact operation(s)`);
}
if (storageReport.missingBodies.length || storageReport.orphanBodies.length) {
  console.warn(
    `[artifact-mcp] storage divergence: ${storageReport.missingBodies.length} missing body/bodies, ` +
    `${storageReport.orphanBodies.length} orphan body/bodies`
  );
}

const app = createApp({
  checkPublisherKey: checkKey,
  handleMcp,
  resolveViewer,
  artifacts: artifactStore,
  shares,
  keys: { list: listKeys, create: createKey, revoke: revokeKey },
  orgs: {
    list: orgs.listOrgs,
    names: orgs.listOrgNames,
    has: orgs.orgExists,
    create: orgs.createOrg,
    remove: orgs.deleteOrg,
    addDomain: orgs.addDomain,
    removeDomain: orgs.removeDomain,
    addCategory: orgs.addCategory,
    removeCategory: orgs.removeCategory,
    setColor: orgs.setColor,
    colorMap: orgs.colorMap
  },
  webhooks,
  notify,
  notifications,
  reactions: { get: getReaction, set: setReaction, forViewer: reactionsFor, sentiment: sentimentMap },
  views,
  feedback: { add: addFeedback, listForArtifact: feedbackForArtifact, getFeedback, deleteFeedback, resolveByViewer },
  pages: { gallery: renderGallery, shell: renderArtifactShell, notFound: notFoundPage, notSignedIn: notSignedInPage, settings: renderSettings },
  publicBase: PUBLIC_BASE,
  healthCheck() {
    db.prepare("SELECT 1").get();
    accessSync(ARTIFACT_DIR, constants.R_OK | constants.W_OK);
    return { status: "ok" };
  },
  limits: {
    mcpJson: MCP_JSON_LIMIT
  }
});

const LISTEN_HOST = process.env.LISTEN_HOST || "0.0.0.0";
app.listen(PORT, LISTEN_HOST, () => console.log(`[artifact-mcp] listening on ${LISTEN_HOST}:${PORT}`));
