import test from "node:test";
import assert from "node:assert/strict";
import { renderArtifactShell, renderGallery } from "../lib/portal.js";

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

test("notification rows link to a feedback deep link and the shell focuses its fid parameter", () => {
  const gallery = renderGallery(
    { email: "viewer@acme.test", org: "acme", isAdmin: false },
    [{ org: "acme", items: [] }], new Map(), new Map(), new Map(), new Map(), {},
    { unread: 1, items: [{ id: "feedback-1", artifact_id: "artifact-1", artifact_title: "Quarterly <report>", viewer_email: "author@acme.test", body: "Please review", created_at: "2026-07-14 10:00:00", unread: 1 }] }
  );
  assert.match(gallery, /href="\/artifact-1\?feedback=feedback-1"/);
  assert.match(gallery, /class="notif-count"[^>]*>1</);
  assert.match(gallery, /Quarterly &lt;report&gt;/);
  assert.doesNotMatch(gallery, /Quarterly <report>/);

  const shell = renderArtifactShell(
    { id: "artifact-1", org: "acme", title: "Report", client_id: "publisher", revision: 1, is_bundle: 0, category: "" },
    { prevId: null, nextId: null, index: 1, total: 1 }, {},
    [{ id: "feedback-1", viewer_email: "author@acme.test", body: "Please review", parent_id: null, resolved_at: null, artifact_revision: 1 }]
  );
  assert.match(shell, /new URLSearchParams\(window\.location\.search\)\.get\('feedback'\)/);
  assert.match(shell, /focusFeedback\(requestedFeedback\)/);
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

test("bundle shell scopes anchors to the current page and resets bridge state on navigation", () => {
  const bundle = { ...meta, is_bundle: 1, entry: "index.html" };
  const feedback = [
    { id: "entry", parent_id: null, anchor_page: "index.html", anchor_x: 0.1, anchor_y: 0.2, artifact_revision: 3 },
    { id: "page-two", parent_id: null, anchor_page: "pages/two.html", anchor_x: 0.3, anchor_y: 0.4, artifact_revision: 3 },
    { id: "legacy", parent_id: null, anchor_page: null, anchor_x: 0.5, anchor_y: 0.6, artifact_revision: 3 }
  ];
  const html = renderArtifactShell(bundle, nav, {}, feedback);

  assert.match(html, /anchor_page/);
  assert.match(html, /pin\.page===null\|\|pin\.page===currentPage/);
  assert.match(html, /bridgeReady=false/);
  assert.match(html, /hideAllMarkers/);
  assert.match(html, /anchor_page:anchor&&anchor\.page/);
});

test("preview and viewer iframes are cache-busted by artifact content version", () => {
  const sha = "deadbeefcafebabe0011";
  const item = { id: "abc123", org: "acme", title: "Artifact", client_id: "owner", uploader_label: "", is_bundle: 0, revision: 5, body_sha256: sha, bytes: 1, category: "" };
  const gallery = renderGallery({ email: "v@acme.test", org: "acme", isAdmin: false }, [{ org: "acme", items: [item] }]);
  // preview src carries the body digest (first 12 chars), so a revised body yields a new URL
  assert.match(gallery, /src="\/raw\/abc123\?preview&v=deadbeefcafe"/);

  // digest, not revision, drives the token when body_sha256 is present
  const shell = renderArtifactShell({ ...item }, nav, {}, []);
  assert.match(shell, /\/raw\/abc123\?anchor=1&v=deadbeefcafe/);

  // a changed body digest changes the token (cache is actually busted)
  const gallery2 = renderGallery({ email: "v@acme.test", org: "acme", isAdmin: false }, [{ org: "acme", items: [{ ...item, body_sha256: "0000000000001111" }] }]);
  assert.match(gallery2, /\?preview&v=000000000000"/);
  assert.doesNotMatch(gallery2, /v=deadbeefcafe/);

  // falls back to revision when no digest yet (pre-PBI-022 rows), and omits the param when neither exists
  const noDigest = renderGallery({ email: "v@acme.test", org: "acme", isAdmin: false }, [{ org: "acme", items: [{ ...item, body_sha256: null }] }]);
  assert.match(noDigest, /\?preview&v=5"/);
  const noVersion = renderGallery({ email: "v@acme.test", org: "acme", isAdmin: false }, [{ org: "acme", items: [{ ...item, body_sha256: null, revision: null }] }]);
  assert.match(noVersion, /src="\/raw\/abc123\?preview"/);
});
