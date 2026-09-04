# Adopt converged patterns — novelty in the surface, familiarity in the interactions

No `paths` frontmatter — loads unconditionally like `architecture.md`.
History and precedent: ADR-0050.

## The law

**Novelty lives in the SURFACE. Familiarity lives in every INTERACTION
on it.** Every interaction *on* the surface — typing, editing a cell,
dragging, selecting, undo, a menu, a rotate handle — must feel
*borrowed* from the tool people already use for that job, never
invented. The novelty budget is spent on the surface and the
guardrails; interactions are adopted, not designed.

Inventing an interaction requires showing the **surface itself demands
it** — no converged pattern fits (e.g. rotation on a React Flow node,
where no library ships it — goal 0245). Otherwise adopt the converged
pattern (`architecture.md`'s "Research → Adopt → Compose",
`.claude/rules/frontend.md`'s "use the kit's components").

## The method — a feature is a composition of two adopted contracts

A feature is not "built." It is **plugged in**: the converged external
pattern (its real API) composed with Mill's own surface API (the
extension contract), joined by an adapter. You invent neither side.

1. **Research, never infer.** CLAUDE.md's **Precedent** heading,
   followed by **Today** and **Gap** before any Plan.
2. **Adopt the whole API, not the four calls the first feature needs**
   — partial adoption is how a forced pattern sneaks back.
3. **Build only the adapter** — the ports/adapters seam joining the
   external API to Mill's surface API; the seam-risk `architecture.md`
   warns about (thread affinity, callback promises) is the only Mill
   code here.
4. **When the adapter can't reach, grow the SURFACE — never the
   feature** — extend the kernel/contract, never hack around a gap.

## The intake gate — commodity-first (Definition of Ready)

Every "I want X" splits: **Business** — "I want to be able to *do* X",
an outcome. **Platform** — the eng decision, whose FIRST question is
commodity-first: *"Why not a commodity for this?"*

Routing: **Specialized authoring** (drawing, spreadsheet formulas, rich
document editing) → a **commodity extension** (draw.io, Excel), never
rebuilt in Mill. **Content management / always-on / agent (MCP) reach**
→ **Mill's API**. The gate stops building an *engine* for what a
commodity already does: "diagrams = draw.io; Mill's job = placing/
managing/programmatically-updating them = the API."

## The two-plane boundary (ADR-0046 / ADR-0047)

An extension owns the **authoring plane** (the human editing UI);
**Mill's API owns the content plane** (the file IS the content). For a
file-backed object, the extension edits the file by hand, Mill's API
and MCP edit it programmatically and *guarded* (same artifact, two
doors, one guard). Reach is fullest for file-backed objects, bounded
for provider-backed ones.

## The test (review-checked, like `comments.md` and `ux-writing.md`)

- *Is this interaction borrowed or invented?* If invented, does the
  surface genuinely demand it, or is it a forced pattern?
- *Are we adopting the external API whole, or half-inventing it?*
- *What adapter plugs it in, what surface-API gap does whole-adoption
  reveal?*
- *(Intake)* Commodity's job (specialized authoring) or Mill's API's job
  (content management / always-on / agent reach)?
