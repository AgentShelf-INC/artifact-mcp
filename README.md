# artifact-mcp

A self-hostable **MCP server that lets authorized agents publish HTML artifacts** to your own
domain. An agent calls a tool, gets back a URL, and the page is served at
`https://your-domain/<id>` — with an org-scoped gallery of everything published, version history,
viewer feedback, view analytics, and per-org key/notification management.

Think "shareable Claude-style artifacts, hosted on infrastructure you control" — with real
multi-tenancy, collaboration, and no third-party lock-in.

> Point it at any domain you control. Set `PUBLIC_BASE_URL` and (for production) the
> Cloudflare Access variables; org colors and tenants are configured at runtime, not in code.

## Screenshots

*Screenshots are from a demo instance seeded with fictional orgs (acme / globex / initech /
umbrella). Both light and dark themes ship; light shown here.*

| Org-scoped gallery | Viewer shell + feedback threads |
|---|---|
| [![gallery](docs/screenshots/01-gallery-light.png)](docs/screenshots/01-gallery-light.png) | [![feedback](docs/screenshots/05-feedback-light.png)](docs/screenshots/05-feedback-light.png) |
| Per-org sections and categories, live artifact previews, colored org filters. | Sandboxed artifact with anchored, threaded viewer feedback (resolve / delete / reply). |

| Version history | Public share link |
|---|---|
| [![history](docs/screenshots/06-history-light.png)](docs/screenshots/06-history-light.png) | [![share](docs/screenshots/07-share-panel-light.png)](docs/screenshots/07-share-panel-light.png) |
| Browse and restore any retained revision. | Create an unlisted, expiring, revocable `/s/:token` link. |

| Admin settings | Branded sign-in |
|---|---|
| [![settings](docs/screenshots/03-settings-light.png)](docs/screenshots/03-settings-light.png) | [![signin](docs/screenshots/02-signin-light.png)](docs/screenshots/02-signin-light.png) |
| Manage orgs, domains, categories, per-org color, webhooks, and upload keys. | The Access-gated front door before SSO. |

## Features

### Publish & content
- **Publish via MCP** — `publish_artifact` (single self-contained HTML) and `publish_bundle`
  (multi-file: several pages that link to each other + a shared stylesheet + assets).
- **Multi-file bundles** — files served under `/raw/:id/…` so relative links (`_shared.css`,
  cross-linked pages, images) resolve. Hosts whole interactive hubs as one artifact.
- **Replace in place** — `update_artifact` swaps content/metadata while keeping the **same id and
  URL**, so iterating a page never breaks existing links. Each update bumps a revision.
- **Version history + restore** — every update snapshots the outgoing revision; browse the
  history and restore any retained revision (`list_revisions` / `restore_artifact`). Restoring is
  itself a new revision (append-only, undoable). Retention capped by `MAX_HISTORY`.

### Multi-tenancy
- **Org registry** — admin-managed organizations, each with a name, one or more **email domains**
  (which auto-tenant a signed-in viewer), and a **category** list — all edited in Settings.
- **Cloudflare Access front door** — humans log in (SSO); the app verifies the Access **JWT** so
  the tenant boundary can't be spoofed. `/mcp` is Access-bypassed (agents use the API key).
- **Public share links** — an org member or admin can make an unlisted, read-only link for one
  artifact. Links are protected by an unguessable token and can expire or be revoked; they are
  deliberately public to anyone who has the URL.
- **Strict isolation** — each key is locked to its org; each viewer is scoped to their org by
  verified email domain. Cross-org requests 404. Admins see every org.

### Organize
- **Categories** — group an org's artifacts into per-category carousels; edit an artifact's
  category from the viewer shell or by dragging its card in the gallery.
- **Show / hide** — unlist an artifact (`set_visibility`): it drops from the gallery, carousels,
  and prev/next nav, but its direct URL still opens for anyone with org access (unlisted, not a
  security boundary). Admins still see hidden ones, marked.
- **Drag to organize** — drag a card between categories within your own org (any member); admins
  can also drag a card onto another org's section to **re-tenant** it (the artifact and all its
  feedback, revisions, and view records move atomically).

### Collaborate
- **Viewer feedback threads** — in-org viewers leave feedback from the trusted shell; each comment
  is its own thread with nested replies, so discussion about different items stays separate.
- **Delete / resolve** — a viewer can delete or resolve their own comments; admins any in-org; the
  publishing agent resolves/reopens via MCP. Resolve is reversible.
- **Anchored comments** — pin a comment to a **point** (click) or drag a **region box** (drag) on
  the artifact; markers scroll/resize-track the content. Older-revision pins are marked stale.

### Insight
- **View analytics** — named, Access-verified views per artifact: total views, unique viewers, and
  who viewed (`artifact_stats`). Admin/self views excluded so counts mean real reach. Counts are
  visible to same-org viewers; the named viewer list only to admins and the owning agent.
- **Favorites & sentiment** — per-viewer favorite ♥ (floats to the top of their gallery) and
  👍/👎 votes; an admin per-org "Most viewed" rollup.

### Notify
- **Per-org Discord webhooks** — register one or more webhooks per org, each subscribed to any of
  six events (`published`, `updated`, `restored`, `deleted`, `feedback`, `resolved`). Route
  publishes to `#artifacts` and feedback to `#feedback`, etc. URLs are validated to the Discord
  host, stored masked, and delivery is fire-and-forget (never blocks a request). Test button.

### Operate
- **Settings (admin)** — manage orgs / domains / categories / webhooks, and generate/revoke
  per-org upload keys with a human display label (keys hashed, secrets shown once, revocable
  without a redeploy).
- **Crash-safe storage** — staging→rename lifecycle, commit-then-swap updates, and startup audit
  recovery reconcile the DB and files on disk after an interrupted operation.
- **No database server** — SQLite (versioned migrations) + files on disk. One container.

## MCP tools (`POST /mcp`, bearer key)

| Tool | Purpose |
|---|---|
| `publish_artifact(html, title, description, category, org)` | Publish one self-contained HTML page |
| `publish_bundle(files, entry, title, description, category, org)` | Publish a multi-file artifact; `files` is `{ "path": "content" }` |
| `list_artifacts()` | List what this key has published (with URLs) |
| `update_artifact(id, html\|files, entry, title, description, category)` | Replace content/metadata in place; bumps its revision (owner or admin) |
| `set_visibility(id, hidden)` | Unlist / relist an artifact (owner or admin) |
| `list_categories(org?)` | List your org's categories (admin may pass an org) |
| `set_category(id, category)` | Move an artifact to a category — no revision bump; auto-registers it (owner or admin) |
| `create_category(name, org?)` / `delete_category(name, org?)` | Manage your org's category list (admin may pass an org) |
| `delete_artifact(id)` | Delete an artifact (owner or admin) |
| `list_revisions(id)` | List an artifact's retained version history (owner or admin) |
| `restore_artifact(id, revision)` | Restore a past revision as a new revision (owner or admin) |
| `create_share(id, expires)` | Create an unlisted public share link (owner or admin) |
| `list_shares(id)` | List active public share links (owner or admin) |
| `revoke_share(token)` | Revoke an active public share link (owner or admin) |
| `artifact_stats(id)` | Views, unique viewers, and the named viewer list (owner or admin) |
| `list_feedback(id?)` | List viewer feedback + anchors + thread structure (owner or admin; admin sees all) |
| `resolve_feedback(feedback_id)` | Mark viewer feedback resolved (owner or admin) |
| `reopen_feedback(feedback_id)` | Reopen a resolved comment (owner or admin) |

All MCP tools use `Authorization: Bearer <API key>`. Org keys are locked to their own org; an
**admin** key may target any org with the `org` argument and can see all feedback. Tools that
mutate an artifact or read another owner's data require the artifact owner or an admin.

> MCP clients cache `tools/list` at connect — after a server update, reconnect the integration to
> pick up new tools/fields.

## Architecture

```
Agent ──(MCP, API key)──▶ /mcp ──┐
                                 ├─▶ artifact-mcp (Node/Express) ─▶ SQLite + files on disk
Human ──(Cloudflare Access)──▶ gallery / /:id / /raw/:id/… ──┘   served at https://domain/<id>
Public ──(share token)────────▶ /s/:token[/…] ──────────────────┘
```

Two access surfaces, deliberately split:
- **Upload** (`/mcp`) — API-key auth, Access-bypassed (agents can't do interactive SSO).
- **View** (`/`, `/:id`, `/raw/:id/…`, `/settings`) — behind Cloudflare Access; the app verifies
  the Access JWT and scopes content to the viewer's org.
- **Share** (`/s/:token[/…]`) — only this path is public, and only when its unguessable token is
  active. It serves the live artifact in a sandbox with `X-Robots-Tag: noindex`; no viewer shell,
  feedback bridge, analytics, or mutation routes are exposed.

### Routes
| Route | Role |
|---|---|
| `POST /mcp` | MCP JSON-RPC (upload), API-key auth |
| `GET /` | org-scoped gallery (admin: all orgs, incl. empty ones as drop targets) |
| `GET /:id` | viewer shell (chrome + sandboxed iframe) |
| `GET /raw/:id` · `GET /raw/:id/*` | raw single-file / bundle serving (path-traversal guarded); `?anchor=1` injects the comment bridge, `?download` forces attachment |
| `GET /raw/:id/rev/:n[/*]` | serve a past revision's body |
| `GET /s/:token` · `GET /s/:token/*` | public read-only share delivery for a valid active token |
| `GET /:id/history` · `POST /:id/restore` | version history + restore |
| `POST /:id/react` | favorite / vote (per viewer) |
| `POST /:id/feedback` · `DELETE /:id/feedback/:fid` · `POST /:id/feedback/:fid/resolve` | threaded viewer feedback (own-or-admin manage) |
| `POST /:id/category` | set category (same-org member or admin) |
| `POST /:id/share` · `GET /:id/shares` · `DELETE /:id/shares/:token` | create, list, or revoke public share links (same-org member or admin) |
| `POST /:id/visibility` | hide / show (same-org member or admin) |
| `POST /:id/move` | category or org move — **admin** (org move re-tenants) |
| `DELETE /:id` | delete (admin or same-org viewer) |
| `GET /settings` + `/settings/keys*` + `/settings/orgs*` (domains, categories, webhooks) | admin management (all admin-only) |

### Key files
`server.js` (composition) · `lib/app.js` (routes) · `lib/access.js` (tenant policy) ·
`lib/identity.js` (Access JWT → org) · `lib/mcp.js` + `lib/contracts.js` (tools + runtime contracts) ·
`lib/store.js` (artifact lifecycle, history, crash-safety) · `lib/orgs.js` (org/domain/category
registry) · `lib/feedback.js` (threaded feedback + anchors) · `lib/views.js` (analytics) ·
`lib/webhooks.js` + `lib/notify.js` (Discord notifications) · `lib/reactions.js` (favorites/votes) ·
`lib/keys.js` + `lib/auth.js` (hashed keys) · `lib/portal.js` (gallery + shell + anchor bridge) ·
`lib/settings.js` (admin page) · `lib/artifact-http.js` (raw headers + bridge) · `lib/shares.js`
(public-link lifecycle) ·
`lib/db.js` + `lib/migrations.js` (SQLite lifecycle).

For domain language, invariants, module seams, and workflows, see [`CONTEXT.md`](CONTEXT.md).

## Configuration (`.env`)

| Var | Purpose |
|---|---|
| `ARTIFACT_API_KEYS` | Bootstrap keys, `clientId:org:secret` comma-separated (DB is authoritative after first boot) |
| `ORG_EMAIL_DOMAINS` | Optional `domain:org` seeds — the registry (managed in Settings) is authoritative; default: the email domain **is** the org |
| `ADMIN_EMAILS` / `ADMIN_EMAIL_DOMAINS` | Who sees every org |
| `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` | Enable Access JWT verification (production) |
| `TRUST_ACCESS_HEADERS` | Set to `1` only for loopback local development; trusts an unverified, spoofable identity header |
| `REQUIRE_ACCESS_JWT` | Set to `1` to refuse startup unless both Access JWT variables are configured |
| `HOST_BIND` | Host publish address; defaults to loopback-only `127.0.0.1` |
| `MAX_ARTIFACT_BYTES` (2MB) · `MAX_BUNDLE_BYTES` (8MB) · `MAX_BUNDLE_FILES` (100) | Content caps |
| `MAX_HISTORY` (20) | Retained revisions per artifact |
| `FEEDBACK_MAX_BODY` (4000) | Max feedback length |
| `MCP_JSON_LIMIT` | Optional JSON-envelope override; defaults above the configured bundle cap |

See `.env.example`.

## Quick start

New here? [`GETTING_STARTED.md`](GETTING_STARTED.md) is a phase-by-phase setup — local run first,
then the full Cloudflare Tunnel + Access production deploy — with a verification check after each
step (and written so an AI agent can drive it).

```bash
cp .env.example .env      # set ARTIFACT_API_KEYS and (prod) CF_ACCESS_* vars
docker compose up -d --build
```

Publish (raw MCP call):
```bash
curl -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"publish_artifact",
       "arguments":{"html":"<h1>hi</h1>","title":"Demo","description":"first artifact"}}}' \
  https://your-domain/mcp
```

## Cloudflare setup (production)

1. **Tunnel** public hostname `artifact.your-domain` → the artifact-mcp origin.
2. **Access app** #1 on path `/mcp` → policy **Bypass → Everyone** (agents auth by key).
3. **Access app** #2 on path `/s/*` → policy **Bypass → Everyone**. This is required for public
   share links: the application validates the opaque share token itself. It cannot be configured
   from application code.
4. **Access app** #3 catch-all → **Allow** your viewer email domains + admin email.
5. Copy the catch-all app's **AUD** → set `CF_ACCESS_AUD` + `CF_ACCESS_TEAM_DOMAIN`, rebuild
   → viewer identity is now JWT-verified.

### Network exposure

Cloudflare Access guards the tunnel hostname, not an origin port reached directly. Do not publish
the origin on the LAN. The shipped Compose file defaults to the loopback-only
`127.0.0.1:3480:3480` mapping (controlled explicitly with `HOST_BIND`). The preferred fully-private
setup is the commented same-project `cloudflared` service: configure its tunnel origin as
`http://artifact-mcp:3480`, uncomment it, and remove the app's `ports:` section entirely. The
tunnel then reaches the app over Compose's default network without any host port.

Onboard a viewer org: create it in **Settings** (name + email domain) and add that domain to the
Access allow-policy. Let an org **publish**: generate a key for it in Settings.

## Security model

- Cloudflare strips client-supplied `Cf-Access-*` headers at the edge; the app additionally
  **verifies the Access JWT**, so viewer identity (and org) can't be spoofed.
- Viewer identity fails closed by default: without both `CF_ACCESS_*` JWT settings, no header can
  authenticate a viewer. `TRUST_ACCESS_HEADERS=1` restores unverified header trust only as an
  explicit loopback-development convenience and is unsafe on a reachable origin. Production must
  configure both JWT settings and can enforce them at startup with `REQUIRE_ACCESS_JWT=1`.
- Every artifact is attributed to its uploading key; revoke a key to cut off a collaborator
  instantly. Org move re-tenants an artifact and all its child rows atomically.
- **Sandboxed rendering** — every raw and shared response carries a CSP sandbox without `allow-same-origin`
  (including `.svg`/`.xml` and downloads), so uploaded content runs in a null origin.
- **Anchored-comment bridge** — the comment/position script is injected **only** into the
  `?anchor=1` representation (raw + downloads are byte-for-byte unchanged), is a fixed server
  constant, and the shell parent **never reads the iframe DOM**: all anchor data arrives via
  `postMessage`, validated by frame identity and a type allowlist, and treated as untrusted.
- **Webhooks** — URLs are validated to the Discord webhook host (no SSRF to arbitrary hosts),
  stored/returned masked, and delivered fire-and-forget with a timeout and no redirect following.
- **View privacy** — named viewer lists reach only admins and the owning agent; never cross-tenant.
- **Public shares** — a share is unlisted public, not private: anyone with its URL can view the
  live artifact. A random URL-safe token, server-side expiry, and immediate revoke are its access
  controls; invalid, expired, and revoked tokens all return the same 404.
- Bundle paths are sanitized (no `..`, no absolute); size/file caps enforced; the Docker build
  context excludes deployment secrets, persistent data, and local planning files.
- Not included: content scanning, rate limiting, or a physically separate raw-content origin.

## Roadmap

- Admin sentiment dashboard (votes + views already collected)
- Full-text search across the library
- Cooperative (`data-anchor`) precise anchoring; text-range highlights
- Per-key rate limits and quotas; artifact TTL/expiry; deleted-artifact tombstone
- Optional separate artifact-delivery origin and content scanning

External no-login sharing is intentionally limited to explicit per-artifact links under `/s/*`;
the gallery and all ordinary artifact routes remain Access-gated.

## License

MIT — see [`LICENSE`](LICENSE).
