# 0001 — Authoring-surface overhaul

## Goal
The workflow editor looks and feels designed, not accreted — judged
live by the owner against their own reference prototype (the style
elements recorded in `docs/SPEC.md` §3.8's authoring-surface
direction). Direct critique (2026-08-10, screenshots): default zoom
too close, systemic spacing issues, palette poorly grouped/represented
with inconsistent label conventions, and no per-node maturity story.

## Plan
Increment 1 (delivered 2026-08-10, this repo's commits): fit-zoom
capped at 100%; single-line inputs by default with a typed
`ConfigField.Multiline` for real documents; palette casing unified +
card-style items + small-caps kind headers; canvas cards carry the
prototype's small-caps taxonomy label.

Remaining, in order:
1. Typed payload visibility on cards (the prototype's
   `Output TypedPayload<...>` line) — needs a per-node-type declared
   output description first (small Go addition, honest not invented).
2. ~~Live run state on the canvas~~ **delivered 2026-08-10** — canvas
   Run button, per-card status tags/coloring, CURRENT STEP bar with
   inline Approve/Deny, mount-time adoption of parked runs
   (`liveRunState.ts`/`LiveRunControls.tsx`, SPEC §3.8's Update).
3. Node maturity plan — audited 2026-08-10 (all 18 types), worked
   top-down from here:

   | Node type | Maturity | Named gap |
   |---|---|---|
   | ruleset | ~~v1~~ **mature** (delivered 2026-08-10) | now uses the SAME react-querybuilder + ruleTranslate visual builder as Decision edges, with the raw-expr fallback — the two-condition-surfaces inconsistency is closed |
   | mcp-tool-call | ~~v1~~ **mature** (delivered 2026-08-10) | MCPToolArgsEditor: live tool Select via ListMCPServerTools + typed fields from the tool's InputSchema (attr: bindings resolve typed at run time); plain-text/raw-JSON fallback when the server is unreachable; e2e via a local fixture MCP server |
   | human-review | ~~v1~~ **mature** (delivered 2026-08-10) | "Ask for these attributes" config names a subset (comma-separated keys; empty = all); Review renders only those |
   | trigger-schedule | ~~v1~~ **mature** (delivered 2026-08-10) | Inspector shows a live cronstrue human-readable preview (MIT, zero deps); invalid expressions flagged inline |
   | list-lookup | ~~v1~~ **mature** (delivered 2026-08-10) | explicit "If no match" option: fail / continue / default (with a default value); legacy nodes default to fail, unchanged |
   | capture-clipboard-html | ~~v1~~ **mature** (delivered 2026-08-10) | falls back to plain text when no HTML flavor (SPEC §5 order); DOM-read tier still needs the browser bridge |
   | trigger-filesystem-watch | ~~v1~~ **mature** (delivered 2026-08-10) | optional filename glob (*.md); the changed path is now delivered as the trigger payload |
   | integration-http, child-workflow, decision-route | mature | — |
   | triggers manual/hotkey/callable/clipboard-watch, capture-attribute, process-html-to-markdown, process-inject-text, apply-write-html/text | adequate | zero-config or single-field; nothing missing for their scope |
4. Spacing audit of the editor chrome (toolbar, Inspector paddings,
   palette panel) against Primer spacing tokens.

## Acceptance
Owner reviews the running app and says the authoring surface matches
the prototype's feel — explicitly a live judgment, not a checklist
(their stated review mode: "the only time I can see if it matches is
when I see it in action").

## Design wave 1 — delivered (2026-08-12)

A full-app design audit (screenshots, both themes, every top-level
surface + every Configure tab) found seven unambiguous convention
violations/bugs — zero taste decisions, so filed as a same-session
wave under this goal rather than a new one; the taste-layer pass (a
wave 2) stays a separate, later piece of work. This goal itself stays
OPEN — the audit was app-wide, not the authoring-surface-specific work
above (spacing audit, node-maturity plan) this file otherwise tracks.

1. **Sidebar Settings row** (`app/AppSidebar.tsx`): the footer gear was
   a floating, centered `IconButton` with no keyboard/aria parity with
   the capability `NavList` rows above it and no active-state
   highlight. Now a real `NavList.Item` (same shape/treatment as every
   other row), still anchored bottom via the existing flex-spacer
   layout. `docs/SPEC.md`'s §3.5 sidebar-restructuring note updated to
   match.
2. **Command palette** (`app/CommandPalette.tsx`): fixed
   `max-height: min(60vh, 480px)` with internal scroll (the search
   input stays anchored; FilteredActionList's own active-descendant
   scrollIntoView already handles keyboard nav once a real scroll
   region exists — no new JS needed). Rest state (empty query) now
   shows a bounded set — the "Go to `<capability>`" nav commands +
   Settings, plus the ~5 most-frequently-run workflows
   (`workflowFrecency.ts`'s existing `sortWorkflowsByFrecency`, the
   same substrate `QuickPanel.tsx` already uses — no new recency
   infrastructure built) — instead of every command/workflow/tab
   unfiltered.
3. **Dark-mode bugs**: (a) the canvas minimap was React Flow's
   light-hardcoded default (`--xy-minimap-*-default`, gated behind a
   `.dark` class Mill's Primer-token theming never sets) — now themed
   via `MiniMap`'s own color props resolving Primer `var()` tokens at
   paint time (`composition/ThemedMiniMap.tsx`, split out once
   `CompositionCanvas.tsx` crossed the 500-line limit); (b) Settings'
   "Away after" number input rendered a solid white box in dark mode
   (a Primer `TextInput`, but `type="number"`'s native WebKit chrome
   doesn't reliably inherit `color-scheme` inside a Wails webview) —
   fixed via an explicit `color-scheme`/background rule targeting the
   real `<input>` (`shared/ListCard.module.css`'s `.themedNumberInput`,
   reusable for any future numeric `TextInput`); (c) React Flow's
   attribution link (kept — its license requires the credit) now
   legible-but-quiet in both themes via Primer tokens instead of its
   own hardcoded background/link color.
4. **ERROR pill color**: `ReviewView.tsx`'s "Recently resolved" status
   pill fell through to the neutral `secondary` variant for any
   non-SUCCESS status, including ERROR — losing the danger semantics
   the adjacent `denied` resolution pill already had. Every other
   ERROR/failed pill render site (`WorkflowRunsPanel`,
   `LiveRunControls`, `ActivityRunsExplorer`) was already correct;
   this was the one broken site.
5. **Key-combo rendering unified**: Settings' Keyboard Shortcuts list
   and a workflow's own hotkey-trigger row (`TriggerRowLabel.tsx`)
   both rendered a captured combo as bare text next to a Change
   button. `app/HotkeyHint.tsx`'s keycap-chip visual extracted into a
   dumb, reusable `shared/KeyComboChip.tsx` (shared/ specifically so
   `views/` and `composition/` can both render through it without
   depending on `app/`, which dependency-cruiser forbids) — now the
   one renderer for an already-formatted combo string everywhere.
6. **Redundant page headings**: every top-level page's h1 repeated its
   own sidebar/tab label; every Configure tab's h2 repeated its own
   tab label again. Fixed consistently: the 6 top-level page
   components (Home/Workflows/Configure's 7 tabs/Activity/Review/
   Settings/the generic not-built-yet placeholder) now render their
   descriptive subtitle copy AS the heading (promoted to the top, a
   smaller `variant="medium"` weight) instead of a separate duplicate
   title above it; the 6 Configure tabs with no subtitle copy of their
   own keep their heading (still needed for its `aria-labelledby` wiring
   onto the list/table region below) but visually hidden via Primer's
   `VisuallyHidden` rather than removed. `ConfigureAttributes.tsx` was
   the one Configure tab with real subtitle copy, so it follows the
   page-level pattern instead. Also fixed the tab-label mismatch this
   surfaced: Configure's Integration tab is now "Integrations" (plural,
   matching its already-plural siblings). Every e2e spec that asserted
   a removed h1's exact text now asserts the page's own
   `data-testid` instead (a more robust "which page am I on" check
   than a heading string that's now a full descriptive sentence).
7. **Runs-tab empty states** (`WorkflowRunsPanel.tsx`,
   `ActivityRunsExplorer.tsx`): both were a bare centered line of text
   for "no runs yet" — now a real `Blankslate` (icon + one-line
   invitation), the same pattern `ReviewView.tsx`'s "Nothing waiting
   for you" empty state already used.

Proofs: e2e/component assertions added where cheap per fix (palette
max-height + rest-state bound, Settings combo-chip font-family, ERROR
pill's `data-variant="danger"`, the sidebar Settings row as a real nav
link, both new Blankslate empty states); `e2e/dark-mode.spec.ts` drives
the real Settings dark-theme toggle and asserts computed
`background-color` for both the minimap and the number input, rather
than a manual-only note — Settings already ships a working dark-theme
`SegmentedControl`, so this was e2e-feasible, not desktop-only.

## Design wave 2 — delivered (2026-08-13)

The taste-layer pass named as a separate later piece in wave 1's own
note above: identity tokens across the whole app (not just the
authoring surface), driven by the same full-app design audit's
sections 1/2/6. Two sequential PRs; this is PR 1. Full detail in
`docs/SPEC.md` §3.8-area's new "Design system tokens" bullet — summary
here:

1. **Accent scale**: Mill's own desaturated verdigris/teal, layered
   over Primer's functional accent tokens (`app/mill-tokens.css`) so
   every Primer component reading them picks it up for free. Proven
   via a computed-style e2e test against the real compiled page after
   a same-specificity attempt first looked correct on paper and still
   lost the cascade.
2. **Node-Kind canvas colors decoupled from status semantics**
   (`composition/nodeKind.ts`): no longer aliased to Primer's shared
   `--bgColor-success-emphasis`/etc. — own fixed `--mill-kind-*`
   tokens, closing the audit's "green triple duty" finding (a
   `process`-kind node and a `success`-status pill used to be the
   literal same green).
3. **`shared/StatusStamp.tsx`**: one stamp component replacing 7 ad-hoc
   `<Label variant="...">` pill families (workflow live/draft/
   disabled, run SUCCESS/ERROR, guardrail approved/denied, built-in,
   trigger armed/not-live, run kind, dev-build identity) — five
   semantic variants only (`success`/`caution`/`danger`/`neutral`/
   `identity`). Primer `Label` stays for genuine categorization tags
   (auth type, field `In`/`Type`) — not a wholesale replacement.
   Two stray un-migrated key-combo sites found during the sweep
   (`NodeInspector.tsx`'s per-node hotkey editor, `SettingsView.tsx`'s
   global summon hotkey) now render through wave 1's own
   `KeyComboChip` too, closing a gap wave 1's commit message claimed
   was already closed everywhere.
4. **Mono utility** (`shared/monoText.module.css`): applied to MCP
   server commands, AI provider/Integration base URLs, run timestamps,
   ExecEnv directories, Decision output keys.

Proofs: `e2e/dark-mode.spec.ts` gained two new tests — one asserting
the real computed `--bgColor-accent-emphasis`/`--fgColor-accent`
values in both themes (the actual cascade-order regression this
caught), one asserting a rendered StatusStamp's computed color.
Existing suites green (196/196 e2e, full Go suite, vitest, tsc,
eslint, boundaries, check-loc) — 3 pre-existing timing-flake e2e tests
unrelated to this change (confirmed via isolated reruns, none touching
a Label/StatusStamp testid or variant). Screenshots: `scratchpad/audit/
*-after.png` (workflows list, Configure MCP Servers, Settings, light +
dark) for the owner's review against the `-light.png`/`-dark.png`
before-references from the original audit.

Goal stays OPEN — wave 3 (palette IA regrouping, Configure Attributes
tab conformance) is the second PR of this same design pass, and the
owner's own live sign-off (this goal's stated Acceptance) hasn't
happened yet.

## Design wave 3 — delivered (2026-08-13)

The second and final PR of the same design pass wave 2 opened, driven
by the same audit's sections 5 (palette IA) and its own follow-on
consistency findings. Full detail in `docs/SPEC.md` §3.8-area's three
new bullets — summary here:

1. **Node palette regrouped from 6 domain Kinds to 9 frontend display
   groups** (`composition/paletteGroups.ts`, all 29 registered
   NodeType IDs mapped, unknown-ID fallback + dev warn). Fixes the
   audit's finding that 14 of 29 node types shared one Kind
   (`process`), making the old Kind-grouped palette put AI/List/
   Integration/MCP/code-exec/child-workflow/human-review/ruleset all
   in one undifferentiated bucket.
2. **Palette label shortening fixed**: the generic strip-first-prefix
   transform (not a Kind-derived one) — the original wave-1 version
   silently failed to shorten most labels, since their real prefixes
   ("AI:", "Code:", "List:", "MCP:") don't match their Kind's own
   label word. Canvas cards and step chips keep the full label
   unchanged (no group context to shorten against there).
3. **Palette search added** (previously none) — matches both the
   shortened display text and the full underlying label.
4. **Configure → Attributes conforms to its 6 siblings' pattern**:
   `InventoryList` rows (each row IS a workflow) + `VisuallyHidden`
   heading, replacing the bare `<Select>` picker — supersedes wave 1's
   earlier exception for this one tab.
5. **Configure row-action icon-button consistency**: `PencilIcon`
   replaces the text "Edit" button across all 5 Configure `DataTable`
   tabs that still had one; `CopyIcon` for Decisions' Duplicate
   (matching `RequestSummary.tsx`'s existing precedent).

Proofs: `composition/paletteGroups.test.ts` (every registered NodeType
ID maps to a group, the Kind-fallback path for an unknown ID, the
label-shortening transform across every real label in the app);
`e2e/node-palette.spec.ts` (9 groups with the expected membership,
label shortening, search matching both short and full names, canvas
cards keeping their full label after a real drag-drop); two existing
specs (`composition-canvas-interactions.spec.ts`,
`realtime-cross-surface.spec.ts`) updated from the old `<Select>`-based
Attributes assertions to the new row-based ones. Full local gate green
(tsc/eslint/boundaries/vitest/check-loc/golangci-lint/go vet/go build
desktop+server/go test/ls_lint) plus a full Playwright e2e run
(200/200 including 3 pre-existing timing-flake tests that passed clean
on Playwright's own automatic retry, none touching the palette,
Configure icon-buttons, or ConfigureAttributes). Screenshots:
`scratchpad/audit/*-after.png` (the palette open + mid-search, both
themes; Configure Attributes' row list and its open editor, both
themes; a Configure table showing the new icon-button row actions).

Goal stays OPEN — both design-wave PRs are delivered; what remains is
the owner's own live sign-off against the goal's stated Acceptance
(a judgment call, not a checklist), plus the goal's original
authoring-surface items (typed payload visibility on cards, the
spacing audit) that predate both waves and were never in their scope.

## Design wave 4 — app mark + icon (2026-08-13, owner-requested and
owner-picked)

Mill's first real mark, replacing the stock framework "W" that still
shipped as both `build/appicon.png` and the sidebar rail's
`millicon.png`. Owner chose candidate B ("Gate": capture-blue node →
guardrail teal diamond → apply-orange node) from a three-option
preview sheet (millwheel / gate / M-monogram, each rendered at
512→32px icon sizes, dock context, and sidebar context) — the same
node-edge-through-a-gate motif the README banner (PR #61) established,
drawn from the wave-2 identity tokens. Landed: `build/appicon.png`
(1024 squircle tile, transparent corners) with regenerated
`darwin/icons.icns` + `windows/icon.ico` (`wails3 generate icons`);
`frontend/src/app/millicon.png` (the collapsed-rail slot — expanded
deliberately stays wordmark-only per the wave-1 owner refinement);
`frontend/public/mill.svg` favicon replacing the stock `wails.png`
reference in index.html. Verified live in server mode (rail renders
the new tile). The full three-candidate sheet + chosen-mark SVG source
live in the session scratchpad; the mark's canonical committed form is
the favicon SVG.

## Live-review additions (2026-08-10)
- Hotkey recorder vs native menu accelerators (owner hit ⌘⇧W while
  recording — the window closed, and since Mill exits on last-window-
  close, the app quit; ⌘Q mid-recording would too): macOS checks menu
  key-equivalents before the webview sees keydown, so the recorder
  never observes those combos. Fix: suspend the app menu's
  accelerators while recording (swap in an accelerator-free menu,
  restore on capture/cancel) + warn on permanently-OS-reserved
  combos. Task-tracked; fix after the 0008 build lands.
