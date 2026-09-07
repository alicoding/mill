# Architecture & reuse discipline

No `paths` frontmatter — cuts across Go/TypeScript, loads every session
like CLAUDE.md.

**SOLID, DRY, DDD with a concrete reuse boundary.** Buy generic/
commodity concerns (parsing, UI widgets, OS plumbing, wire protocols)
via a well-vetted library. Mill's own **core domain** — what a guardrail
evaluates and why, Capture → Process → Apply, the action/capability
model, session-identity resolution — stays hand-written, behind
ports/adapters at the domain boundary.

**Research → Adopt → Compose for any new capability.** Research what
exists (a real search, never an assumption); adopt the proven commodity
behind ports/adapters; compose the remainder from Mill's own primitives
(nodes, triggers, Configure entities — ADR-0035). Hand-roll only when
research shows nothing satisfies the hard constraints (§1.1).

**Default to adopting over hand-rolling, even when hand-rolling would be
smaller.** The deciding question is who owns and maintains this six
months from now — infrastructure-shaped code (durable execution, retry/
backoff, queues) becomes unbounded maintenance once hand-rolled. A
*shape* (a UI component family, a CLI parser) can be commodity with no
single named library — check the kit first.

**Adopting a dependency means reading its whole API, not what day one
needs.** Before building ANY capability inside a domain an adopted
dependency owns — enumerate its
API from its vendored source and state what you found, including
"nothing," via one grep of `~/go/pkg/mod`/`node_modules`. Confirmed:
goal 0190. Every
cgo file carries a `framework-api-audit` line pinned to Wails' version
(`scripts/check-framework-api-first.sh`).

**The core/composition boundary, both directions.** Before ANY new
capability: node, trigger, connector, or true kernel change
([ADR-0035](../../docs/adr/0035-core-vs-composition-boundary.md), SPEC
§9.5)? "That again, with a different channel/condition/event" arrives as
composition — never a bespoke service path or a Settings toggle
implementing a side effect (toggles configure the kernel). The other
direction: outside→inside doors (webhooks, agent hooks, watchers) fire a
platform TRIGGER; the effect is an editable workflow or plugin, never a
hardcoded pipe. Platform-internal behavior SHOULD consume Mill's own
composition surface. Kernel changes (SPEC §9.5 list) need an ADR.

**Build the multi-purpose surface, not the hardcoded use case.** A new
affordance: if a SECOND consumer is plausible, it arrives as a named,
reusable surface (goal 0122) — never one-off.

**Every user-facing action arrives as a registry command, with an
honest enablement predicate** (goal 0222, `shared/commands.ts`). `onClick`
calls `findCommand(id)?.run()`, never acts inline; state-dependent
validity lives in `Command.enabled`, never a silent inline guard. A
mouse-only action needs a stated reason (`Command.paletteHidden`).

**Configure entity vs. node-local config.** A `ConfigField` is a
Configure-entity reference (`RefKind`, ADR-0009) when independently-
authored workflows want the *same* value; node-local when it's that
workflow's own decision-making. Checked against every `NodeType` (goal
0031); revisit only on a new failing field.

**Max 500 lines per hand-written source file.** Enforced by
`scripts/check-loc.sh` (Lefthook + CI). Crossing it means a missed seam
— split, never truncate or suppress. Generated bindings and vendored
gomobile scaffold are exempt.

**The repo root is an allowlist, not a scratch space.** Enforced by
ls-lint. Temp files go in the session scratchpad. A new root file/
directory is an ADR-0001 decision — extend `.ls-lint.yml` deliberately.

**Adopting a library means adopting its CONTRACT, not just its API.**
Thread affinity, reentrancy, blocking behavior, error semantics don't
appear in a signature. Before calling an adopted library from a
callback/goroutine/handler it did not itself create, VERIFY the
affinity contract against its own source and state it at Mill's
boundary. Never infer one call's contract from a sibling's — has cost a
P0 crash class here.
