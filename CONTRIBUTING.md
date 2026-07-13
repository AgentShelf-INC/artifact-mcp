# Contributing

Thanks for your interest in artifact-mcp. Issues, ideas, and pull requests are welcome.

## Ground rules

- **Open an issue first** for anything non-trivial, so we can agree on the approach before you build.
  Small fixes (typos, obvious bugs) can go straight to a PR.
- **Keep the security model intact.** This is a multi-tenant server; tenant isolation, the fail-closed
  identity default, the sandboxed rendering, and the SSRF-limited webhooks are load-bearing. If a
  change touches any of them, call it out explicitly in the PR.
- **No new runtime dependencies** without discussion. The server is intentionally small (Express +
  better-sqlite3, ESM, no build step) and easy to audit.

## Development

```bash
npm install
npm test          # node --test; all suites must pass
```

- Node 22+. No build step — it runs from source.
- Match the surrounding style: small modules, a DI factory (`createApp`, `createArtifactStore`), and
  the module-singleton pattern already in `lib/`.
- Add or update tests for any behavior change. Prefer the existing DI/in-memory harness in `test/`
  over anything that needs real sockets or a real Cloudflare.
- Schema changes go through a new versioned migration in `lib/migrations.js` (append-only; never edit
  a shipped migration).

## Pull requests

- Keep PRs focused — one concern each.
- Describe **what** changed, **why**, and **how you verified it** (tests, manual steps).
- Confirm `npm test` is green.
- By contributing, you agree your contributions are licensed under the project's Apache License 2.0.

## Reporting security issues

Do **not** open a public issue for a vulnerability. See [`SECURITY.md`](SECURITY.md) for private
disclosure.

## Where to start

Look for issues labeled **good first issue**. `CONTEXT.md` explains the domain language, invariants,
and module seams — read it before a larger change.
