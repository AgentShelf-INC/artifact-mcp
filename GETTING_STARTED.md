# Getting Started

A step-by-step setup for **artifact-mcp** — from a local test run to a production deployment behind
Cloudflare. Follow it top to bottom; each phase ends with a check so you know it worked before
moving on.

> **For AI agents helping a user set this up:** this file is written to be executed. Work one phase
> at a time, run the verification at the end of each, and stop and report if a check fails rather
> than continuing. Never invent secrets — ask the user for their domain, Cloudflare team name, and
> admin email. The only place identity can be trusted without a verified JWT is loopback
> development (`TRUST_ACCESS_HEADERS=1`); never set that on a reachable host.

---

## What you'll end up with

- An MCP endpoint (`POST /mcp`) where authorized agents publish HTML artifacts and get back a URL.
- A private, org-scoped gallery for humans, gated by Cloudflare Access (SSO).
- Optional public, unguessable share links under `/s/:token`.
- One core container by default, SQLite + files on disk, no database server. Preview thumbnails add
  an optional browser sidecar.

## Prerequisites

- Docker + Docker Compose.
- A domain you control, on Cloudflare (for production). Local testing needs neither.
- For production SSO: a Cloudflare Zero Trust (Access) account — the free tier is enough.

---

## Phase 1 — Get the code

```bash
git clone <this-repo-url> artifact-mcp
cd artifact-mcp
cp .env.example .env
```

**Check:** `.env` exists in the repo root.

---

## Phase 2 — Configure `.env`

Open `.env`. The only value you must set to boot is a bootstrap publishing key.

| Var | Needed | Notes |
|---|---|---|
| `ARTIFACT_API_KEYS` | **yes** | `clientId:org:secret` (comma-separated for several). The DB is authoritative after first boot; this just seeds the first key. Use a long random secret. |
| `WEBHOOK_ENC_KEY` | recommended | A 32-byte base64 key that encrypts Discord webhook URLs in SQLite with AES-256-GCM. If omitted, webhooks remain zero-config but are stored in plaintext and startup warns loudly. |
| `PREVIEW_RENDERER_URL` | optional | Enables Discord PNG previews for single-file publish/update/restore events. Leave unset for the default text-only behavior. |
| `PUBLIC_BASE_URL` | prod | Your real `https://artifact.your-domain`. Defaults to `http://localhost:3480`. Used to build share URLs. |
| `ADMIN_EMAILS` | prod | Comma-separated emails that see every org (the admin gallery). |
| `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` | prod | Turns on Access JWT verification. Set both in Phase 4. |
| `TRUST_ACCESS_HEADERS` | dev only | `1` trusts an unverified identity header — **loopback development only**, never on a reachable origin. |
| `REQUIRE_ACCESS_JWT` | optional | `1` makes the server refuse to start unless JWT verification is configured. Good for prod images/CI. |
| `HOST_BIND` | optional | Host publish address; defaults to loopback `127.0.0.1`. See Phase 4d. |

Everything else (size caps, `MAX_HISTORY`, `FEEDBACK_MAX_BODY`) has sane defaults — leave it.

Example minimal bootstrap key:
```
ARTIFACT_API_KEYS=agent1:acme:REPLACE_WITH_LONG_RANDOM_SECRET
```

If you will use Discord notifications, generate the deployment encryption key once and add the
printed value to `.env`:

```bash
openssl rand -base64 32
# WEBHOOK_ENC_KEY=<paste the generated value>
```

Keep this key in the same protected secret store as the deployment and backup credentials. On the
first boot with a key, any existing plaintext webhook rows are encrypted in place. Losing the key
means existing encrypted webhook URLs cannot be delivered or recovered by artifact-mcp.

**Check:** `ARTIFACT_API_KEYS` is set to a value you control.

---

## Phase 3 — Run locally (development)

For a first local run with no Cloudflare, enable loopback header-trust so you can act as a viewer:

```bash
echo 'TRUST_ACCESS_HEADERS=1' >> .env      # loopback dev only
docker compose up -d --build
docker logs artifact-mcp | grep "Access identity"
```

> Prefer running without Docker? `npm install && npm run dev` starts the server directly with
> loopback header-trust already enabled (equivalent to setting `TRUST_ACCESS_HEADERS=1`).

You should see `Access identity: HEADER-TRUST (…)`. Publish a test artifact:

```bash
KEY=REPLACE_WITH_LONG_RANDOM_SECRET   # the secret from ARTIFACT_API_KEYS
curl -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"publish_artifact",
       "arguments":{"html":"<h1>hi</h1>","title":"Demo","description":"first artifact"}}}' \
  http://localhost:3480/mcp
```

Browse the gallery as an admin (header trusted locally):
```bash
curl -H "Cf-Access-Authenticated-User-Email: you@example.com" http://localhost:3480/ | head
```

**Check:** the publish call returns a URL, and the gallery HTML renders. When done testing, remove
`TRUST_ACCESS_HEADERS=1` before exposing the app anywhere — with it gone, identity fails closed.

---

## Phase 4 — Production behind Cloudflare

Two surfaces are deliberately split:
- **Upload** (`/mcp`) — API-key auth; Access-bypassed (agents can't do interactive SSO).
- **View** (`/`, `/:id`, `/settings`) — behind Access; the app verifies the JWT and scopes to org.
- **Share** (`/s/:token`) — public, but only with a valid token.

### 4a. Tunnel

Create a Cloudflare Tunnel and route a public hostname (e.g. `artifact.your-domain`) to the
artifact-mcp origin. See Phase 4d for the exact origin URL — prefer the container name over a host
IP.

### 4b. Access applications (order matters — most specific first)

1. **`/mcp`** → policy **Bypass → Everyone**. Agents authenticate with the API key, not SSO.
2. **`/s/*`** → policy **Bypass → Everyone**. Required for public share links: the app validates the
   opaque token itself. This cannot be done from application code.
3. **Catch-all `/`** → policy **Allow** your viewer email domains + admin email(s).

### 4c. Turn on JWT verification

From the **catch-all** Access app, copy its **Application Audience (AUD)** tag. Then in `.env`:
```
CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
CF_ACCESS_AUD=<the-catch-all-AUD-tag>
PUBLIC_BASE_URL=https://artifact.your-domain
ADMIN_EMAILS=you@your-domain
```
Optionally add `REQUIRE_ACCESS_JWT=1` so a misconfigured deploy fails loudly instead of serving.

Rebuild: `docker compose up -d --build`. The boot log must now read
`Access identity: JWT-verified`.

### 4d. Don't publish the origin on the LAN

Cloudflare Access only guards the **tunnel hostname**. A directly-reachable origin port bypasses it
entirely. Two ways to close that, best first:

**Option A — tunnel-only (no host port at all):** run `cloudflared` in this Compose project (an
example service is commented at the bottom of `docker-compose.yml`), on the same default network as
the app. Set the tunnel's **origin service** to `http://artifact-mcp:3480` (the container name,
resolved over Docker's network), uncomment the service, and delete the app's `ports:` block. Nothing
is published on the host.

**Option B — loopback bind:** keep the default `HOST_BIND=127.0.0.1`, so the port is reachable only
from the host, and point the tunnel at `http://localhost:3480` from a `cloudflared` running on that
host.

**Check:**
```bash
ss -ltn | grep 3480          # want 127.0.0.1:3480 (or nothing published, Option A) — NOT 0.0.0.0
curl https://artifact.your-domain/mcp -X POST -d '{}'   # reaches the app (401/JSON), site is up
```

---

## Phase 5 — Create keys and onboard orgs (in the app)

Once you can sign in as admin at `https://artifact.your-domain/settings`:

- **Onboard a viewer org:** Settings → create the org (name + email domain), then add that domain to
  the catch-all Access allow-policy so its people can sign in. A signed-in viewer is auto-tenanted
  by their email domain.
- **Let an org publish:** Settings → generate an upload key for that org. The secret is shown once —
  hand it to the agent/integration. Revoke anytime without a redeploy.
- **Notifications (optional):** Settings → add a per-org Discord webhook and pick which events it
  receives. The UI and HTTP responses always show a masked URL. With `WEBHOOK_ENC_KEY` configured,
  the full URL is encrypted at rest; without it, the documented plaintext fallback applies.

### Optional: Discord preview thumbnails

To add inline PNG previews for single-file publish/update/restore notifications, set this in
`.env`:

```dotenv
PREVIEW_RENDERER_URL=http://artifact-preview:3000
```

Then enable the renderer profile:

```bash
docker compose --profile preview up -d --build
```

The renderer processes untrusted HTML. It must remain on the shipped internal-only network with no
published port, tunnel route, host/app-data mounts, or secrets. Bundles remain text-only. Removing
`PREVIEW_RENDERER_URL` turns the feature fully off; renderer failures also fall back to text embeds.

**Check:** a freshly generated key can publish; the artifact appears in that org's gallery section.

---

## Identity modes (quick reference)

| Mode | When | Behavior |
|---|---|---|
| `jwt` | `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` set | Identity from a verified Access JWT. **Use in production.** |
| `header-trust` | JWT unset + `TRUST_ACCESS_HEADERS=1` | Trusts the (spoofable) email header. **Loopback dev only.** |
| `disabled` | JWT unset, no opt-in | Fails closed — no request can get a viewer/admin identity. Safe default. |

`/mcp` (API key) and `/s/:token` (share token) work in all three modes — they don't depend on viewer
identity.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Gallery shows "Not signed in" after login | JWT vars unset → mode `disabled`, or a cached 403 | Set `CF_ACCESS_*` and rebuild; hard-refresh once. |
| Boot log says `HEADER-TRUST` in production | `TRUST_ACCESS_HEADERS=1` left in `.env` | Remove it; set the JWT vars. |
| `/mcp` returns 401 | Missing/wrong `Authorization: Bearer <key>` | Use a valid, non-revoked key for that org. |
| Share link 404s | Expired, revoked, unknown token, or `/s/*` Access app missing/not Bypass | Recreate the link; confirm the `/s/*` Bypass app exists. |
| Server won't start, logs `REQUIRE_ACCESS_JWT` | Strict mode on without JWT vars | Set both JWT vars, or drop `REQUIRE_ACCESS_JWT`. |
| Site down right after loopback bind | Tunnel still targets a host IP | Point the tunnel origin at `http://artifact-mcp:3480` on the shared network (Phase 4d). |
| MCP client doesn't see new tools | Clients cache `tools/list` at connect | Reconnect the integration after a server update. |

---

## Where to go next

- `README.md` — full feature list, MCP tool reference, architecture, security model.
- `CONTEXT.md` — domain language, invariants, module seams (for contributors and code-editing agents).
- `.env.example` — every configuration variable with inline notes.
