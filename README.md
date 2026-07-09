# artifact-mcp

A small, self-hostable **MCP server that lets authorized agents publish HTML artifacts** to
your own domain. An agent calls a tool, gets back a URL, and the page is served at
`https://your-domain/<id>` — with a homepage index of everything published, and per-org
isolation so different clients only ever see their own artifacts.

Think "shareable Claude-style artifacts, hosted on infrastructure you control."

## Features

- **MCP tools** (`publish_artifact`, `list_artifacts`, `delete_artifact`) over a keyed
  HTTP endpoint — wire it into Claude Code, Codex, Hermes, or any MCP client.
- **Hashed, revocable API keys** for upload — issue one per collaborator, revoke without a redeploy.
- **Multi-tenant by identity.** Behind Cloudflare Access, each viewer is scoped to their org
  by email domain; cross-org requests 404. An admin sees everything.
- **Zero-config onboarding.** Any email domain you allow at the edge auto-tenants — no app change.
- **No database server required** — SQLite + files on disk. One container.

## Architecture

```
Agent ──(MCP, API key)──▶ /mcp ──┐
                                 ├─▶ artifact-mcp (Node/Express) ─▶ SQLite + HTML files
Human ──(Cloudflare Access)──▶ / , /<id> ──┘        served at https://your-domain/<id>
```

Two access surfaces, deliberately split:
- **Upload** (`/mcp`) — API-key auth. Not behind SSO (agents can't do an interactive login).
- **View** (`/`, `/<id>`) — behind Cloudflare Access; the app verifies the Access JWT and
  scopes content to the viewer's org.

## Quick start

```bash
cp .env.example .env   # set ARTIFACT_API_KEYS and (for prod) the CF_ACCESS_* vars
docker compose up -d --build
```

### Configuration (`.env`)

| Var | Purpose |
|---|---|
| `ARTIFACT_API_KEYS` | Upload keys, `clientId:org:secret` comma-separated |
| `ORG_EMAIL_DOMAINS` | Optional `domain:org` overrides (default: the email domain *is* the org) |
| `ADMIN_EMAILS` / `ADMIN_EMAIL_DOMAINS` | Who sees every org |
| `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` | Enable Cloudflare Access JWT verification (production) |
| `MAX_ARTIFACT_BYTES` | Per-artifact size cap (default 2 MB) |

### Publish (raw MCP call)

```bash
curl -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"publish_artifact",
       "arguments":{"html":"<h1>hi</h1>","title":"Demo","description":"first artifact"}}}' \
  https://your-domain/mcp
```

## Security model

- Cloudflare strips client-supplied `Cf-Access-*` headers at the edge; the app additionally
  **verifies the Access JWT**, so viewer identity (and therefore org) can't be spoofed.
- Served HTML lives on an **isolated subdomain** (its own origin) and every artifact is
  attributed to the uploading key. Revoke a key to cut off a collaborator instantly.
- Not (yet) included: content scanning / CSP sandboxing of hosted HTML, rate limiting.
  See `## Roadmap`.

## Roadmap

- Web delete/admin actions in the portal UI
- Optional CSP sandboxing + content scanning for hosted HTML
- Per-key rate limits and quotas
- Artifact TTL / expiry option

## License

TBD (considering MIT for open-source release).
