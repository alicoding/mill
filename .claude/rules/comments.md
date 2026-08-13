# Comment discipline — constraints, not narrative

No `paths` frontmatter deliberately — applies to every hand-written
source file regardless of language, the same way architecture.md does.

**A code comment states what the code cannot: an invariant, a
non-obvious constraint, an external tool's gotcha, the property a
regression test pins down. It never carries decision provenance** —
who decided something, when, in which session, or a quote of the
product owner. Phrases like "direct user decision", "owner-directed",
"caught live", "this session", and calendar dates are history, not
constraints; history lives in `docs/SPEC.md`, `docs/adr/`, and
`docs/goals/`. A comment may cite one of those by id or section
(delivery-discipline.md's existing pointer rule), and that pointer is
where a reader goes for the why. The test: delete the sentence — if
the next maintainer loses nothing they'd need to safely change the
code, it was narrative.

For regression tests specifically: name the failure property, not the
discovery story. "Regression: the preview's nested canvas captured
page scroll" says what must keep passing; "caught live while building
the Runs UI" says nothing a maintainer can use.

Enforced by `scripts/check-comment-hygiene.sh`, run by lefthook
(pre-commit) and CI's `comment-hygiene` job — the same
one-script-both-callers shape as `check-loc.sh`, so the two can't
drift. It deny-lists the known provenance phrases everywhere in
hand-written `.go`/`.ts`/`.tsx` files, and calendar dates on comment
lines only (dates inside code/string literals — test fixtures — are
legitimate). A genuine false positive (a real domain concept named
"owner", say) may carry `comment-hygiene:allow` on the same line;
never use the marker to smuggle actual provenance past the gate.
