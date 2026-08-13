# Goal 0046 — Schema evolution: rename/retype/delete without breaking history

Owner-raised 2026-08-13 from a real incident on a commercial
decision-automation platform used in regulated enterprises: its
attribute schemas map to physical database columns, so renames are
forbidden, deletes are undocumented soft-deletes, a mis-chosen field
type is permanent, and — because workflows reference the single LIVE
decision definition rather than a version — retiring one decision
required manually clearing references across ~30 historical workflow
versions. Research pass delivered same day (agent-run, primary
sources: Camunda DMN versioning, Confluent Schema Registry
soft/hard-delete + compatibility modes, Avro/Protobuf evolution
rules, event-sourcing upcasters, expand/contract migrations; full
report in the session transcript, verdicts summarized here).

## Verified Mill baseline (from code, not assumed)

- SAFE ALREADY: workflow-owned `Attributes` freeze into each
  published `WorkflowVersion` (ADR-0021 `SnapshotHead`); run history
  stores attribute values schema-on-read (`map[string]any` in the
  run's own JSON), so live-schema edits can never corrupt old runs.
- THE GAP: Configure entities are live-referenced. A
  `decision-outcome` node stores only `decisionId` and resolves
  against the CURRENT `Decision.Outputs` on every execution — even
  when the workflow itself is version-pinned. `DeleteDecision` has no
  reference-integrity check (dangling IDs fail at run time).
  `typedfield.Field.Key` is simultaneously identity and name (a
  rename is structurally delete+add); `Field.Label` exists but isn't
  the guaranteed-renamable surface. Same live-reference class:
  `requestId`/`listId`/`mcpServerId` (ADR-0009 RefKinds).
  `.claude/rules/node-standard.md` already names the sibling gap for
  `NodeType.ConfigFields` (latent, not built).

## Design direction (research-backed sketch — the ADR this goal opens
with decides it; not pre-resolved here)

1. Identity/label split: `Field.Key` immutable after first save
   (enforcement precedent: `Decision.Category`'s existing
   server-side immutability), `Label` freely renamable — Protobuf
   field-number / Avro-alias insight, near-free since both fields
   exist.
2. Retype: never in place (no adopted system allows it); "add new
   field + deprecate old" as the guided path, optionally a narrow
   safe-promotion set.
3. Delete: tombstone-not-drop for schema fields, reusing
   `internal/services/seeding`'s existing tombstone mechanism; hard
   delete of a referenced Configure entity blocked or made soft.
4. Shared-entity versioning: give `Decision` the same
   Versions/Publish shape `Workflow` already has (ADR-0021 applied
   to a second entity type), with an optional pinned-version config
   on `decision-outcome` (precedent: `child-workflow`'s `version`).
5. Stamp the resolved definition version onto each run record
   (precedent: `runInput.Version`) — the audit-replay guarantee
   ("what did this decision look like when this run executed")
   preserved exactly, without freezing the live definition.

## Acceptance (checkable)

- [ ] An ADR decides the rename/retype/delete/versioning semantics
      (the sketch above is its input, not its conclusion), including
      which parts apply to ALL RefKind entities vs. Decision first.
- [ ] The decided semantics implemented with the standing proof
      discipline (unit + seeded-example + e2e per testing.md's
      layering), including a regression proving a version-pinned
      workflow resolves the pinned definition after the live one
      changes.
- [ ] Reference-integrity at delete time: deleting a still-referenced
      Configure entity is blocked or soft per the ADR — never a
      run-time-only failure.
- [ ] SPEC.md updated (the typed-system section gains the evolution
      semantics; any OPEN it resolves is surfaced first).
