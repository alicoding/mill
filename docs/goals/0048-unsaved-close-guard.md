# 0048 — Unsaved-changes close guard for canvas tabs

**Raised:** 2026-08-13, owner-hit live during a walkthrough: edited a
workflow, used "Close all tabs," and the draft was silently discarded —
no prompt, no recovery. "Chrome and many products would handle it
safely … prompt me to save."

## The defect (two paths, both lose work)

- **Mouse paths** (tab ✕, canvas Back, overflow menu's Close all /
  Close other tabs): `WorkTabShell.tsx` wraps every close in
  `clearScratch` — goal 0012's "deliberate close discards the draft"
  rule, applied without any dirty check or confirmation. A bulk close
  over dirty tabs is silent data loss.
- **Keyboard paths** (⌘W `tab.close`, ⌘⇧W `tab.closeAll`, ⌘⌥W
  `tab.closeOthers` in `shared/commands.ts`): call the store closers
  directly, *skipping* scratch clearing — but scratch is keyed by the
  tab's random UUID (`WorkTab.key`), so once the tab is gone the
  surviving scratch is orphaned: unreadable on reopen (a fresh key is
  minted) and never cleaned up. Same user-visible loss, plus a
  localStorage leak.

`workTabDirty` (the tab-strip dirty dot, goal 0012) already tracks
exactly the state a guard needs — this goal adds the guard, not new
bookkeeping.

## Design (locked)

Precedent: VS Code's dirty-editor close prompt (Save / Don't Save /
Cancel; the tab activates before prompting) and Chrome's summary
confirm for closing a window of many tabs. Mill's tab strip already
deliberately follows this family's anatomy (SPEC §3.8).

1. **One guarded funnel.** The keyboard commands stop calling store
   closers directly; they set a `workTabCloseRequest` signal on the
   store (`{ kind: 'one', key } | { kind: 'all' } | { kind: 'others',
   keepKey }`) — the same store-field-as-cross-tree-signal seam
   `canvasCommandRequest` established, since `shared/` cannot import
   the dialog-owning `app/` layer. `WorkTabShell` consumes the signal;
   its own mouse handlers route through the identical guard, so every
   close path behaves the same and scratch clearing happens in exactly
   one place.
2. **Single dirty tab** (✕, Back, ⌘W): activate the tab if it isn't,
   then a three-way dialog — Save / Don't save / Cancel. Save fires
   the existing `requestCanvasCommand('save')`; a successful save
   already closes the tab via `onSaved`. Don't save = close +
   `clearScratch`. Cancel = nothing.
3. **Bulk close with ≥1 dirty tab** (close-all / close-others, either
   input): one summary confirm — "N tabs have unsaved changes" — with
   a danger "Close tabs" and Cancel. No Save-all in v1 (sequential
   multi-tab save through a single-consumer signal is real machinery;
   Chrome's own close-window prompt is the two-way precedent).
4. **Clean tabs close silently**, exactly as today.

Out of scope, named not skipped: Configure request-edit/new forms have
no dirty tracking (goal 0012's own scope split) — they keep today's
behavior; extending dirty tracking to Configure forms is a separate
future goal if wanted.

## Acceptance (checkable)

- [ ] Closing a dirty canvas tab by ANY path (✕, Back arrow, ⌘W,
      overflow Close all, overflow Close others, ⌘⇧W, ⌘⌥W) never
      discards silently: single-tab shows Save / Don't save / Cancel;
      bulk shows the summary confirm.
- [ ] Cancel leaves tabs, drafts, and dirty state untouched.
- [ ] Don't save / Close tabs closes and clears scratch — reopening
      the workflow shows the saved state, with no orphaned
      `mill-canvas-scratch:*` keys left behind (keyboard and mouse
      paths identical).
- [ ] Save from the dialog persists the draft (existing save flow) and
      the tab closes itself on success.
- [ ] A clean tab (no dirty dot) closes with no dialog on every path.
- [ ] Reload/quit behavior unchanged: hot-exit scratch still survives
      and restores (goal 0012 regression guard).
- [ ] Proof at the right layers (testing.md): a unit test for the pure
      which-tabs-are-dirty/guard-decision helper; a Playwright e2e for
      the prompt flow (dirty → ⌘⇧W → dialog → each button's outcome).
- [ ] Dialog copy passes ux-writing.md (front-loaded, no internals) and
      lives in the locale files.
