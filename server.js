import { accessSync, constants } from "node:fs";
import { createApp } from "./lib/app.js";
import { MCP_JSON_LIMIT } from "./lib/config.js";
import db, { ARTIFACT_DIR, seedKeysFromEnv } from "./lib/db.js";
import { sha256Hex, checkKey } from "./lib/auth.js";
import { handleMcp } from "./lib/mcp.js";
import * as artifactStore from "./lib/store.js";
import { resolveViewer, JWT_VERIFICATION_ON } from "./lib/identity.js";
import { renderGallery, renderArtifactShell, notFoundPage } from "./lib/portal.js";
import { renderSettings } from "./lib/settings.js";
import { listKeys, createKey, revokeKey } from "./lib/keys.js";
import * as orgs from "./lib/orgs.js";
import { getReaction, setReaction, reactionsFor, sentimentMap } from "./lib/reactions.js";
import * as views from "./lib/views.js";
import * as shares from "./lib/shares.js";
import { addFeedback, listForArtifact as feedbackForArtifact, getFeedback, deleteFeedback, resolveByViewer } from "./lib/feedback.js";
import * as webhooks from "./lib/webhooks.js";
import * as notify from "./lib/notify.js";

const PORT = Number(process.env.PORT || 3480);
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || "http://localhost:3480";

console.log(`[artifact-mcp] seeded ${seedKeysFromEnv(sha256Hex)} key(s) from env`);
console.log(`[artifact-mcp] Access JWT verification: ${JWT_VERIFICATION_ON ? "ON" : "OFF (trusting header — set CF_ACCESS_TEAM_DOMAIN+CF_ACCESS_AUD for production)"}`);
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
    removeCategory: orgs.removeCategory
  },
  webhooks,
  notify,
  reactions: { get: getReaction, set: setReaction, forViewer: reactionsFor, sentiment: sentimentMap },
  views,
  feedback: { add: addFeedback, listForArtifact: feedbackForArtifact, getFeedback, deleteFeedback, resolveByViewer },
  pages: { gallery: renderGallery, shell: renderArtifactShell, notFound: notFoundPage, settings: renderSettings },
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

app.listen(PORT, () => console.log(`[artifact-mcp] listening on :${PORT}`));
