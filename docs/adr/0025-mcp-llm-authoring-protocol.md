# ADR-0025: The MCP LLM-authoring protocol — introspect, validate, mutate, run, live-sync

## Status
accepted

## Context

The export/import MCP tools (ADR-0017) were built with a stated intent:
a protocol for an external agent to manage the user's Mill data. The
owner named the goal directly: an LLM (via an MCP host like Claude
Code) should be able to make changes to the app in real time —
workflows authoring and configuration both — and judged the design "in
action, not on paper": clean seams must make later policy changes
one-line flips, or the architecture is wrong.

§1.1's lock holds untouched throughout: Mill is the MCP **server**;
the LLM's host drives it. Mill never becomes an LLM client.

## Decision

Four tool tiers over ONE document format — the export/import JSON that
already existed (`exportedWorkflow`), reused as the update wire shape
so there is exactly one protocol:

| Tier | Tools | Gate |
|---|---|---|
| Introspect | `list_node_types` (the authoring vocabulary: IDs, config fields, effect classes), `list_runs`, `get_run` (per-step results incl. guardrail verdicts) | none — read-only |
| Validate | `validate_workflow` (ResolveNodeDefaults + ValidateGraph, saves nothing, returns the exact error) | none — pure |
| Mutate | `update_workflow`, `publish_workflow`, `delete_workflow` (+ the existing `import_*`) | write toggle + per-write approval with a **diff summary** ("nodes 3→4, edges 2→3, rename to …") — the PreToolUse preview applied to authoring |
| Run | `run_workflow` (test kind — executes the draft, same as the UI Run button) | write toggle; the **guardrail engine is the run's own approval layer** — external-effect steps park in the human's Review queue regardless of who started the run |

**Auto-snapshot-before-write replaces never-overwrite.** Every
`update_workflow` snapshots the current draft as an immutable version
first (`SnapshotDraft`, ADR-0021's machinery) — anything the LLM does
is one "load into draft" away from undone. A stronger safety story
than forbidding updates, and it makes the Versions tab the LLM-change
audit log for free.

**Live sync**: every mutation emits a `mill-data-changed` event
(entity + id); the open window's stores refresh immediately. §1's
what-you-see-is-what-I-see thesis running in both directions — the
human watches the LLM's changes land as they happen.

**`resolve_approval` is permanently excluded by design, not
omission**: an LLM approving its own guarded runs (or its own writes)
collapses the guardrail. Approvals are human-only surfaces (Review
queue, the MCP-write banner), forever.

**Secrets stay categorically human-only** — unchanged from ADR-0007/
0017: no tool reads or writes a secret; imports never carry them.

## The one-line-flip check (the owner's architecture test)

- Concurrent-edit reaction: entirely in App.tsx's `mill-data-changed`
  handler — refresh vs. warn vs. block is frontend policy on one event.
- Approval granularity (per-write vs. a time-boxed session grant):
  entirely inside `awaitWriteApproval` — one function.
- Tool inclusion/exclusion: one `mcp.AddTool` registration each.
- Update semantics (whole-document vs. patch): one function
  (`UpdateWorkflowFromExport`) behind the same tool signature.

## Consequences

- Proven end to end by `TestMCPAuthoring_FullLoop`: a real MCP client
  over real HTTP against real DBOS — introspect → validate (bad graph
  named; good passes) → gate refusal while off → import → update (auto-
  snapshot verified) → run (the *updated* definition executes) →
  `get_run` → delete.
- Configure-entity update/delete tools (requests/lists/mcpservers) are
  a mechanical extension on the same seams — deliberately deferred
  until authoring workflows in action shows the shape is right.
- `run_workflow` uses the test kind (draft head) — a distinct "mcp"
  RunKind is a one-line flip later if run provenance needs surfacing.
