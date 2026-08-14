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

1. **Generated schema for EVERY importable envelope** — owner
   principle, 2026-08-13: an export is an *instance*, a schema is the
   *contract*; an external author (an LLM that never touches the app)
   needs both — one exported example as the few-shot, the schema as
   the rule, since an example can't say what's required, legal, or
   variable. Seven envelope families exist today, all already
   import/export-paired at the service layer (Workflow +
   HTTPRequest/List/Decision/ExecEnv/MCPServer/AIProvider in
   configuresvc): each gets JSON Schema generated from its Go types
   (candidate: `invopop/jsonschema`; verify fit at implementation,
   adopt per the reuse rule). Committed, with a CI drift-fail when
   types change without regeneration (the generated-doc pattern goal
   0049 establishes for the ADR index — same mechanism, product
   surface).

   **Symmetry audit rides here:** enumerate every import-shaped
   surface (the seven envelopes; OpenAPI intake is exempt — its
   contract is the external OpenAPI standard) and verify each
   family's export is UI-reachable wherever its import is — a
   service method no surface exposes doesn't satisfy the
   import-implies-export rule.
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
6. **The agent-facing bundle, in two forms — one root document +
   queryable discovery** (owner-sharpened 2026-08-13, from the
   industry convention of a single all-APIs contract file: hand an
   LLM ONE artifact and it knows the whole surface):
   - **One root contract document** — a single generated file (and
     matching `mill://contract` MCP resource) that contains or
     indexes everything: every envelope schema (item 1), the node
     catalog with per-type config-field metadata, the import/update
     contract, invariants, and the state manifest (item 4). This is
     the transport form for MCP-denied environments — the far side
     gets one file over the clipboard/file bridge and needs nothing
     else. Assembled from the registries, never hand-authored.
   - **Queryable discovery for live contexts** — MCP already exposes
     the entity families as resources (`mill://workflows`,
     `mill://decisions`, …) and a `list_node_types` tool; extend
     node discovery with filter parameters (kind, and the
     audience/complexity facet once goal 0047 lands its metadata
     field) so an agent can search the catalog by type/metadata
     rather than pulling the full list — the same node-discovery
     shape the workflow-automation field converged on. The static
     root document and the live MCP surface are generated from the
     SAME registry code paths, so they cannot drift apart.

## Not in scope

Multi-instance sync, any network transport, any hosted registry —
the contract travels as files/clipboard/MCP, period (SPEC §1.1).

## Acceptance (checkable)

- [x] Every importable envelope (all seven families) has a generated
      schema; CI fails when types change without regeneration; a
      hand-edit fails the same check — slice 1 (ADR-0036):
      `internal/contract`, invopop/jsonschema, drift gate is
      `TestContractSchemas_MatchCommitted` (regenerate-and-compare, so
      local and CI enforce identically).
- [x] The symmetry audit is recorded in this file: all seven
      families verified bidirectional 2026-08-14 (inventory pass) —
      every family's export AND import reachable from its own page's
      row menu / file picker; no gaps found, nothing to fix.
- [x] Exports carry a stable schema id (`mill://schema/<family>/v1`
      in every envelope's `schema` field); evolution rules
      (additive-optional within a major, breaking changes bump) are
      ADR-0036 Decision 2 — the single change-classification
      vocabulary goal 0046's entity-field ADR consumes.
- [x] The export-id ADR is written and implemented (ADR-0036
      Decision 3; the compositionservice_export.go open question is
      resolved and its comment updated): all seven exports emit `id`,
      one uniform import rule everywhere, update-not-create confirmed
      by the committed round-trip test through the real
      clipboard-apply confirm path (prior state snapshotted).
      Re-import of a known id now updates in place behind a
      confirm-first dialog on every file-picker surface.
- [ ] State manifest readable via MCP; values match the build
      (asserted in test against build info). AMENDED by ADR-0036
      Decision 4: NOT stamped into entity exports — that would churn
      every exported file on every app upgrade, breaking the
      byte-identical-when-unchanged property; the envelope's schema id
      is the per-export versioning, the manifest travels beside the
      data (mill://manifest + the root document). Slice 2.
- [ ] A seeded workflow demonstrates the evidence-receipt node
      end-to-end (seeds ARE the proof).
- [ ] The root contract document is generated, committed,
      drift-checked, exposed as an MCP resource, and exportable as
      one file; node discovery supports type/metadata filtering; both
      forms derive from the same registry code paths (asserted by a
      test comparing them).
- [x] SPEC.md gains the contract-surface section — §9.6, LOCKED for
      the slice-1 mechanics, rejected-formats reasoning pointed at
      this file; remaining slices named there as not-yet-built.
