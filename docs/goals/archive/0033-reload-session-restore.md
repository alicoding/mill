# 0033 — A hard reload should never cost you your place

## Goal
Owner-observed 2026-08-12, live: on a real workflow (`Example: Echo
message (callable child)`, mid step-mode debug pause, tab 3 of 3),
⌘⇧R — the native Chromium hard-reload, deliberately left untouched as
a debug escape hatch (`settingssvc/settingsservice_menu.go`'s own
comment) — discarded the open tab and landed on Home instead. Root
cause confirmed: Mill's hash routing (`main.tsx`) only distinguishes
separate *windows* (`#/quickpanel`, `#/approvalprompt`); the main
window's active sidebar page and open work-tabs live purely in
in-memory Zustand state (`shared/store.ts`), never reflected in a URL
— so a reload has nothing to read the prior view back from and falls
to the hardcoded default.

**The owner's sharper framing, worth recording as a standing
principle, not just this fix:** §1's locked "everything is real-time"
thesis (the exact subject of tonight's goal 0017) means a user should
never *need* to hard-reload "just to make sure" — that instinct is
itself a symptom of the realtime guarantee not being fully trusted
yet. This goal's practical scope is the fallback for when a user does
it anyway (debugging, habit, paranoia): don't cost them their place.

## Plan
1. [x] Reflect current view + active/open work-tabs in localStorage
   (App.tsx already has the precedent: `SIDEBAR_OPEN_STORAGE_KEY`/
   `COLOR_MODE_STORAGE_KEY` -- same tier, same pattern). Research
   finding, not assumed: `view` + the restorable work-tab list were
   ALREADY persisting this way (`shared/store.ts`'s zustand `persist`,
   key `mill-app-view`, built earlier as part of the app-wide work-tab
   strip) -- the actual gap was narrower than the plan first assumed:
   `activeWorkTabKey` was deliberately excluded from persistence ("the
   active key isn't persisted: landing on the section page... is the
   less surprising restore" -- the prior design's own comment). Fixed
   by persisting `activeWorkTabKey` too, filtered through the same
   `isRestorable` rule the tabs themselves use
   (`shared/store.ts`'s `partialize`), via a new shared pure helper
   (`shared/workTabs.ts`'s `activeKeyIfPresent`).
2. [x] Restore on boot: `restoreWorkTabSnapshot` (new,
   `shared/workTabs.ts`) resolves the persisted active key against
   whatever tabs actually survived restoration -- a key with no match
   degrades to `null` rather than dangling. A workflow/request deleted
   since the snapshot was taken degrades gracefully one step later,
   once the real lists load (`pruneWorkTabs`'s existing effect,
   refactored onto the same shared `pruneStaleWorkTabs` helper so the
   "clear the active key if it pointed at exactly the dropped tab"
   rule can't drift between the two call sites). All this already
   worked correctly for `view` and for the tab LIST; only the active
   selection needed the fix.
3. [x] SPEC §1 gets a line naming this principle explicitly: the
   realtime thesis's completion criterion includes "a user never
   needs ⌘⇧R as a trust ritual" -- goal 0017 is the real fix for
   that; this goal is the safety net for the residual ⌘⇧R use goal
   0017 doesn't eliminate (a genuine dev/debug reload, not a distrust
   reload). §3.7/§3.8 also updated (stale `persistedTabs.ts` reference
   corrected, the superseded "restored inactive" behavior documented
   as changed, full before/after in a new §3.8 Update block).

## Acceptance
Hard-reloading mid-session (any sidebar page, any open work-tab)
restores the same page and the same open tabs on boot -- never dumps
the user back to Home. A never-been-used app (fresh install, no
snapshot) still boots to Home correctly, unaffected.

**Delivered 2026-08-12.** Verified: unit tests
(`frontend/src/shared/workTabs.test.ts` -- `activeKeyIfPresent`,
`restoreWorkTabSnapshot`, `pruneStaleWorkTabs`, 8 new cases covering a
valid snapshot, a stale/unmatched active key, the legacy-migration
fallback, and prune-time graceful degradation); e2e
(`frontend/e2e/state-persistence.spec.ts` -- the two existing
single-tab tests updated to assert immediate re-activation with no
click needed, a new multi-tab test reproducing the exact incident
(several tabs, a specific one active, reload, same one active again,
Home never shown), and a new explicit fresh/cleared-storage-still-
boots-to-Home regression guard for goal 0019's original concern); full
local gate (go vet/test/build ×2, golangci-lint, eslint, boundaries,
vitest, tsc) green.
