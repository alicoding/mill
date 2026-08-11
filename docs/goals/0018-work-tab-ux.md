# 0018 — Work-tab strip UX (owner: "not loving the tab UI")

## Problem (2026-08-10, live testing, screenshot)
The app-wide work-tab strip (SPEC §3.8, `app/WorkTabShell.tsx`) is
accumulating one tab per opened entity and **wrapping onto a second
row** (Settings + 5 example/workflow tabs + "New workflow •" spilled to
line 2). Owner: "I'm not loving the tab UI." Concrete failure modes:
- Wrapping to multiple rows looks broken and eats vertical space.
- Tabs pile up (every example you peek at stays open) with no eviction
  and no quick "close others / close all".
- No in-place way to *navigate between* tabs — owner pressed ⌘1-4
  (which switch pages, not tabs) and had to leave for Settings to learn
  ⌃Tab exists. (This half is answered by the ⌘K palette, goal 0015 —
  tab switch/close by name belongs in the palette.)

## Direction — DECIDE with owner before building
Industry precedents (VS Code, browsers, Zed): tabs never wrap — they
**overflow** (horizontal scroll + an overflow ⌄ menu listing hidden
tabs), and there's a right-click/⌥-click "Close Others / Close All / Close
to the Right". Some editors add a soft LRU cap. Options captured for the
owner's taste call; not locked here.

## Ties
- ⌘K palette (0015) owns tab *navigation/close by name* — the
  self-unblock surface. This goal owns the *visual strip* behaviour
  (overflow vs wrap, close-others, eviction).

## Status — pile-up fix BUILT (2026-08-10)
Owner picked "Just the pile-up." Built: `.tabList` nowrap + overflow-x
scroll (no more second row); a pinned `⌄` overflow menu (2+ tabs) beside
the scrolling list = jump-to-any-open-tab-by-name + Close other tabs +
Close all tabs (`closeOtherWorkTabs`/`closeAllWorkTabs` store actions).
SPEC §3.8 updated in-change. Remaining, not yet built: right-click
context menu on a tab (the ⌄ menu covers the same actions for now);
open-on-demand tightening if peeking still leaves tabs.

## Acceptance
Owner opens six things and the strip stays one tidy row with an overflow
menu, can close-others in one action, and never has to leave the page to
learn how to move between tabs.
