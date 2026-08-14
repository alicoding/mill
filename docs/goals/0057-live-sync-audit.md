# 0057 — Live-sync audit: no surface ever needs a reload

**Raised:** 2026-08-14, owner-directed after hitting the runs-panel
staleness live ("the problem is that it is not real time — why do we
have to reload our app ever in any part; can we now look at other
parts of the app to make sure we don't have similar issues").
Queue position: ahead of 0052 (owner-picked by asking now).

## The bug class this generalizes

The runs-panel instance (fixed in its own PR, with regression test
`TestRunWorkflow_EmitsRunDataEventOnStartAndCompletion`): a surface
fetches once on mount, stays mounted across tab switches, and relies
on `mill-data-changed{entity}` to refresh — but one or more mutation
paths for that entity never emit. Result: data a user watches goes
stale, or appears empty, until a full app reload. Goal 0017
established the event and swept the then-known surfaces; this goal
audits systematically instead of waiting for the next live hit.

The principle (goal 0017's, now stated as the app-wide invariant):
**a user must never need to reload Mill to see the current state of
anything the app displays.** Every displayed collection/state either
(a) subscribes to the entity events its data derives from, with every
mutation path emitting them, (b) deliberately polls (the in-flight
run detail's honest-only-path pattern), or (c) is provably immutable
for the session. Anything else is a gap.

## Plan

1. **Inventory (delegated, read-only):** complete matrix of
   emitters (`dataevent.Emit` + other Go→frontend events), frontend
   `Events.On` subscribers, fetch-once-no-subscription components,
   and mutating service methods without emits.
2. **Judgment pass (main session):** classify every candidate as
   real gap / deliberate poll / session-immutable, recorded in this
   file. Surfaces where the entity string doesn't exist yet get one
   named (the dataevent entity vocabulary is the contract).
3. **Fix the real gaps** — emits at mutation chokepoints (the
   runs-panel fix's shape), subscriptions where a panel listens to a
   subset of its entities; each fix carries a TestHook-seam
   regression test per testing.md. Cluster into one PR if small,
   or per-surface PRs if not.
4. **Prevention:** extend the goal-0017 per-service emit-test
   pattern to any mutating service that has none, so a future
   mutation path can't land emit-less unnoticed. No new framework —
   the dataevent seam already exists; this is coverage, not
   machinery.

## Acceptance (checkable)

- [ ] The inventory matrix (or a distilled gap table) is recorded in
      this file, every fetch-once surface classified as
      gap / deliberate-poll / session-immutable with a reason.
- [ ] Every classified gap is either fixed (emit + subscription +
      regression test at the TestHook seam) or explicitly rejected
      with a reason recorded here.
- [ ] Every mutating service package has emit coverage in its tests
      for the methods that mutate displayed state.
- [ ] No surface in the app requires a reload to reflect a mutation
      Mill itself performed — spot-checked live on at least the
      surfaces the inventory flagged most suspicious.
