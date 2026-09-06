# Adopt converged patterns — novelty in the surface, familiarity in the interactions

No `paths` frontmatter — unconditional. History: ADR-0050.

## The law

**Novelty lives in the SURFACE. Familiarity lives in every INTERACTION
on it.** Every interaction *on* the surface — typing, dragging,
selecting, undo, a menu — must feel
*borrowed* from the tool people already use for that job, never
invented. The novelty budget is spent on the surface and the
guardrails; interactions are adopted, not designed.

Inventing an interaction requires showing the **surface itself demands
it** — no converged pattern fits (goal 0245's rotation handle). Otherwise adopt the converged
pattern (`architecture.md`'s "Research → Adopt → Compose",
`.claude/rules/frontend.md`'s "use the kit's components").

## The method — a feature is a composition of two adopted contracts

A feature is **plugged in**, not built: the converged external pattern
(its real API) composed with Mill's surface API (the extension
contract), joined by an adapter. You invent neither side.

1. **Research, never infer.** CLAUDE.md's **Precedent** heading,
   followed by **Today** and **Gap** before any Plan.
2. **Adopt the whole API at its HIGHEST abstraction, not the four
   low-level calls the first feature needs** — partial or low-level
   adoption is how a forced pattern sneaks back (the grid's own
   trailing-row primitive, never a hand-drawn button under the grid).
3. **Build only the adapter** — the ports/adapters seam joining the
   external API to Mill's surface API; the seam-risk `architecture.md`
   warns about (thread affinity, callback promises) is the only Mill
   code here. **Re-implementing a behaviour the adopted library already
   ships is a defect, not a build**: a grid's copy/paste/fill/keyboard
   model is the library's (Excel-grade, out of the box) — enable it
   whole; never a hand-written cell paste.
4. **When the adapter can't reach, grow the SURFACE, never the
   feature** — extend the kernel/contract, never hack around a gap.

## The intake gate — commodity-first (Definition of Ready)

Every "I want X" splits: **Business** — the outcome wanted. **Platform**
— the eng decision, whose FIRST question is *"Why not a commodity?"*

Routing: **Specialized authoring** (drawing, spreadsheet formulas, rich
document editing) → a **commodity extension** (draw.io, Excel), never
rebuilt in Mill. **Content management / always-on / agent (MCP) reach**
→ **Mill's API**. The gate stops building an *engine* for what a
commodity already does.

## The two-plane boundary (ADR-0046 / ADR-0047)

An extension owns the **authoring plane** (the human editing UI);
**Mill's API owns the content plane** (the file IS the content). For a
file-backed object, the extension edits the file by hand, Mill's API
and MCP edit it programmatically and *guarded* (same artifact, two
doors, one guard).

## The test (review-checked, like `comments.md` and `ux-writing.md`)

- *Is this interaction borrowed or invented?* If invented, does the
  surface genuinely demand it, or is it a forced pattern?
- *Are we adopting the external API whole, or half-inventing it? Is
  there a higher-level primitive in it that already owns this job?*
- *What adapter plugs it in; what surface-API gap does it reveal?*
- *(Intake)* The commodity's job, or Mill's API's job?
