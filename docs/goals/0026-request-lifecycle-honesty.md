# 0026 — Request lifecycle honesty: withdrawal + staleness

## Goal
A pending decision never lies about its relevance (owner-observed
2026-08-11: a 4-hour-old test write sat in Review looking as urgent as
a fresh ask — "feels like I missed something / it's not working").
An actionable item must carry its freshness, and the requester must be
able to take back a request that stopped mattering.

## Plan
1. [ ] **`cancel_write` MCP tool** (the missing fourth verb —
   park/poll/resolve/WITHDRAW; `tasks/cancel` in the MCP Tasks spec is
   the direct precedent ADR-0032 already mirrors): the requesting
   client cancels its own still-pending write by id; cancelled ≠
   denied (a distinct outcome, recorded in Activity like
   denied/expired — never traceless). Ungated (cancelling your own
   request needs no human approval; it only ever REDUCES pending
   work). At-most-once semantics shared with resolve.
2. [ ] **Staleness presentation** in Review + banner + floating
   prompt: age-tiered treatment (fresh <15m renders as-is; older gets
   a visible age emphasis + "expires in Nh" from the 24h clock) — the
   §1 thesis applied to time-honesty of asks. No auto-dismiss of
   actionable items (the VS Code severity rule holds; expiry is the
   only terminal timer).
3. [ ] **Requester liveness hint** (design question, research first):
   should a pending write surface "requester last polled Nm ago" —
   check_write_status calls are the natural heartbeat — so an
   abandoned request is visibly abandoned? Cheap to record; decide
   presentation against the no-noise bar.
4. [ ] Session-side hygiene rule for THIS workflow (rides the memory,
   not Mill): a test write parked for demonstration gets cancelled by
   its requester when the demonstration ends.
5. [ ] **Badge staleness on write resolution (BUG, diagnosed live
   2026-08-11)**: ResolveMCPWrite (and the expiry sweep) never emits on
   the pending-changed channel, so the sidebar badge held a phantom 1
   against an empty queue — resolution paths must ping the same ONE
   signal parks do (goal 0005's model, missing emit).
6. [ ] **Resolved writes appear in Review's Recently-resolved** — today
   a denied/approved/cancelled write vanishes from Review entirely
   (only trace: session-only Activity, gone on restart). The queue's
   own history must include write resolutions, durably (the persisted
   24h outcome records already exist — surface them).
7. [ ] **Activity MCP-write rows get actions**: expandable detail +
   jump-to-the-target-workflow (runs already drill down; writes are
   action-dead — owner: "so what I can do and nothing I can do").
8. [ ] **Stuck-ENQUEUED runs surface honestly** (a run enqueued-forever
   reads as live; found: a zombie ENQUEUED run from a morning error) —
   age-visible like item 2, plus a Stop affordance where cancel is
   legal.

## Acceptance
A parked-then-obsolete request can be withdrawn by its requester and
shows as cancelled in Activity; a lingering pending item visibly
communicates its age and time-to-expiry; the owner never again reads
staleness as breakage.
