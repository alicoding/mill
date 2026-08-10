# 0011 — Lists maturation: typed datasets + List Search

## Goal
Grow Mill's key/value List into the reference model recorded in SPEC
§3.2.2 (owner-supplied review, 2026-08-10) — typed tabular datasets +
a real search step — WITHOUT crossing the review's own boundary: a
List is never an ungoverned database.

## Capability map (build order candidates, all `OPEN`)
1. Typed column schema on List (reuse the canonical TypedField
   vocabulary — never a fifth schema system) + row storage + the
   schema-generated row editor (the "one typed record editor"
   primitive, shared with test fixtures).
2. System-managed columns: created/updated by/at + Active/Expired row
   lifecycle — platform-owned, reserved; search semantics over
   Expired must be decided explicitly before adoption (review's own
   flag).
3. CSV/JSON import for rows + schema (reuse SchemaIntake/PapaParse/
   genson-js pipeline — already built for Integrations).
4. `list-search` step (supersedes or extends `list-lookup`): multiple
   match parameters, exact match first; fuzzy = adopt a library
   (research pass required — never invent matching); typed Object
   output {results[], matched, first_match, match_count} with a
   first-match-only toggle that never changes the published type;
   non-terminal with required continuation (ADR-0028's validation
   covers it).
5. **Execution evidence**: record List identity + dataset
   version/snapshot per lookup execution so replay never silently
   evaluates different rows (intersects ADR-0026's intentional
   re-execution principle; today redrive reuses checkpointed results
   but nothing records the dataset version seen).
6. Migration: existing key/value Lists become single-column typed
   lists (or keep both shapes — decide with a capability check, not
   assumed).

## Acceptance
Owner-aligned seed roster entry (a real lookup dataset + search
workflow) proven per the layered-coverage model; the
List-as-database boundary documented; evidence gaps resolved by
research or explicitly deferred with reasons.
