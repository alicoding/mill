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

## Research findings (2026-08-10) — decisions teed up
- **Fuzzy library: `github.com/hbollon/go-edlib`** (MIT, maintained,
  zero external deps; `FuzzySearchSetThreshold` maps verbatim onto
  item 4's shape). Behind a new `internal/adapters/fuzzymatch` wrapper
  (the `internal/adapters/expression` precedent). Exact match stays
  plain equality — never routed through the similarity lib. Rejected:
  sahilm/fuzzy + lithammer (fuzzy-*finder* shape, wrong for
  approximate-equality lookup), agext/levenshtein (6y stale — the same
  bar SPEC §3.4 rejected robfig/cron on), closestmatch (no go.mod,
  weak on short strings). **DECIDED (industry research): default = Damerau-Levenshtein**;
  Jaro-Winkler a per-column override (Census name-matching origin);
  token/set methods rejected (degrade on short reference strings) —
  see the fuzzy-library finding below for full reasoning.
- **Typed-column intake: GAP, not reuse — and the reason 0011 depends
  on 0013.** PapaParse + genson-js (the libraries) are reusable now;
  the schema-intake *components* (SchemaIntake/ManualSchemaEditor/
  openapiSynth) are HTTP-request-shaped (`in: path|query|header|body`,
  operations, OpenAPI wire target) — reusing them means modeling every
  List as a fake OpenAPI spec, i.e. a fifth vocabulary. Item 1/3
  (typed columns, schema intake) MUST build against 0013's canonical
  TypedField + its generalized editor, or create migration debt.
  Items 2 (audit columns) + the fuzzy half of item 4 are NOT blocked
  on 0013.
- **Audit columns**: platform-owned struct fields separate from
  user-declared columns (the BuiltIn/Versions precedent), not injected
  as user TypedFields. Surfaces a real gap — CreatedBy/UpdatedBy need
  an actor identity Mill has none of (§3.7 single-user-forever) — name
  the actor source explicitly. **Expired-rows-searchable DECIDED by
  industry research: excluded by default, per-step opt-in, UNIFORM
  across exact and fuzzy** — the exact/fuzzy split (option c) has ZERO
  industry precedent (soft-delete convention, OFAC sanctions
  screening, Informatica MDM all split on "current vs explicit
  historical", never match-type). OFAC even confirms exclusion: it
  screens the CURRENT list only; delisted entries move to an audit
  archive, never stay in live matching — which maps exactly onto item
  5's per-execution snapshot (evidence ≠ active-match set). Plausible
  extension (not a third option): a test RunKind could surface Expired
  for visibility while triggered stays Active-only (ADR-0021's
  disabled-pauses-production shape).

## Sequencing (confirmed by research)
0013 first (its List-columns capability-map row at minimum) → then
0011 items 1/3/6. Items 2 + fuzzy-4 can go independently.

## Acceptance
Owner-aligned seed roster entry (a real lookup dataset + search
workflow) proven per the layered-coverage model; the
List-as-database boundary documented; evidence gaps resolved by
research or explicitly deferred with reasons.


## Design section (research pass delivered 2026-08-12 — full report in session record)

Key verdicts, primary-sourced:
- **Fuzzy matching: adopt `hbollon/go-edlib`** (MIT, zero deps,
  Damerau-Levenshtein; exact match never routes through it).
  `sahilm/fuzzy`/`lithammer/fuzzysearch` rejected on algorithm CLASS
  (subsequence finders, not approximate equality); `agext/levenshtein`
  rejected on staleness+license. Framing correction: Airtable/Excel/
  n8n-core do NOT ship edit-distance fuzzy — exact is the industry
  default; fuzzy stays secondary/opt-in.
- **Output stability**: the list-search Object shape is fixed by
  construction (Mill-written struct, never column-inferred) —
  ADR-0029's boundary satisfied; first-match-only never changes type.
- **Rows**: {ID, Values, CreatedAt, UpdatedAt, Status(active/expired)}
  — NO CreatedBy/UpdatedBy (single-user-forever, §3.2.4's own
  anti-governance verdict). Expired rows excluded from matching by
  default, per-step opt-in.
- **Snapshot-per-execution REFRAMED**: DBOS step-checkpointing already
  guarantees replay never re-evaluates a changed List (Temporal
  precedent confirms the class) — the gap is audit evidence only;
  list_id inline in the typed output + the matched rows already
  captured IS the minimal honest record. Full content-hash deferred as
  enhancement, not gap.
- **Storage**: stay on the settings JSON store (sibling-entity
  consistency); SQLite-via-DBOS is the named future trigger the day a
  real four-digit-row List exists — not before.

**GATING DECISION, owner-owned:** `.claude/worktrees/wt-lists` holds a
near-complete uncommitted implementation of this goal from a parallel
session, on a branch diverged behind main (pre-§3.2.4, pre-goal-0018).
Rebase-and-land vs treat-as-scratch must be decided by the owner before
any build starts — another session's live workspace is never touched
from this one.
