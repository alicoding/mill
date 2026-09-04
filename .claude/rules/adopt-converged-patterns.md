# Adopt converged patterns — novelty in the surface, familiarity in the interactions

No `paths` frontmatter — this is a product-and-architecture law that
cuts across every user-facing surface and both languages, so it loads
unconditionally the way `architecture.md` and `ux-writing.md` do.

The owner's diagnosis of why Atlas surfaces are disliked (2026-08-27):
they were **forced patterns** — a new way to do a familiar thing —
"not what people are used to, just on a different surface." A novel way
to edit a note or drag a shape is muscle-memory friction; the user has
to relearn what they already know. This rule is the standing answer.

## The law

**Novelty lives in the SURFACE. Familiarity lives in every INTERACTION
on it.** Mill's genuine novelty is the surface — the spatial canvas,
the guardrailed automation, the object/extension contract. Every
interaction *on* that surface — typing a note, editing a cell, dragging
a shape, selecting, undo, a menu, a rotate handle — must feel *borrowed*
from the tool people already use for that job, never invented. The
novelty budget is spent entirely on the surface and the guardrails;
interactions are adopted, not designed.

When you believe an interaction must be invented, the burden is to show
the **surface itself demands it** — no converged pattern fits a
genuinely-novel surface affordance (e.g. rotation on a React Flow node,
where no library ships it — see goal 0245). Otherwise, adopt the
converged pattern. This is the product-level statement of
`architecture.md`'s "Research → Adopt → Compose" and
`.claude/rules/frontend.md`'s "use the kit's components, don't
hand-roll."

## The method — a feature is a composition of two adopted contracts

A feature is not "built." It is **plugged in**: the converged external
pattern (adopted via its real API) composed with Mill's own surface API
(the extension contract), joined by an adapter. You invent neither side,
so correctness is structural — it's the contract, the spec, the schema.

1. **Research, never infer.** Get the converged pattern from an actual
   search of the tools people use — never inferred from a request's
   phrasing. A claim of "nothing exists" needs a real search behind it.
   This is CLAUDE.md's **Precedent** heading; it is followed by
   **Today** (Mill's current state, audited) and **Gap** before any
   Plan — the forced-pattern diagnosis above is exactly what the Gap
   line surfaces when it is written down.
2. **Adopt the whole API, not the four calls the first feature needs.**
   Partial adoption is how a forced pattern sneaks back — you take half
   of the converged model and invent the other half. This is the
   product-level form of `architecture.md`'s "adopting a dependency
   means reading its whole API."
3. **Build only the adapter** — the ports/adapters seam joining the
   external API to Mill's surface API. The feature logic is adopted; the
   adapter is the only Mill code, and it is where all correctness care
   goes (the contract's invisible invariants — thread affinity, callback
   promises — the seam-risk `architecture.md` warns about). You are not
   building the feature; you are building only the seam, and the seam is
   the whole job.
4. **When the adapter can't reach, grow the SURFACE — never the
   feature.** If the adopted pattern needs a capability the surface API
   doesn't expose, extend the kernel/contract (the API-surface "gap"),
   never hack the feature around it. Adopting comprehensively reveals
   the platform's own API gaps and matures it — Mill's own features are
   plugins on Mill's own surface.

## The intake gate — commodity-first (Definition of Ready)

Every "I want X" splits into two hats that must be separated at intake:

- **Business (the user):** "I want to be able to *do* X" — stated as an
  outcome, not an implementation.
- **Platform (the owner):** the eng decision, whose FIRST question is the
  commodity-first gate — *"Why not a commodity for this? What makes it
  Mill's-API's job rather than an existing tool's?"*

The routing rule:
- **Specialized authoring** (drawing, spreadsheet formulas, rich
  document editing) → a **commodity extension** (draw.io, Excel, the
  real tool), never rebuilt in Mill.
- **Content management / always-on surface / programmatic + agent (MCP)
  reach** → **Mill's API** — Mill's actual value, and better than any
  single tool's API *at that job*, not at the authoring the commodity
  owns.

The gate exists to stop the failure mode of building an *engine* for
something a commodity already does (a diagram engine when draw.io
exists). It catches it at the door: "diagrams = draw.io; Mill's job =
placing / managing / programmatically-updating them = the API."

## The two-plane boundary (ADR-0046 / ADR-0047)

The gate rests on a boundary: an extension owns the **authoring plane**
(the human editing UI); **Mill's API owns the content plane** (the file
IS the content — position, references, read/write). For a file-backed
object the file is the shared artifact — the extension edits it by hand,
Mill's API and MCP edit it programmatically and *guarded* (same
artifact, two doors, one guard). Reach is fullest for file-backed
objects (Mill holds the file), bounded for provider-backed ones.

## The test (review-checked, like `comments.md` and `ux-writing.md`)

Not grep-enforceable — checked at brief-writing and review. For every
interaction and every incoming request, ask:

- *Is this interaction borrowed or invented?* If invented, does the
  surface genuinely demand it (no converged pattern fits), or is it a
  forced pattern?
- *Are we adopting the external API whole, or half-inventing it?*
- *What adapter plugs it in, and what surface-API gap does whole-adoption
  reveal?*
- *(Intake)* Is this a commodity's job (specialized authoring) or Mill's
  API's job (content management / always-on / agent reach)?
