# 0015 — Summon quick-invoke: the palette that teaches you to skip it

## Goal
Owner-endorsed (2026-08-10) as the value mirror's companion (goal
0014): a command-palette quick-invoke — "super useful when you want a
quick trigger and don't remember which key, and it shows you that
next time you can do this instead," plus the standard personalization
pattern (frequently-used float up, pinned, configurable).

## Design direction
- **⌘K in-window palette** (industry-standard) built on Primer's
  `FilteredActionList` — already named in .claude/rules/frontend.md
  as "fits a command-palette-style picker," unused until now. The
  §3.7 OS summon hotkey opens the window INTO the palette.
- Each row: workflow + its **trigger identity inline** — the
  assigned hotkey combo (the Raycast education loop: the palette is
  the on-ramp, the hotkey is the destination), armed state for
  schedule/watch, "callable" demoted. Enter = the same run semantics
  as the list-row Run (test kind; consistency over cleverness).
- Pending-review count surfaces in the palette (goal 0005 tie-in).
- **Frecency + pins**: frequency/recency ranking from local run
  history — THE SAME substrate as goal 0014's value mirror (one
  usage-stats capability feeds both; build it once). Pinned
  workflows float; personalization config lives with 0014's
  preferences (per-workflow minutes-saved, notification opt-ins).

## Sequencing
Pairs with 0014; the shared usage-stats read layer is the common
prerequisite — whichever of the two goals goes first builds it.

## Owner reinforcement (2026-08-10, live testing) — discoverability is THE point
Owner hit the exact gap this closes: pressed ⌘1-4 (pages), wanted to
switch TABS, had no idea how, and had to LEAVE the page and dig through
Settings to find out. The principle: **unblock yourself in place** —
the palette must be the "how do I do X / what's possible here" surface,
not just a runner. Concrete requirements this adds:
- **Every command row shows its shortcut inline** (⌘K → type "tab" →
  see `Next tab · ⌃Tab` without leaving the page). The palette IS the
  in-place shortcut reference, doubling as the ⌘? "keyboard help" the
  owner also asked for — bind ⌘? (and/or ⌘/) to open it too, or open a
  shortcuts-focused view.
- Palette contents = commands (with shortcuts) + workflows (run) + tab
  navigation (switch/close a specific open tab by name — directly
  addresses the tab-UI friction below) + Configure entities.
- Ties to SPEC §1's real-time/self-service ethos: never make the user
  leave to learn how to do the thing they're mid-doing.

## Acceptance
Owner summons, types three letters, runs a workflow — and the row
they picked showed them the hotkey they'll use instead next time;
their most-used workflows are already at the top without configuring
anything.
