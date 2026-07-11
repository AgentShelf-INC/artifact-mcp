# ADR-0002: Coordinate SQLite metadata and filesystem bodies with recoverable moves

- **Status:** Accepted
- **Date:** 2026-07-09

## Context

Artifact metadata benefits from SQLite queries while artifact bodies are naturally served as files and directories. A single database transaction cannot atomically commit both SQLite and filesystem state. Writing final bodies before metadata, or deleting metadata before bodies, creates failure windows that can silently orphan one side.

The service runs as one process with a mounted persistent data directory. That makes synchronous staging moves, compensating actions, and startup reconciliation practical without adding an object store or job system.

## Decision

Retain SQLite for artifact records, keys, reactions, and migration history, and retain the filesystem for artifact bodies.

- Apply ordered schema migrations transactionally and record them in `schema_migrations`.
- Enable SQLite foreign keys; artifact deletion cascades reactions.
- Publish through hidden staging paths, insert metadata, then rename to the final body path. Compensate both sides when an in-process step fails.
- Delete by moving the body to hidden trash, deleting metadata, then removing trash. Restore the body if database deletion fails.
- Reconcile transient paths at startup. If a live artifact record has no final body, recover its staging/trash path. Remove unreferenced transient paths, but only report ordinary orphan bodies and missing bodies.

## Consequences

- Normal and caught failure paths keep metadata, bodies, and reactions consistent.
- A process or host crash can still interrupt the cross-resource sequence, but the next startup repairs recoverable states and reports unresolved divergence.
- Orphan artifact bodies are not deleted automatically; destructive reconciliation requires an explicit future decision.
- SQLite plus local storage remains intentionally single-writer and tied to a persistent volume. Horizontal multi-writer deployment would require revisiting this decision.

