# ADR-0003: Sandbox all raw artifact HTML at response time

- **Status:** Accepted
- **Date:** 2026-07-09

## Context

Published HTML is agent-supplied, active content. The viewer shell already embeds it in a sandboxed iframe without `allow-same-origin`, but users can also open `/raw/:id` directly. An iframe attribute does not constrain a raw document opened as a top-level page.

Bundles require scripts, forms, modals, popups, and non-HTML assets to keep working. Applying a document sandbox policy to CSS, images, fonts, or JavaScript responses would be inappropriate.

## Decision

Every raw response receives this CSP sandbox policy — not only `text/html`. Active non-HTML types (`.svg`, `.xml`) execute as documents on direct navigation, so they are sandboxed too:

`sandbox allow-scripts allow-popups allow-forms allow-modals`

The policy deliberately omits `allow-same-origin`, so the document receives an opaque origin. Download responses keep both the sandbox policy and attachment disposition. Non-HTML bundle assets are served with the same sandbox directive (harmless when they load as subresources), which closes the direct-navigation gap for active types like SVG/XML.

The shell iframe remains sandboxed as a second enforcement point.

## Consequences

- Direct and embedded artifact HTML cannot use the application hostname as its effective origin.
- Capabilities not listed in the sandbox directive remain unavailable. New artifact capabilities must be added deliberately and tested.
- CSP sandboxing reduces same-origin risk but does not make untrusted code trustworthy.
- Trusted application pages and untrusted raw bytes still arrive through one hostname. A distinct artifact-delivery hostname is the preferred future defense-in-depth option if operational complexity is justified; this ADR does not claim that work is complete.

