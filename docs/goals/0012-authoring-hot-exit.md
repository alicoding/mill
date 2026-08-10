# 0012 — No data loss on quit/close: hot-exit for authoring state

## Goal
Owner requirement (2026-08-10, raised after ⌘⇧W closed the last
window mid-session — which exits the app — and with ⌘Q named
explicitly): quitting or closing Mill must never lose work.

## Scope split (what's already safe vs the gap)
- Already safe, no work: everything executed (DBOS-durable runs,
  parked approvals, ADR-0026's interrupted-step parking) and
  everything saved (workflows/entities/settings persist on save).
- THE GAP: unsaved authoring state — in-progress canvas edits (the
  per-tab in-memory store; work-tab restore reopens tabs but reloads
  saved content) and half-filled Configure create/edit forms
  (deliberately not restored today, §3.7).

## Design direction (VS Code's hot exit, not nag dialogs)
1. Canvas edit state persists continuously (localStorage, keyed per
   workflow id / new-workflow tab key; debounced; cleared on Save or
   deliberate tab close via its ✕). On relaunch, a restored dirty
   canvas shows a visible "unsaved changes restored" indicator —
   never ambiguous that it's uncommitted work. Save semantics
   untouched (draft = deliberately saved head; live-run still runs
   the saved draft).
2. Configure forms: same treatment second (lower value, same
   mechanism).
3. Optional belt-and-suspenders (decide at build): a native
   quit-guard when dirty state exists — likely unnecessary once hot
   exit works; VS Code ships without one.
4. Interacts with task #13 (recorder suspending menu accelerators) —
   different bugs, same incident; both together mean a reserved
   combo mid-recording can no longer cost anything.

## Acceptance
Kill Mill (⌘Q, window close, or kill -9) with a dirty canvas and a
half-typed form; relaunch: the edits are back, visibly marked
unsaved; Save works; deliberately closing a tab still discards its
scratch state (explicit choice preserved).
