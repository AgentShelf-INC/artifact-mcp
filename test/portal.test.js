import test from "node:test";
import assert from "node:assert/strict";
import { renderArtifactShell } from "../lib/portal.js";

const meta = { id: "abc123", org: "acme", title: "Artifact", client_id: "owner", uploader_label: "", is_bundle: 0, revision: 3, bytes: 1, category: "" };
const nav = { prevId: null, nextId: null, index: 1, total: 1 };

test("feedback drawer nests one-level replies and only renders viewer management controls for allowed comments", () => {
  const feedback = [
    { id: "parent", viewer_email: "owner@acme.test", body: "Top", artifact_revision: 3, parent_id: null, created_at: "2026-07-12", anchor_x: 0.1, anchor_y: 0.2, anchor_w: 0.3, anchor_h: 0.4 },
    { id: "reply", viewer_email: "other@acme.test", body: "Reply", artifact_revision: 3, parent_id: "parent", created_at: "2026-07-12", anchor_x: null, anchor_y: null }
  ];
  const html = renderArtifactShell(meta, nav, {}, feedback, {}, { email: "owner@acme.test", isAdmin: false });
  assert.match(html, /data-thread-id="parent"/);
  assert.match(html, /anchor_w/);
  assert.match(html, /vanchor-box/);
  assert.match(html, /data-parent-id="parent"/);
  assert.ok(html.indexOf('data-id="parent"') < html.indexOf('data-id="reply"'));
  const drawer = html.slice(html.indexOf('<aside class="vfb-panel" id="vfb-panel"'), html.indexOf('</aside>', html.indexOf('<aside class="vfb-panel" id="vfb-panel"')));
  assert.equal((drawer.match(/data-feedback-action=/g) || []).length, 2);
  const escapedHtml = renderArtifactShell(meta, nav, {}, feedback, {}, { email: "</script><img>", isAdmin: false });
  assert.ok(escapedHtml.includes('var viewerEmail="\\u003c/script\\u003e\\u003cimg\\u003e"'));
  const adminHtml = renderArtifactShell(meta, nav, {}, feedback, {}, { email: "admin@acme.test", isAdmin: true });
  const adminDrawer = adminHtml.slice(adminHtml.indexOf('<aside class="vfb-panel" id="vfb-panel"'), adminHtml.indexOf('</aside>', adminHtml.indexOf('<aside class="vfb-panel" id="vfb-panel"')));
  assert.equal((adminDrawer.match(/data-feedback-action=/g) || []).length, 4);
});

test("viewer shell includes an escaped public-share drawer", () => {
  const dangerous = { ...meta, id: "abc123", title: "</script><img>" };
  const html = renderArtifactShell(dangerous, nav, {}, [], {}, { email: "member@acme.test", isAdmin: false });
  assert.match(html, /id="vshare-toggle"/);
  assert.match(html, /24 hours/);
  assert.match(html, /Until a date/);
  assert.match(html, /No expiration/);
  assert.match(html, /var shareArtifactId="abc123"/);
  assert.doesNotMatch(html, /<script><\/script><img>/);
});
