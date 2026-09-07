# Comment discipline — constraints, not narrative

No `paths` frontmatter — applies to every hand-written source file
regardless of language.

**A code comment states what the code cannot: an invariant, a
non-obvious constraint, an external tool's gotcha, the property a
regression test pins down. It never carries decision provenance** — who
decided something, when, in which session, or a quote of the product
owner. Phrases like "direct user decision", "owner-directed", and
calendar dates are history, not constraints;
history lives in `docs/SPEC.md`, `docs/adr/`, and `docs/goals/`, cited
by id/section. The test: delete the sentence — if the next maintainer
loses nothing they'd need to safely change the code, it was narrative.

For regression tests: name the failure property, not the discovery
story.

Enforced by `scripts/check-comment-hygiene.sh` (lefthook + CI's
`comment-hygiene` job): deny-lists known provenance phrases in
hand-written `.go`/`.ts`/`.tsx` files, and calendar dates on comment
lines only (dates inside code/string literals are legitimate). A false
positive may carry `comment-hygiene:allow` on the same line; never use
it to smuggle real provenance past the gate.
