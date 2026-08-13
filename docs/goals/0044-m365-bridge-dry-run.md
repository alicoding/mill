# Goal 0044 — M365 bridge dry run + capture-path research

Owner-picked 2026-08-13. Absorbs goal 0021 Phase 4's remaining
bullet (the §2.1 M365 bridge dry run) so 0021 can archive on the
owner's real-use-ready call without carrying open build work.

## Goal

Two deliverables, one session-shaped each:

1. **Bridge dry run** — compose the §2.1 core loop end to end with
   the pieces that exist today (capture → process → code-exec →
   clipboard; the "Example: Run copied code" and "Saved page →
   Markdown" seeds are the starting points), run it against a
   realistic captured page, and produce a concrete named-gaps list:
   what's missing between today's Mill and the real
   copy-from-Confluence → paste-into-M365 daily loop (DOM capture
   quality, auto-paste target, anything else the dry run surfaces).
2. **Capture-path research** — the gating unknown from the
   enterprise-reality context: can a browser extension realistically
   load in a locked-down enterprise browser (managed-Chrome/Edge
   extension policy: allowlists, force-install lists, developer-mode
   blocking — what IT policy typically permits and what precedent
   exists for getting an internal tool approved), vs. the fallback
   ladder (save-page capture floor — already shipped; bookmarklet;
   clipboard-only). Research output is a decision-ready comparison,
   not a build.

## Plan

Dry run first (it sharpens what the research must answer). Research
via agent with primary sources (enterprise browser policy docs,
extension-policy references). No Mill code changes expected beyond
possibly a seed tweak; if the dry run finds a small fixable gap, it
rides per the below-goal-granularity rule.

## Acceptance (checkable)

- [ ] The dry run's gap list is written into this file, each gap
      named with what it would take.
- [ ] The capture-path comparison (extension vs. fallback ladder,
      with policy precedent and sources) is written into this file,
      decision-ready for the owner.
- [ ] Goal 0021's Phase 4 bullet points here and 0021's archival is
      unblocked (owner call remains its bar).
