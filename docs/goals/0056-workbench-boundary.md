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




## Design inputs consolidated — 2026-08-14/15 live session (generic record; full-fidelity working artifacts live outside the repo)

An extended live design session with the owner produced the richest
input set any goal has opened with. The durable, generalized record:

**Verified fit-gap conclusion (primary sources):** proprietary-store
notes tools fail the portability knock-out (no open-format export);
a lists product passes conditionally (schema-variant export only);
the files+word-processor+assistant combo covers every Must except
records-shape (bridged via templates + the lists product); adding
Mill-as-pipe covers capture (M1), machine-landed writes (M8), and
context assembly (M6). NOTHING earns a build except one candidate:
**the projection layer** (below). The assistant platform's possible
future workspace product joins the matrix as an all-unknowns column
gated by the same portability bar.

**The one build candidate — a glanceable board ("the projection
layer"):** a spatial, zoomable map whose CARDS ARE REFERENCES
(file/page/projection — content never re-homed) over the same
user-owned files the AI is grounded on — one substrate, two readers,
which extends §0's what-you-see-is-what-I-see thesis from workflows
to knowledge. Design principles ratified live with the owner:

- **Search is the door; the map is the review** — retrieval is one
  keystroke with the next action surfaced; navigation/drilling is
  always an explicit choice, never the price of reaching context.
- **Egocentric root** — the map opens on the USER's space (their
  programs, people, org as facets), never an imported taxonomy.
  Contacts are just another user-declared card category —
  independently re-derived the section-above insight that
  notes/pages/contacts/links differ only in schema + routing.
- **Cards**: body = one obvious action (drill for containers, open
  for leaves; no dead cards — every container drills); small chips
  for exceptions (attachments; an info panel holding description,
  bullets, links, files, and user-declared custom fields — the
  password-manager per-item model: arbitrary structured metadata
  with zero schema ceremony); a create affordance that asks
  SIBLING-OR-CHILD (containment is an explicit creation-time
  choice, never inferred — the anti-auto-graph rule).
- **Mirrored cards** carry source link, local mirror path, detected
  residency badge, freshness + refresh policy — refresh IS a
  scheduled/manual Mill workflow; "update now" runs it guarded.
- **Typed ropes** (owner-authored relations, never auto-generated)
  make three projections of one graph: the board, any traceability
  matrix (requirement→design→schema→vendor chains), and ingestion
  coverage ("known, not mapped" as a number). Existence questions
  resolve with a next action on BOTH branches (have→open;
  haven't→request, with the responsible contact roped in); the
  "why do I care" provenance chain is stored at the reference.
- **Density is a lens choice** — per-level category show/exclude
  plus this-level-only vs peek-into-children; user configuration,
  never a product default.
- **The write loop needs nothing new**: assistant emits an update
  envelope per an instruction block (the contract pattern's second
  job), one hotkey, guardrail preview, file applied, board reflects
  it — composable today with a fixed target set via Branch routing.

**The seam question (the boundary decision this goal must make):**
the board talks only to things that already exist — user files it
projects, the generated contract/MCP for discovery, and Mill
workflows for every action. The candidate shapes differ ONLY in
packaging: (a) a Mill surface, (b) a sibling app in the monorepo,
(c) a separate product on the contract. Forces on record
(single-binary constraint, "never a 21st tool", refresh/guarding
native to Mill) lean toward (a); the ADR decides.

Still open for this goal's formal pass: the capability map, the
boundary ADR, the SPEC §0 statement, and the owner's ratification of
the build verdict.

## The sharpest owner articulation — 2026-08-14 (the M9 requirement)

"I need to see it as a status page... if I can't see what the LLM is
seeing, how do I know if it is hallucinating... like a sticky board
but super organized — vendor status already there in front of you,
just turn your head." Named precisely: a GLANCEABLE BOARD that is a
projection over the SAME files the AI is grounded on — one substrate,
two readers (human glance, LLM context). This is the §0 thesis
(what-you-see-is-what-I-see) extended from workflows to knowledge,
and it reframes this goal's question: not "should Mill do notes"
(answered no — the notes layer belongs to existing tools) but
"should Mill be the PROJECTION layer over user-owned files." In the
goal's fit-gap matrix (the working artifact) this is row M9 — the
first requirement where every bridge falls short and "build" could
be earned; the verdict stays open for this goal's research to
decide, per the method above. Also recorded: the owner's felt
"I'm not doing it right" — the truthful framing is that the
projection layer is a missing product category, not a failure of
personal organization.

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
