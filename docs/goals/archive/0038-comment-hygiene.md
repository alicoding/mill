# Goal 0038 — Comment hygiene: constraints, not narrative

**Goal.** Source comments state technical constraints only. Decision
provenance — owner quotes, "direct user decision", "caught live",
"this session", calendar dates — moves out of `.go`/`.ts`/`.tsx`
files entirely; the reasoning already lives in `docs/SPEC.md`,
`docs/adr/`, and `docs/goals/`, and a comment cites those by id when
the why matters. Owner-directed 2026-08-13, generalizing the earlier
public-context scrub (`fix/public-context-scrub`) into a standing,
enforced standard now that the repo is public.

**Plan.**
1. `.claude/rules/comments.md` — the standard (loads unconditionally,
   no `paths` frontmatter).
2. `scripts/check-comment-hygiene.sh` — deny-list gate over
   hand-written source (provenance phrases anywhere; calendar dates on
   comment lines only), wired into lefthook pre-commit AND a CI
   `comment-hygiene` job required by `ci-gate`, in the same change
   (CI-from-day-one constraint). Same one-script-two-callers shape as
   `check-loc.sh`.
3. One sweep of the 65 baseline violations: keep each comment's
   technical constraint, drop the narrative, add a `docs/` citation
   where the reasoning lives elsewhere. Regression-test comments name
   the pinned property, not the discovery story.

**Acceptance** (checkable predicates)
- [x] `./scripts/check-comment-hygiene.sh` exits 0 on the full tree.
- [x] `.claude/rules/comments.md` exists, frontmatter check passes.
- [x] lefthook.yml and ci.yml both run the script; `ci-gate` lists the
      CI job in `needs`.
- [x] No technical information lost: every rewritten comment still
      states the constraint or property the original did (review
      check, not grep).
- [x] Full local suite green; goal PR merged with `ci-gate` green.
