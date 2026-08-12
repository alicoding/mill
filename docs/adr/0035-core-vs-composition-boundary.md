# ADR-0035 — The core/composition boundary: capabilities arrive as composition

Status: accepted (owner-mandated 2026-08-11 — "worth aligning on the
principle more explicitly"; evidence base: the goal-0027 audit, same
night).

## Context

Hours after SPEC §9.5 wrote down the kernel/extension contract, we
violated it: cross-device notification shipped as a Settings toggle
wired to a private send path (`ForwardPendingApproval`) instead of a
connector + trigger composition — n8n's communication *node* built as
a preference checkbox. The owner caught it from the UX alone ("this is
incorrect way of working... it should have been a connector"). The
audit then found exactly one sibling (the OS-notification delivery
half of `NotifyPendingApproval`) and confirmed everything else
currently wired is legitimate kernel chrome — the boundary is
recoverable cheaply now, and expensive later.

## Decision

**1. The decision test, applied before building ANY capability:**
*is this a node, a trigger, a connector — or a true kernel change?*
If a user could plausibly say "I want that, but to a different
channel / with a condition / on a different event," it is
composition-shaped and MUST arrive as composition: a self-registered
NodeType, a trigger event, or a Configure entity — never a bespoke
service path plus a Settings toggle. Settings toggles configure the
kernel; they never implement side effects.

**2. The protected kernel (changes require an ADR):** the graph
engine + validation; the guardrail gate + effect classes; durable
execution (ADR-0004/0008/0021/0026 boundaries); the registries and
injected-lookup seams (ADR-0006/0009); the Configure-entity recipe;
the MCP plane (ADR-0025/0032); the attention *presence* logic
(isAway/idle — session state, not deliverable); app chrome (badges,
panels, navigation, Activity/data-changed refetch signals). §9.5's
list, now with an explicit stability bar. Everything else is
composition space.

**3. The two contracts (owner's own framing):** platform-internal
behavior MAY and SHOULD consume the same composition surface — as
built-in, seeded, fully-editable workflows (inspectable, guarded, in
Runs) — the app dogfooding its own platform. What the platform never
does is hand-roll a parallel mini-pipeline for something the surface
can express. Connector/credential reuse follows automatically: one
Configure entity, 1:many, exactly the existing model.

**4. System-event triggers unparked** (§3.4's parked row; its stated
blocker — §7's engine — landed long ago): a `trigger-system-event`
family. Emission points confirmed by audit: decision-parked/resolved
already emit (`executionservice_guardrail.go:227,239,245,250` — as
refetch signals to be upgraded to typed events);
run-completed/failed/cancelled DO NOT exist yet (the completion
paths in `executionservice.go:361`, `triggerservice.go:227-233`,
`executionservice_cancel.go` return/log without emitting) — real
plumbing, routed through the single execution path. **Loop rule,
enforced at the emission site**: a run whose own trigger is a
system-event never emits system events for itself (n8n's Error
Trigger one-level precedent) — built in from day one, not discovered.

**5. The forward refactor is the proof**: `ForwardPendingApproval`'s
private path is REPLACED by a seeded, editable workflow
(decision-parked → integration-http via a user-picked connector);
the OS-notification delivery becomes the same event's second
composed consumer. The Settings section shrinks to kernel config
(the idle threshold) plus, at most, a shortcut that opens/authors
the workflow. Acceptance: the next channel (Discord/Telegram/
Twilio) is connector config with zero new Go.

## Consequences

- Feature cost collapses toward "an adapter or a connector entry" —
  the owner's stated bar ("not taking days to build when it is just
  adapters/plugin").
- The decision test enters CLAUDE.md/rules as a standing check with
  the forward toggle as the recorded counterexample.
- Known hazards carried into the build: silent mount-effect RPC
  failures in Settings get visible error states (the audit's
  robustness finding); the DEV·live badge's Go-liveness blind spot
  (task #6) rises in priority after claiming its second scalp
  (the owner's "untogglable" report was a 15-commit-stale binary).
