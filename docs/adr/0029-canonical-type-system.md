# ADR-0029: Canonical type system — `internal/domain/typedfield`

## Status

accepted — 2026-08-10, the three flagged questions resolved with the
architect's own recommendations (owner-delegated: "get what we know
100% in"; all three low-stakes and reversible, recorded below):
(1) **RefKind stays in core** — a harmless extra optional field, plausible
List/Decision reuse; narrow later if it never materializes. (2) **Type
stays a flat string-const** — a strict superset of everything today;
0011's future `object`/`array` are additive values, revisit only if
they need structure this flat enum can't express. (3) **Build Phases
1–2 only; Phase 3 (openapispec) is an explicit fast-follow** — P1+P2
meet acceptance ("two of four converged") at the smallest wire risk;
P3 is the largest UI surface and genuinely separable. Any of the three
is cheap to revisit — Phase 1 type-aliases don't lock RefKind
placement, and P3-deferral is pure scope. This is SPEC §9.5's ranked-#1 platform-kernel investment: the
four accreted field vocabularies (`ConfigField`, `AttributeDef`,
`decision.OutputField`, `openapispec.Field`) converge so the next N
capabilities declare fields once instead of adding a fifth.

## Decision

A NEW leaf domain package `internal/domain/typedfield` holds the
canonical `Field` + `Type`. **It cannot live in `composition`** — the
import graph (verified) is `composition → decision/list/openapispec`,
so a canonical type inside `composition` would force `decision`/`list`
to import `composition`, the exact cycle `decision.OutputField.Type`'s
bare-string workaround was written to avoid (its own doc comment says
so). A leaf package `composition`/`decision`/`list` all import breaks
the cycle cleanly.

```go
package typedfield
type Type string
const ( TypeText/Number/Boolean/Options  // wire-identical to today
        TypeInteger/Object/Array/Map/Date/Datetime ) // additive
type Field struct {
  Key, Label string; Type Type
  Required bool; Default, Description string
  Options, Suggestions []string   // Options was Options/EnumValues/EnumValues
  Secret bool; RefKind string; Multiline bool
  SystemManaged bool              // NEW — goal 0011's reserved columns
}
```
Every value stays `string` on the wire (`Node.Config`/`Values`/List
entries are already `map[string]string`) — `Field` only governs
validation/rendering/coercion, never the wire shape.

**Stays out (the can't-unify list, with reasons):** `openapispec.Field`
keeps `In` (HTTP path/query/header placement) + `Path` (nested-response
extraction) as an embed-and-extend (`struct{ typedfield.Field; In,
Path string }`) — both mean nothing to any other consumer. List row
lifecycle (created/updated-by/at, Active/Expired) is NOT a field-schema
question — `SystemManaged` (a Field flag) is in scope; the audit/row
machinery is goal 0011's. §3.8's `mill.shell-block.v1` schema *registry*
(named, versioned collections) is built FROM this atomic unit, not by
this goal.

## Migration (no big-bang, wire-compat preserved)

- **Phase 1 — `AttributeDef` + `ConfigField` become type aliases of
  `typedfield.Field`.** Zero JSON migration (old `{Key,Label,Type}`
  unmarshals into the wider struct; new fields zero-value). Immediate
  payoff: `AttributeDef` gains Options (closing `ruleTranslate.ts`'s
  own named exclusion), Required, Default, Description. This alone
  meets 0013's "two of four converged" acceptance.
- **Phase 2 — `decision.OutputField`.** Leaf-imports-leaf, no cycle.
  One wire change `EnumValues → Options`, via the exact precedented
  migration ADR-0016's `configure-connectors → configure-requests`
  rename already shipped (copy old key on load if new absent). `Type`
  becomes real `typedfield.Type`.
- **Phase 3 — `openapispec.Field`.** Cheapest wire-risk (never
  persisted — a runtime view of the OpenAPI JSON), largest UI surface
  (`ManualSchemaEditor`/`ManualField`). `fieldSchema()` already
  translates Mill↔OpenAPI vocabulary at synthesis; add `text↔string`
  to the same existing map. `Name→Key`, `Alias→Label` (a real
  semantic unification). **Deferrable as a fast-follow** — see Open #3.
- Goal 0011's List columns build against `typedfield.Field` from day
  one (List has no schema today, nothing to migrate).

## Shared editor (§4.1's row) — NOT this goal

The generalized `<TypedFieldListEditor>` belongs to goal 0011, not
0013: 0013's acceptance is the Go shape only, and consolidating against
3 currently-fine call sites with no reported pain is the premature-
abstraction pattern this repo repeatedly declines (React Flow deferral,
§3.6's SDK decline). 0011 is the genuine 4th structurally-motivating
use (List has no editor at all).

## Open (owner decisions before `accepted`)

1. **`RefKind` in core vs. extension** — architect kept it in core on
   "low cost, plausible future reuse" (a List/Decision value
   referencing an entity by ID), but no concrete consumer needs it
   there yet. Could bucket with `In`/`Path` until one does.
2. **`Type` as flat string-const vs. a richer system** — sufficient
   for everything today (strict superset), but 0011's future
   `object`/`array` column types aren't designed, so "flat enum is
   enough" is unconfirmed for them.
3. **Phase 3 in-scope, or ship Phases 1–2 + defer openapispec?** —
   Phases 1–2 already meet acceptance; Phase 3 is the largest UI
   surface at the smallest wire risk. Explicit call, not a default.

## Sequencing
0004 (done) satisfied 0013's "sequence after" precondition; 0011
depends on 0013 (both documents agree). 0013 → 0011.
