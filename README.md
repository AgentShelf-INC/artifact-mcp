# artifact-mcp

A self-hostable **MCP server that lets authorized agents publish HTML artifacts** to your own
domain. An agent calls a tool, gets back a URL, and the page is served at
`https://your-domain/<id>` — with an org-scoped gallery of everything published, viewer
navigation, favorites/sentiment, and per-org key management.

Think "shareable Claude-style artifacts, hosted on infrastructure you control" — with real
multi-tenancy.

> Live deployment: **artifact.neilblackman.dev** (VM310 Docker, behind Cloudflare Tunnel + Access).
> Sibling of the **Context Hub** (shared LLM memory) — different service, different purpose.

## Features

- **Publish via MCP** — `publish_artifact` (single self-contained HTML) and `publish_bundle`
  (multi-file: several pages that link to each other + a shared stylesheet + assets).
- **Multi-file bundles** — files served under `/raw/:id/…` so relative links (`_shared.css`,
  cross-linked pages, images) resolve. Hosts whole interactive hubs as one artifact.
- **Org tenancy** — each API key is locked to an org; each viewer is scoped to their org by
  verified email domain. Cross-org requests 404. Admins see everything.
- **Cloudflare Access front door** — humans log in (SSO); the app verifies the Access **JWT**
  so the tenant boundary can't be spoofed. The `/mcp` upload path is Access-bypassed (agents
  use the API key, not SSO).
- **Gallery UI** — live-preview cards, org sections, search + org filter, download, delete.
- **Viewer shell** — Home, prev/next within the org (+ arrow keys), favorite ♥, 👍/👎, download,
  sign out.
- **Favorites & sentiment** — per-viewer favorite (floats to the top of their gallery) and
  up/down votes (aggregatable for admin insight).
- **Settings (admin)** — generate/revoke per-org upload keys with a human display label; keys
  are hashed, secrets shown once, revocable without a redeploy.
- **No database server** — SQLite + files on disk. One container.

## MCP tools (`POST /mcp`, bearer key)

| Tool | Purpose |
|---|---|
| `publish_artifact(html, title, description, org?)` | Publish one self-contained HTML page |
| `publish_bundle(files, entry?, title, description, org?)` | Publish a multi-file artifact; `files` is `{ "path": "content" }` |
| `list_artifacts()` | List what this key has published (with URLs) |
| `delete_artifact(id)` | Delete one of this key's artifacts |

`org` is honored only for **admin** keys (target any org); org keys are locked to their own org.

## Architecture

```
Agent ──(MCP, API key)──▶ /mcp ──┐
                                 ├─▶ artifact-mcp (Node/Express) ─▶ SQLite + files on disk
Human ──(Cloudflare Access)──▶ gallery / /:id / /raw/:id/… ──┘   served at https://domain/<id>
```

Two access surfaces, deliberately split:
- **Upload** (`/mcp`) — API-key auth, Access-bypassed (agents can't do interactive SSO).
- **View** (`/`, `/:id`, `/raw/:id/…`, `/settings`) — behind Cloudflare Access; the app
  verifies the Access JWT and scopes content to the viewer's org.

### Routes
| Route | Role |
|---|---|
| `POST /mcp` | MCP JSON-RPC (upload), API-key auth |
| `GET /` | org-scoped gallery (admin: all orgs) |
| `GET /:id` | viewer shell (chrome + iframe) |
| `GET /raw/:id` | raw single-file artifact (or 302 → `/raw/:id/` for bundles) |
| `GET /raw/:id/*` | bundle file serving (path-traversal guarded) |
| `POST /:id/react` | favorite / vote (per viewer) |
| `DELETE /:id` | delete (admin or same-org viewer) |
| `GET /settings`, `POST /settings/keys`, `POST /settings/keys/:id/revoke` | admin key management |

### Key files
`server.js` (production composition) · `lib/app.js` (routes) · `lib/access.js` (tenant policy) ·
`lib/mcp.js` + `lib/contracts.js` (tools + runtime contracts) · `lib/store.js` (artifact lifecycle) ·
`lib/auth.js` (hashed keys) · `lib/identity.js` (Access JWT → org) · `lib/keys.js` (admin key
ops) · `lib/portal.js` (gallery + shell + 404) · `lib/settings.js` (key management page) ·
`lib/reactions.js` (favorites/votes) · `lib/db.js` + `lib/migrations.js` (SQLite lifecycle).

For domain language, invariants, module seams, and workflows, see [`CONTEXT.md`](CONTEXT.md).
Architectural decisions are recorded in [`docs/adr/`](docs/adr/).

## Configuration (`.env`)

| Var | Purpose |
|---|---|
| `ARTIFACT_API_KEYS` | Bootstrap keys, `clientId:org:secret` comma-separated (DB is authoritative after first boot) |
| `ORG_EMAIL_DOMAINS` | Optional `domain:org` overrides — default: the email domain **is** the org (any Access-allowed domain auto-tenants) |
| `ADMIN_EMAILS` / `ADMIN_EMAIL_DOMAINS` | Who sees every org |
| `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` | Enable Access JWT verification (production) |
| `MAX_ARTIFACT_BYTES` (2MB) · `MAX_BUNDLE_BYTES` (8MB) · `MAX_BUNDLE_FILES` (100) | Caps |
| `MCP_JSON_LIMIT` | Optional JSON-envelope override; defaults above the configured bundle cap |

See `.env.example`.

## Quick start

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

1. **Tunnel** public hostname `artifact.your-domain` → `http://<host>:3480`.
2. **Access app** #1 on path `/mcp` → policy **Bypass → Everyone** (agents auth by key).
3. **Access app** #2 catch-all → **Allow** your viewer email domains + admin email.
4. Copy the catch-all app's **AUD** → set `CF_ACCESS_AUD` + `CF_ACCESS_TEAM_DOMAIN`, rebuild
   → viewer identity is now JWT-verified.

Onboard a viewer org: add its email domain to the Access allow-policy (auto-tenants). Let an
org **publish**: generate a key for it in **Settings**.

## Security model

- Cloudflare strips client-supplied `Cf-Access-*` headers at the edge; the app additionally
  **verifies the Access JWT**, so viewer identity (and org) can't be spoofed.
- The service lives on a dedicated application hostname; every artifact is attributed to its
  uploading key. Revoke a key to cut off a collaborator instantly.
- Every raw HTML response carries a CSP sandbox without `allow-same-origin`, including direct
  opens and downloads. Non-HTML bundle assets keep their appropriate content types.
- Bundle paths are sanitized (no `..`, no absolute); size/file caps enforced.
- Docker build context excludes deployment secrets, persistent data, and local planning files.
- Not included: content scanning, rate limiting, or a physically separate raw-content origin.

## Roadmap

- **Replace-in-place** — update an artifact keeping the same id/URL (`update_artifact`), so
  iterating a page doesn't break existing links or bookmarks
- **Inline viewer feedback** — in-org viewers leave feedback on an artifact from the viewer
  shell; the publishing agent reads and resolves it (`list_feedback` / `resolve_feedback`)
- Admin sentiment dashboard (votes already collected)
- Deleted-artifact tombstone page
- Optional separate artifact-delivery origin and content scanning
- Per-key rate limits and quotas; artifact TTL/expiry

## License

TBD (considering MIT for open-source release).
