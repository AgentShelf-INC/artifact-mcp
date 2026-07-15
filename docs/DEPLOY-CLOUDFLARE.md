# Deploy behind Cloudflare Access

Cloudflare Access remains the human login layer. The setup command configures the catch-all
self-hosted application, its single-IdP login experience, optional account-wide login design, and
an optional hostname Configuration Rule. It deliberately does **not** create or change Access
policies: who may sign in and which routes bypass Access are operator-owned security decisions.

## Bootstrap order

The order matters because Cloudflare assigns the application's audience (`AUD`) only after the
application exists, while artifact-mcp reads `CF_ACCESS_AUD` when `lib/identity.js` is imported.

1. Create the Cloudflare Tunnel/public hostname and make the origin reachable from Cloudflare.
   Keep the origin private: use the same-network `cloudflared` container, or bind the host publish
   to loopback.
2. Create a least-privilege Cloudflare API token, export the setup inputs, and preview the changes:

   ```bash
   export CF_API_TOKEN=REPLACE_WITH_A_LEAST_PRIVILEGE_TOKEN
   export CF_ACCOUNT_ID=REPLACE_WITH_ACCOUNT_ID
   export PUBLIC_BASE_URL=https://artifact.example.com
   export CF_ACCESS_IDP_ID=REPLACE_WITH_IDP_ID

   node scripts/cf-access-setup.mjs
   node scripts/cf-access-setup.mjs --apply
   ```

   Dry-run is the default. `--apply` creates or finds the catch-all Access app, configures exactly
   one allowed IdP with automatic redirect, and prints copyable `CF_ACCESS_AUD=...` and
   `CF_ACCESS_TEAM_DOMAIN=...` values. It never writes `.env`.
3. In Zero Trust, create or verify these applications and policies, with specific paths taking
   precedence over the catch-all:

   - `artifact.example.com/mcp`: **Bypass → Everyone**. Agents authenticate with an API key.
   - `artifact.example.com/s/*`: **Bypass → Everyone**. The app validates the unguessable share
     token. Application code cannot make an Access-gated route public.
   - Catch-all `artifact.example.com`: **Allow** only the intended viewers.

4. Put the emitted values in the artifact-mcp runtime environment:

   ```dotenv
   PUBLIC_BASE_URL=https://artifact.example.com
   CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
   CF_ACCESS_AUD=REPLACE_WITH_EMITTED_AUD
   REQUIRE_ACCESS_JWT=1
   ```

5. Start artifact-mcp, or fully restart it if it was already running. Editing an env file or doing
   a hot reload is insufficient because identity configuration is captured at module initialization.

## Setup inputs

| Variable | Required | Purpose |
|---|---:|---|
| `CF_API_TOKEN` | yes | Operator-side token; never stored by artifact-mcp |
| `CF_ACCOUNT_ID` | yes | Account containing the Zero Trust organization |
| `PUBLIC_BASE_URL` | yes | HTTPS deployment URL; the hostname identifies the catch-all app |
| `CF_ACCESS_IDP_ID` | yes | The one IdP allowed by the catch-all app |
| `CF_ACCESS_SESSION_DURATION` | no | App session duration; defaults to `24h` |
| `CF_ZONE_ID` | no | Enables the hostname-scoped Email Obfuscation Configuration Rule |
| `CF_ACCESS_LOGIN_LOGO_URL` | no | Public HTTPS logo for the reusable Access login page |
| `CF_ACCESS_LOGIN_HEADER` / `CF_ACCESS_LOGIN_FOOTER` | no | Reusable login-page copy |
| `CF_ACCESS_LOGIN_BACKGROUND_COLOR` / `CF_ACCESS_LOGIN_TEXT_COLOR` | no | Six-digit hex colors |

The token needs Access Apps write and Access Organizations read permissions. Account login design
updates need Access Organizations write. If `CF_ZONE_ID` is used, add Zone Config Rules edit for
that zone. Revoke or rotate the setup token after use according to your normal operator practice.

## Account-wide login branding

Access login branding is account-wide under **Zero Trust → Reusable components → Custom pages**.
It is not an individual application's `logo_url` (that controls App Launcher presentation).
Supplying any `CF_ACCESS_LOGIN_*` input makes the dry-run print the current and merged desired
`login_design`; `--apply` updates that reusable design for **every Access application in the
account**. The logo must be publicly reachable over HTTPS before authentication.

## Response transformation safeguards

artifact-mcp appends `Cache-Control: no-transform` at its HTTP listener boundary. Existing cache
directives remain intact: dynamic shells and shares retain `no-store`; ordinary raw responses
retain their private cache window. Cloudflare therefore does not inject Email Address Obfuscation
scripts into HTML, and artifact bodies remain byte-identical.

When `CF_ZONE_ID` is set, the setup command also manages a hostname-only Configuration Rule with
`email_obfuscation: false`. This is defense in depth. If the plan or token does not support that
rule, the script warns and continues because the origin `no-transform` header is sufficient.

## Troubleshooting

| Symptom | Check |
|---|---|
| `email-decode.min.js`, `data-cfemail`, or blocked-script console floods | Confirm the response's `Cache-Control` contains `no-transform`. If `CF_ZONE_ID` was supplied, rerun the setup dry-run and inspect the Configuration Rule status. |
| Login-method picker appears with one IdP | Rerun the setup command; the catch-all app must have exactly one `allowed_idps` value and `auto_redirect_to_identity: true`. |
| Strict startup says `CF_ACCESS_*` is missing | Run setup before strict startup, copy the emitted AUD/team domain, set both runtime vars, and fully restart. |
| First request after login briefly says it is completing sign-in | This is the one-shot JWT-assertion propagation retry. If the guarded retry still fails, artifact-mcp renders the normal signed-out page and remains fail closed. |
| `/mcp` returns an Access login page or public shares prompt for login | Create/repair the two explicit **Bypass → Everyone** applications. The setup command never changes policies. |
| Login logo has a CSP/load error | Use a separately hosted public HTTPS image in `CF_ACCESS_LOGIN_LOGO_URL`; do not point it at a route behind the same Access gate. |

Cloudflare documents that `Cache-Control: no-transform` disables Email Address Obfuscation and that
Configuration Rules use the `http_config_settings` phase. See the official
[Email Address Obfuscation](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/),
[Configuration Rules](https://developers.cloudflare.com/rules/configuration-rules/create-api/), and
[Zero Trust organization API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/organizations/)
references.
