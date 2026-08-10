# 0013 — Canonical type system (the platform-kernel investment)

## Goal
One typed-field/schema vocabulary across the platform, replacing the
four that accreted (`openapispec.Field`, `AttributeDef`,
`decision.OutputField`, `ConfigField`) — plus the growth path from
string payloads toward the owner-prototype's named, versioned payload
schemas (`mill.shell-block.v1`, SPEC §3.8). Identified in §9.5's
kernel assessment as the single investment that makes the next ten
capabilities cheaper instead of each adding a fifth vocabulary; every
owner-supplied reference review independently demanded it ("one
canonical type model with resource-specific editor presentations").

## Approach (Research → Plan → Implement; ADR before code)
1. Capability map first (CLAUDE.md's Plan rule): every current and
   known-future consumer — Attributes, Connector in/out schemas,
   Decision outputs, List columns (0011 forces typed Object output),
   ConfigFields, workflow input/output contracts, Action/code-exec
   contracts, test-fixture generation (zod bridge), the §3.8 schema
   registry. Decide the one Go shape + the one TS mirror + the one
   editor foundation (§4.1's shared hierarchical schema-editor row).
2. Migration strategy per vocabulary (adapters keep wire
   compatibility; no big-bang).
3. Sequence AFTER goal 0004 (code execution) unless 0011 is pulled
   forward — whichever first forces typed structured payloads.

## Design (architect pass 2026-08-10 → [ADR-0029](../adr/0029-canonical-type-system.md), `proposed`)
New leaf package `internal/domain/typedfield` (can't live in
composition — the decision/list import cycle the current bare-string
workaround dodges). Phased migration: P1 AttributeDef+ConfigField as
type aliases (zero wire migration, Attributes gain Options/Required/
Default immediately — meets the "two converged" bar); P2 decision
(EnumValues→Options, ADR-0016's precedented rename); P3 openapispec
(embed+extend for In/Path, largest UI surface — deferrable). Shared
editor consolidation belongs to 0011, not here. THREE owner decisions
teed up (ADR §Open): RefKind core-vs-extension, flat-Type sufficiency
for 0011's object/array, and whether P3 is in-scope.

## Acceptance
An accepted ADR; at least two of the four vocabularies actually
converged onto the canonical shape with zero wire breakage; new
capabilities demonstrably declare fields once against it.
