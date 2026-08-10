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

## Acceptance
An ADR records the model (converged or deliberately split, with
reasons and precedent); at minimum, a missed MCP write request is no
longer silently traceless; the notification-vs-Activity-vs-Review
boundary is written down in SPEC with each surface's one-line job.
