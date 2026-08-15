# 0056 — Workbench boundary: Mill's positive product definition

**Raised:** 2026-08-14, owner: "maybe Mill could be that workbench…
we never truly defined what Mill boundary to be honest… these are
composable components… but gotta be like how Mill is built, nothing
hardcoded." Mill's boundary so far is defined negatively (not an LLM
client, not a notes app, not a diagram platform; kernel vs
composition) — this goal produces the POSITIVE statement: what Mill
is for, beyond running workflows.

## The candidate frame (to be tested by this goal, not assumed)

A local-first workbench: things you capture land somewhere useful,
get grouped, stay findable, and get transformed — with every
category user-declared, nothing hardcoded. The unifying insight:
the owner's listed needs (scratch notes, captured pages, contact
info, keep-but-don't-bookmark links, work notes) differ only in
SCHEMA and ROUTING — they are one generic capability (user-declared
collections + capture routing + one generic browse/read/search
surface), not N features. Mill already carries the embryo: Lists
are user-schema'd collections; capture steps and routing workflows
exist; the Quick Panel summons. The workbench layer would be
data-residency expressed through the same registries — and joins
the generated contract (0052) automatically, strengthening the
far-side story (external agents operate on collections through the
same guarded surface).

Anti-goal, stated as hard as the goal itself: if Mill ever grows a
category-specific surface (a "Contacts" tab, a "Bookmarks" view),
this frame has failed — the test is always ADR-0035's: one generic
capability, user-declared categories, never a hardcoded vertical.
"Workbench" is the word inner-platform failures wear; this goal
exists to define the line, not to license crossing it.

## This is DESIGN work — deliverables are documents, not features

1. **Research:** how the capture-and-find field converged and
   failed — the personal-knowledge tools (what made capture stick
   vs die; why organize-first tools lose capture-first users), the
   collection-database tools (user-declared schemas as product),
   and the automation platforms' data stores (n8n data tables and
   kin — what a runner+data layer looks like when it works).
   Primary sources, adopt/reject per pattern.
2. **Capability map** (CLAUDE.md Plan rule, SPEC §3.3's worked
   example): every known future use of collections — notes, pages,
   contacts, link-keeping, diagram text artifacts, run receipts?,
   agent-written data? — each marked adopt-vs-own and now-vs-later,
   BEFORE any schema is designed. The map is the deliverable that
   prevents the point-solution version.
3. **The boundary statement:** SPEC §0-level positioning update +
   an ADR defining what the workbench layer is, what it is never,
   and the ordered capability seams (collection browse/read surface,
   capture-into-collection steps, cross-collection search) as
   FUTURE goals — queued then, not built here.

## Sequencing

After 0054 (the declare-don't-code philosophy this extends), and
its output shapes any collection-building goals. Coordinates with
0046 (user-declared schemas evolve — same semantics) and 0052 (new
entity families join the generated contract). Does not block the
0044→0053→0052→0054 arc.


## Working method — DECIDED 2026-08-14 (owner-directed): fit-gap analysis, constraints as knock-outs

The boundary question is answered by the enterprise software-selection
standard, not from taste: a requirements matrix read as fit-gap.
Structure, in order:

1. **Knock-out criteria first** (constraints are gates, never scored
   columns — one X disqualifies): runs on the locked-down work
   machine as-is; content never leaves machine/tenant; no new
   accounts/purchases; the artifact stays hand-editable and portable
   when any tool dies.
2. **Requirements as testable one-liners, MoSCoW-ranked** (Musts from
   the owner's own recorded needs: one-keystroke capture with zero
   filing decisions; records-not-prose; stable addresses; one-paste
   AI-context; update-in-place with history-on-demand; Should:
   derivable status, stable-id cross-references; Could:
   machinery-driven reformatting).
3. **Candidates include COMBINATIONS as first-class columns** — the
   M365 pieces singly, the files+Word+Copilot combo, that combo plus
   Mill-as-pipe, and "Mill builds a collections capability" as the
   LAST column, never the first.
4. **Cells are three-state** (full / partial-with-workaround /
   absent); the partials carry the real information.
5. **Verdict is per residual gap, not per product**: the best
   surviving combo's remaining gaps each get buy / bridge / build /
   tolerate — and every "build" candidate faces ADR-0035's multi-use
   test individually. This is how the notes question decomposes into
   small honest calls instead of one identity decision.

## Acceptance (checkable)

- [ ] Research findings + per-pattern adopt/reject recorded.
- [ ] The capability map committed (in this file or the ADR).
- [ ] SPEC §0 positioning updated + ADR merged, both carrying the
      anti-goal as an explicit test future work can be held to.
- [ ] Follow-on build goals (if the verdict is "build") are queued
      as their own BACKLOG entries with this goal as their charter —
      zero features built inside this goal.
