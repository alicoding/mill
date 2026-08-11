# 0017 — Real-time surfaces audit: never make the user refresh

## Goal
Owner-stated product value (2026-08-10): "everything should be
real-time — the user should never have to come in or reopen anything."
SPEC §1 now locks it. This goal is the AUDIT + fixes: find every
surface that can show stale state requiring a manual refresh/reopen,
and close each gap via the existing event layer (no new mechanism —
§0005's unified eventing is the substrate).

## Audit targets (enumerate, then fix)
Read every view/panel and ask "if X changes elsewhere, does this
update live, or only on remount/refetch/reopen?":
- Workflows/Configure inventories (do they refresh on mill-data-changed
  when an entity is created/edited/deleted — incl. via MCP author?)
- A workflow's Runs tab (updates as a run progresses/completes without
  reopening the tab?)
- Activity feed (already event-pushed — confirm complete)
- Review queue (currently a 2s poll — is that "real-time enough", or
  should it consume guardrail-pending-changed and drop the poll?)
- Version badges / lifecycle state on list rows (update when Publish
  happens in another tab?)
- The value-mirror/Home stats (goal 0014) when it lands — live counts
- Cross-tab: edit an entity in one work tab, does a picker referencing
  it in another tab see the change?
- The build-staleness badge (§3.8) — already the "am I current" signal

## Approach
1. Systematic audit (an explorer/read pass) producing the stale-gap
   list with file:line per surface.
2. Fix each via mill-data-changed / guardrail-pending-changed
   subscriptions (the pattern App.tsx + MCPWriteApprovals already use)
   — never a new bus, never polling where an event exists.
3. Where a poll is genuinely the honest choice (an external resource
   Mill can't get an event for), document why.

## Acceptance
The owner can: create/edit/delete an entity in one place and see it
everywhere live; watch a run complete on its Runs tab without
reopening; have an MCP author change something and see it in the open
window — with no manual refresh anywhere, and any remaining poll
justified in writing.
