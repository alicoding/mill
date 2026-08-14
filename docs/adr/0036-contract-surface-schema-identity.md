# ADR-0036 — Contract surface: generated envelope schemas, schema identity, export id

Status: accepted (goal 0052; format decision — JSON Schema generated
from Go types, protobuf/gRPC and OpenAPI rejected — was made in the
goal file 2026-08-13 and is not re-litigated here; this ADR decides
the mechanics and semantics that decision left open).

## Context

The first far-side bridge contact (goal 0044) produced four verified
product gaps, three of which are contract-shaped: no self-describing
schema an external agent can read, an export/import identity
asymmetry (export omits `id`, import accepts one), and no
machine-readable state manifest. The recorded open question in
`compositionservice_export.go` ("whether ExportWorkflow itself should
start emitting id ... is an explicit open question left to a future
share-story goal") now has a real consumer: a far-side agent that
needs pre-image → modify → write-back. Goal 0052's inventory
confirmed seven import/export-paired envelope families, all with
symmetric UI surfaces, and one unified update chokepoint
(`SnapshotDraft` + `UpdateWorkflowFromExport`, shared by
clipboard-apply and MCP `update_workflow`).

## Decision 1 — Generation: `invopop/jsonschema`, committed files, a test as the drift gate

Schemas are generated from the existing `exported*` wire types by
`github.com/invopop/jsonschema` (verified before adoption, per the
reuse rule: MIT, pure Go — no cgo/Rust anywhere in its tree — draft
2020-12, actively maintained). Two properties made it the fit:

- **Deterministic output.** Struct properties render in declaration
  order via an ordered map; `$defs` marshals with Go's sorted map
  keys — two runs over the same types are byte-identical, which is
  what makes a committed, diffed schema file meaningful.
- **Required-ness inferred from `omitempty`** — exactly the
  convention the seven envelope types already follow, so no wire tag
  changes are needed to get correct required/optional semantics.
  Known exception, handled at adoption time: pointer fields tagged
  without `omitempty` (`Auth`, `JOSE` on the HTTPRequest envelope)
  would generate as required despite `nil` being legal — those tags
  gain `omitempty` (a no-op for `encoding/json` on nil pointers) or
  a per-field override where the wire tag must not change.

Generation lives in a new `internal/contract` package: a
`go:generate` entry writes one committed `*.schema.json` per family
under `internal/contract/schemas/`, embedded via `go:embed`. The
drift gate is a plain Go test — regenerate in memory, byte-compare
against the embedded files — so a type change without regeneration
AND a hand-edited schema fail the same always-running check; no
separate CI job, no gap between local and CI enforcement.

## Decision 2 — Schema identity: `mill://schema/<family>/v<major>`

Every generated schema carries
`"$id": "mill://schema/<family>/v1"` (the `mill://` scheme the MCP
resource plane already established), and every export envelope gains
a top-level `"schema"` field carrying the same value. Import
tolerates an absent `schema` field (every pre-existing export) and
rejects an unsupported major with an error that names the supported
ones.

Evolution rules (the single semantics goal 0046's entity-field ADR
consumes — one change-classification vocabulary, not two):

- **Within a major:** additive, optional-only. New optional fields
  with safe zero-value defaults may appear; readers MUST ignore
  unknown fields (already true of `encoding/json` decoding into the
  envelope types). No regeneration bumps the id.
- **Major bump, new id:** removing or renaming a field, changing a
  field's type, making an optional field required, or changing a
  field's meaning. Export always writes the newest major; import
  keeps accepting every major it can upcast, explicitly.

## Decision 3 — Exports include `id`; one create-vs-update semantics for every import path

`ExportWorkflow` and the six configure exports emit the entity's
`id`. The import contract is the one clipboard-apply already
implements (goal 0039), now stated as the uniform rule:

- id absent → create (a fresh local id is minted);
- id present and matching a local entity → **update** through the
  existing chokepoint (snapshot first, for workflows);
- id present and unknown locally → **create preserving the id** —
  this is what keeps one logical workflow's identity stable across
  the two-machine bridge (export at work, refine at home, write back
  by id).

Collision semantics across instances follow from the preview step:
an id that happens to exist locally is surfaced as "will update X"
before anything is written (clipboard-apply's existing
preview/confirm split), so a cross-instance id collision is visible,
never silent. File-picker imports adopt the same semantics with the
same visibility bar: an import that would update (rather than
create) must say so before writing. Determinism note: emitting `id`
adds a stable field — exports remain byte-identical when unchanged.

## Decision 4 — State manifest: its own surface, deliberately NOT in every entity export

The manifest (app version, embedded commit, schema ids with their
majors, server/desktop mode) is exposed as a `mill://manifest` MCP
resource and inside the root contract document (goal 0052 item 6).
It is NOT stamped into each entity export: exports are
byte-identical-when-unchanged by design (git-diffable data), and an
app-version field would churn every exported file on every upgrade
while carrying no per-entity information. The envelope's `schema` id
is the versioning an entity export needs; the manifest travels
beside the data, not inside it. (This amends goal 0052's acceptance
wording "present in exports" — recorded there with this reasoning.)

## Consequences

- The far side can hold the schema as the rule and any export as the
  few-shot example, and can write back by id without guessing.
- Schema evolution has one enforced grammar before the first
  breaking change is ever needed, instead of after (the failure mode
  goal 0046 documents from a real platform).
- `internal/contract` becomes the single home for contract
  artifacts; the root contract document and the live MCP surface
  derive from the same registries (goal 0052 item 6's anti-drift
  requirement), with this ADR's schemas as their shared base.
