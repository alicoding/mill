# Goal 0040 — UX copy voice: product copy, not spec narrative

**Goal.** Every string the app renders reads as product copy — what
the user can do and what happens — not as leaked spec/docs narrative.
Owner-directed 2026-08-13, from the live app ("the copy should be
updated in the app I think there are copies everywhere"): page
headers run to three sentences, Settings captions cite
`docs/goals/…`/ADR ids the reader can't open, features are explained
by naming other products. Same disease goal 0038 cured in code
comments, now in the UI surface; goal 0032's i18n migration makes the
sweep tractable (all copy lives in `frontend/src/locales/en/*.json`).

**Plan.**
1. `.claude/rules/ux-writing.md` — the standard (Material Design
   writing guidance / Apple HIG writing style / NN/g microcopy,
   adopted as the converged bar).
2. `scripts/check-ui-copy.sh` — the objective leak class only
   (internal doc references in locale JSON; 13 baseline violations),
   wired into lefthook + a CI `ui-copy` job required via `ci-gate` in
   the same change. Voice/length stay review-checked.
3. Sweep: rewrite every flagged string plus the ~36 over-120-char
   strings and all page headers/subtitles to the standard — meaning
   preserved, internals dropped; update any e2e assertion pinning the
   old text.

**Acceptance** (checkable predicates)
- [ ] `./scripts/check-ui-copy.sh` exits 0.
- [ ] No locale string names another product as its explanation.
- [ ] Every page header/subtitle is a single sentence.
- [ ] Strings over 120 characters are rewritten or individually
      justified in the PR body (a caption that genuinely needs an
      enumeration, e.g. a cron phrase list, may stay).
- [ ] Full local suite + e2e green; PR merged with `ci-gate` green.
