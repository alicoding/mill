# 0052 — Contract maturity: generated schema, versioned envelope, receipts

**Raised:** 2026-08-13, owner-directed after the first far-side bridge
contact (goal 0044's captured requirements) and seeing schema-first
contract discipline (protobuf/gRPC) at work: adopt the mature pattern
so external agents and tools can interoperate with Mill without
hand-written, driftable documentation.

## The mature pattern, translated to Mill

What protobuf-style discipline actually consists of — schema as the
single source of truth, generated (never hand-written) artifacts,
stable identifiers, explicit evolution rules so new versions never
break old readers — adopted in the format that fits Mill:
**JSON Schema generated from the Go types**, not protobuf itself.

Rejected at the format level, with reasons (recorded so they aren't
re-litigated):
- **Protobuf/gRPC** — binary payloads defeat human-inspectable
  transport (the thesis; the bank bridge is literally text over a
  clipboard), there is no cross-service mesh to feed, and codegen
  toolchains would join the build for zero consumers. The
  *discipline* is adopted; the wire format is not.
- **OpenAPI** — describes HTTP APIs; Mill's agent planes are MCP and
  file/clipboard envelopes, neither HTTP-shaped. MCP already uses
  JSON Schema for tool definitions — same family this goal adopts.

## Scope (absorbs far-side gaps 1, 2, 4 from goal 0044; gap 3 rides)

1. **Generated `workflow.schema.json`** — JSON Schema for the
   export/import envelope, generated from the Go types (candidate:
   `invopop/jsonschema`; verify current fit at implementation, adopt
   per the reuse rule, hand-roll only on demonstrated misfit).
   Committed, with a CI drift-fail when the types change and the
   schema wasn't regenerated (the exact generated-doc pattern goal
   0049 establishes for the ADR index — same mechanism, product
   surface).
2. **Stable schema identifier** — a `SCHEMA_ID`/version embedded in
   exports and the schema itself; evolution rules (what may change
   within an id, what forces a new one) decided in coordination with
   goal 0046's schema-evolution ADR — one set of semantics, not two.
3. **Export id resolution** — the recorded open question in
   `compositionservice_export.go` (export omits `id`; import accepts
   it) now has a real consumer needing pre-image → modify → write-back.
   Resolve by ADR: likely export-includes-id with import semantics
   unchanged (id-match = update through the existing chokepoint), but
   the ADR owns the call, including collision behavior across
   instances.
4. **Machine-readable state manifest** — app version / schema id /
   commit (all already known live) exposed where an external agent
   can read them: an MCP resource plus inclusion in exports/receipts.
5. **Evidence envelope (far-side gap 3)** — a portable run receipt
   (run result, approval evidence, versions, exit data) emitted via
   composition (an apply-node writing the receipt to
   clipboard/file), per the ADR-0035 boundary. Rides here as the
   contract's return path; splits out to its own goal only if
   implementation shows it's bigger than one session.
6. **The agent-facing bundle** — the far side's MILL-EXPERT-shaped
   ask (taxonomy, invariants, import contract) becomes a *generated*
   artifact assembled from the registries and the schema above,
   never hand-authored prose; exposed as MCP resources and an
   exportable file set.

## Not in scope

Multi-instance sync, any network transport, any hosted registry —
the contract travels as files/clipboard/MCP, period (SPEC §1.1).

## Acceptance (checkable)

- [ ] `workflow.schema.json` generated from Go types; CI fails when
      types change without regeneration; a hand-edit fails the same
      check.
- [ ] Exports carry a stable schema id; the id's evolution rules are
      recorded in the same ADR that goal 0046 consumes (one
      semantics, cross-referenced).
- [ ] The export-id ADR is written and implemented; a far-side-shaped
      round trip (export → modify → reimport-as-update) passes as a
      test through the real import path.
- [ ] State manifest readable via MCP and present in exports; values
      match the build (asserted in test against build info).
- [ ] A seeded workflow demonstrates the evidence-receipt node
      end-to-end (seeds ARE the proof).
- [ ] The agent bundle is generated, committed, drift-checked, and
      exposed via MCP resources.
- [ ] SPEC.md gains the contract-surface section (status LOCKED for
      the format decision, with the rejected-formats reasoning
      pointed at this file).
