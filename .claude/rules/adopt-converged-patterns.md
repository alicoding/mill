# Adopt converged patterns — novelty in the surface, familiarity in the interactions

No `paths` frontmatter — unconditional. History: ADR-0050.

## The law

**Novelty lives in the SURFACE. Familiarity lives in every INTERACTION
on it.** Typing, dragging, selecting, undo, a menu must each feel
*borrowed* from the tool people already use, never invented. The
novelty budget buys the surface and the guardrails; interactions are
adopted. Inventing one requires showing the **surface
itself demands it** — no converged pattern fits (goal 0245's rotation
handle). Otherwise adopt (`architecture.md`'s Research → Adopt →
Compose, `frontend.md`'s kit first).

## The dispatch lock — adoption is decided before dispatch

Which commodity/pattern and at which abstraction level is the
orchestrator's decision, written into the brief before dispatch —
never the agent's call. An agent that meets an un-named
adopt-or-build choice stops and reports it.

## The method — a feature is a composition of two adopted contracts

A feature is **plugged in**: the converged external pattern (its real
API) composed with Mill's surface API, joined by an adapter. You
invent neither side.

1. **Research, never infer.** CLAUDE.md's **Precedent** → **Today** →
   **Gap** headings, before any Plan.
2. **Adopt the whole API at its HIGHEST abstraction, not the calls day
   one needs** — partial or low-level adoption is how a forced pattern
   sneaks back (the grid's own trailing-row primitive, never a
   hand-drawn button).
3. **Build only the adapter** — the ports/adapters seam; thread
   affinity and callback promises are the only Mill code here.
   **Re-implementing a behaviour the adopted library ships is a
   defect** — enable its copy/paste/fill/keyboard model whole, never a
   hand-written version.
4. **Adapter can't reach? Grow the SURFACE, never the feature** —
   extend the kernel/contract, never hack around a gap.

## Pre-rule code migrates, never grandfathers

Work in a subsystem that finds Mill hand-rolling what a converged
library ships migrates it FIRST — proved by old tests passing
unmodified (the upgrade-ground rule) — before the feature on top.
Found outside any goal: a BACKLOG entry the same day, never tolerated
legacy.

## The intake gate — commodity-first (Definition of Ready)

Every "I want X" splits: **Business** — the outcome wanted.
**Platform** — the eng decision, whose first question is *why not a
commodity?* Specialized authoring (drawing, spreadsheets, rich
documents) → a **commodity extension**, never rebuilt in Mill. Content
management / always-on / agent (MCP) reach → **Mill's API**.

## The two-plane boundary (ADR-0046 / ADR-0047)

An extension owns the **authoring plane** (the human UI); **Mill's API
owns the content plane** (the file IS the content): the extension edits
the file by hand, Mill's API and MCP edit it programmatically and
*guarded* — same artifact, two doors, one guard.

## The test (review-checked, like `comments.md`)

- *Borrowed or invented? If invented, does the surface genuinely demand it?*
- *Adopted the API whole, or half-invented it? A higher-level
  primitive that already owns this job?*
- *The adapter plugging it in; the surface gap it reveals?*
- *(Intake)* The commodity's job, or Mill's API's job?
