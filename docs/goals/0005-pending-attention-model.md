# 0005 — Pending-attention model: missed approvals, notification center vs Activity vs Review

## Goal
One coherent model for "something wants the owner's attention," raised
directly from the live MCP dogfood (2026-08-10): the per-write MCP
approval card is ephemeral (120s bounded wait, ADR-0022's MCP half) —
timeout = deny, nothing written, the client can re-send — but a missed
card leaves **no trace anywhere** (no Activity row, no "you missed a
request from <client> at <time>"), unlike workflow-run approvals,
which park durably in the Review queue for 24h. Owner's framing,
verbatim in spirit: notification center vs Activity have overlapping
capability but serve different purposes — research the pattern before
designing.

## Research questions (Research → Plan → Implement; do NOT skip to design)
1. **Can the two ask-mechanisms converge?** The MCP spec's Tasks
   extension (2026-07-28) exists because hosts don't tolerate
   unboundedly-blocking tool calls — check whether a timed-out write
   request can become a durable pending item (same Review queue,
   client polls task status instead of blocking). If yes, "MCP write
   approval" stops being a second, weaker approval mechanism and the
   Review queue becomes the ONE pending-items store.
2. **Three-surface split** — Review queue (durable actionable),
   Activity (historical log), notification center (attention routing
   over both). Research real precedent: GitHub notifications vs its
   PR-review queue; Slack's unreads vs threads; macOS Notification
   Center's grouping/expiry; n8n's execution list (it has no
   notification center — why not, and does that matter at Mill's
   scale?). SPEC §3.7's open "trigger-fire notifications" item (Wails3
   ships a first-party notifications service, zero new dependency)
   belongs to this design, not a separate one.
3. **Minimum honest fix independent of the big design**: every
   expired/denied-by-timeout MCP write request should leave a record
   (an Activity row at least) — evaluate shipping this first as a
   bounded increment.
4. Sidebar pending-count badge (goal 0002's deferred item — needs a
   park/resolve event) is plausibly the same eventing this needs;
   check before building either separately.

## Research findings (2026-08-10) — the design collapsed to "consistency, not a new bus"
- **MCP Tasks: DON'T converge (verdict).** The 2026-07-28 extension
  (`io.modelcontextprotocol/tasks`, SEP-2663) exists but the installed
  go-sdk v1.7.0 has ZERO support (roadmap "experimental," issue #626
  unstarted), AND it needs the external calling client to opt in —
  which Mill (the server) doesn't control. Keep ADR-0017/0022's 120s
  bounded-wait-then-deny; revisit only when go-sdk#626 lands AND a real
  client Mill uses declares `tasks`. Item 3 (traceless timeout) is
  solvable TODAY independent of Tasks — one line at
  `millmcpservice_approval.go`'s timeout branch writes an Activity row.
- **The unified model = one uniform event, not a new abstraction.**
  Three of four attention-transitions already push Wails
  `app.Event.Emit` (`mcp-write-approval`, `mill-data-changed`,
  `hotkey-activity`); the FOURTH — guardrail park/resolve, the Review
  queue's own reason to exist — pushes nothing (only DBOS `SetEvent`).
  Fix: add `Emit("guardrail-pending-changed", {RunID, NodeID,
  Resolved})` at the four existing `SetEvent` sites in
  `executionservice_guardrail.go`; payload is a POINTER, receivers
  refetch (never trust the body — the GitHub/macOS "notification isn't
  the source of truth" precedent). Three surfaces subscribe to slices
  of ONE signal: Review queue (DBOS state = truth, event = refetch
  nudge), Activity (append every resolution incl. the MCP-write
  timeout — item 3), sidebar badge (count from the same event summed
  with `mcp-write-approval` — no polling).
- **0002 item 3's badge IS this event** — confirmed one build, not two.
- **VS Code severity rule adopted**: auto-dismiss informational, NEVER
  auto-dismiss something needing a decision.
- **Wails3 `NotificationService` confirmed present + unwired** (v3.0.0-
  beta.4, zero new dep, SPEC §3.7): OS notifications with live
  Approve/Deny action buttons + ThreadID grouping + InterruptionLevel
  severity — the real future for "attention while Mill unfocused,"
  gated on window-focus (don't double-noise). A bigger, separate scope
  than the badge fix; named, not folded in.

## Acceptance
An ADR records the model (converged or deliberately split, with
reasons and precedent); at minimum, a missed MCP write request is no
longer silently traceless; the notification-vs-Activity-vs-Review
boundary is written down in SPEC with each surface's one-line job.
