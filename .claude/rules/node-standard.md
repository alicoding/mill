---
paths:
  - "internal/domain/composition/**"
---

# The Mill Node Standard

Every `NodeType` registered in `internal/domain/composition` (a
`RegisterNodeType` call, one per node — capture/process/apply/trigger/
decision/terminal) is reviewed against this checklist before it ships.
Adopted, not invented (CLAUDE.md's Research→Plan→Implement): converged
from the published conformance guidelines three real workflow/extension
platforms enforce on third-party nodes/plugins —
[n8n's community-node verification guidelines](https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/),
[n8n's UX guidelines](https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/),
[n8n's error-handling guidelines](https://docs.n8n.io/integrations/creating-nodes/build/reference/error-handling/),
[Zapier's app publishing requirements](https://platform.zapier.com/publish/app-publishing-requirements),
and the [Raycast store guidelines](https://developers.raycast.com/basics/prepare-an-extension-for-store)
(full research summary: `docs/goals/0030-node-standard.md` item 1,
2026-08-12). Mill's own three hard constraints (§1.1: no phone-home, no
AI API calls, single binary) rule out anything in those guidelines that
assumes a hosted marketplace or a network-calling extension host —
resolved item by item below, not silently dropped.

## The 9-item checklist

| # | Requirement | Enforced by |
|---|---|---|
| 1 | Typed `ConfigField`s, not raw JSON, wherever the shape is expressible | `TestNodeTypes` (`Key`/`Label` non-empty) + `typedfield.Field`'s typed `Type`/`Options`/`Default` — reviewed by eye per new node (no full JSON-schema-vs-typed-field detector exists) |
| 2 | Every `ConfigField` documents itself (`Description` non-empty) | `TestNodeTypes` (nodetypes_test.go) — machine-checked |
| 3 | Declared effect class (`Effect`), never the silently-permissive zero value | `TestNodeTypes` via the closed `pureNodeTypes` allow-list — machine-checked, see below |
| 4 | `Output` names what leaves the step, for every `NodeType` | `TestNodeTypes` — machine-checked, no kind exemption (verified: every registered `NodeType`, `apply-*`/terminal included, already declares one) |
| 5 | ID prefixed by its `Kind`'s naming convention | `TestNodeTypes` via the closed `idPrefixExceptions` allow-list — machine-checked |
| 6 | Fail-safe error semantics: an unevaluable/ambiguous condition counts as the *restrictive* outcome, never silently passes (ruleset's "a rule that cannot evaluate counts as failed"; guardrail's own condition-eval-failure rule) | Reviewed per node at authoring time — see "Error-prefix convention" below for why this stays a review checklist, not a grep-test |
| 7 | Seeded proof at the right layer (a built-in workflow/example exercising the node, or a unit/integration test for pure logic) — `.claude/rules/testing.md`'s layering | `TestBuiltInWorkflows_AllNodesFullyResolvedAndExecutable` + the node's own `*_test.go` |
| 8 | Secrets only via an existing credential-backed entity, never a raw `ConfigField` | Reviewed per node — see "The credential rule" below |
| 9 | Declared `Complexity` (`basic`/`advanced`), never the zero value — no allow-list exemption, unlike item 3 | `TestNodeTypes`, no exceptions — machine-checked, see "Complexity" below |
| 10 | The step I/O contract (ADR-0042): explicit `Consumes []PayloadKind` + `Produces PayloadProduce`, never the zero values — `[]PayloadKind{PayloadNone}` says "reads nothing" on purpose; `Passthrough: true` says the payload is forwarded unchanged | `TestNodeTypes`, no exceptions — machine-checked; `ValidateGraph` enforces edge compatibility (payloadkind.go) |

Items 1/4/5/6/8 were already true of every node in this package before
this standard was written down (`TestNodeTypes` already checked Key/
Label; `internal/adapters/credential` already write-only; every
existing node already seeded — item 7's own bar, stricter than any of
the three researched platforms, all of which stop at "document an
example," not "ship a runnable one"). Items 2/3/4-verified/5-verified
are what this goal (0030) added as new machine checks; conformance
audit against all of them found and fixed three real gaps (`list-lookup`/
`list-search` had no declared `Effect`, defaulting to the silently-
permissive zero value despite doing a real local read; `child-workflow`
had the same gap, resolved as explicit `ClassNone` per ADR-0022's own
stated design; `decision-route` had no `Output`) — see the commit that
introduced this file for the fixes.

## The credential rule (item 8)

A `ConfigField` never carries a raw secret (an API key, a bearer
token, a client secret) as its value. Every node that needs
authenticated access to something external goes through an existing
credential-backed entity instead — a `Connector`/`HTTPRequest`
(`internal/domain/connector`, `AuthType` dispatched through a
registered `AuthStrategy`, secret resolved via
`internal/adapters/credential`'s `zalando/go-keyring`-backed, **write-
only** storage) or an `MCPServer`. The node's own `ConfigField` only
ever holds that entity's ID (`RefKind: "request"` /
`RefKind: "mcpserver"` — `docs/adr/0009`), resolved server-side at
execution time; `composition` itself never reads a secret out of
`Node.Config` directly. This is why `integration-http`/`mcp-tool-call`
have no "API key" field of their own — the credential lives one layer
down, behind the picker.

## The operation-merge test (new families)

> A new capability family arrives as ONE `NodeType` carrying an
> operation `ConfigField` when its operations share all three of:
> the user's mental model, one guardrail effect class, and one
> result cardinality. It splits into separate `NodeType`s at any of
> those three lines — mental model (the AI trio's recorded
> precedent, docs/goals/0031), effect class (the guardrail gate
> reads `Effect` per NodeType, ADR-0022), cardinality (one result
> vs many — the Action/Search split the adopted platforms
> formalize). Adopted from goal 0113's research pass; the
> Jira/Confluence family (goal 0111) is the first consumer.
> Existing families are NOT retroactively merged — goal 0113's
> design pass records why (migration machinery absent; see the
> NodeType-versioning entry below).

## Effect (item 3) — the priority machine check

`NodeType.Effect`'s Go zero value (`""`) is silently indistinguishable
from `guardrail.ClassNone` at run time
(`composition.NodeTypeEffect`, `execute.go`), and every class except
`ClassExternal` defaults to **allow, no guardrail gate at all**
(`guardrail.DefaultEffect`, ADR-0022). A node with real I/O left at the
zero value runs ungated by accident, not by anyone's decision — the one
genuinely dangerous gap this standard exists to close. `TestNodeTypes`
enforces this with a **closed allow-list**
(`pureNodeTypes` in `nodetypes_test.go`): a node may only leave `Effect`
unset if its ID is on that list, with an inline reason (an entry-point
trigger/`decision-route` whose `exec` is `nil` and never reaches the
gate at all, or a node that provably touches only the in-memory
`ExecContext`, no I/O). Every other node must declare `Effect`
explicitly in its `RegisterNodeType` call — `ruleset`/`human-review`'s
`Effect: guardrail.ClassNone` written out is the house style, not
`ClassNone`-by-omission.

## Complexity (item 9) — the audience/progressive-disclosure facet

`NodeType.Complexity` (`ComplexityBasic` | `ComplexityAdvanced`,
`composition/types.go`) is the palette's progressive-disclosure facet
(`docs/goals/0047-node-audience-facet.md`): required for every
registered `NodeType`, with no `pureNodeTypes`-style exemption list —
unlike `Effect`, there is no legitimate reason for a node to have no
real classification. The rule: a node is `ComplexityAdvanced` iff
configuring it correctly needs either an external system's own
documentation (`integration-http`'s API contract, `mcp-tool-call`'s
tool schema) or hand-writing code/JSON/expressions
(`code-execution`'s script, `ruleset`'s rule conditions,
`list-search`'s match-parameter JSON, `child-workflow`'s attribute
bindings). Everything else — a plain value, a picker over an existing
Configure entity, a natural-language prompt — is `ComplexityBasic`.
Every declared step type (ADR-0037) is `ComplexityBasic` by
construction (`resolveDeclaredEntry`, `declaredsteptype.go`): a
declaration exists specifically to curate an advanced engine's
complexity away behind a fixed binding, so it never inherits the
underlying engine's own `Complexity`.

## Explicit rejections

Researched and deliberately NOT adopted, one line each:

- **n8n's publishing ceremony** (npm package naming/versioning, README/
  changelog requirements, submission review queue) — Mill has no
  hosted marketplace; a node ships in the same binary as everything
  else (§1.1's single-binary lock), so there is no separate publish
  step to gate.
- **CRUD completeness** (n8n/Zapier's expectation that a resource node
  expose create/read/update/delete symmetrically) — Mill's nodes are
  workflow *steps*, not resource-management SDKs; a node exposes
  whatever operation the workflow actually needs, not a full CRUD
  surface speculatively.
- **Raycast's no-keychain rule** (the store checklist steers extensions
  away from the OS keychain toward Raycast's own encrypted-preferences
  storage) — contradicts Mill's own deliberate `go-keyring` design
  (SPEC.md, `internal/adapters/credential`), adopted specifically
  *because* it's the OS-native secret store; Raycast's constraint comes
  from being a hosted extension platform managing many third-party
  extensions' secrets centrally, a shape Mill (single binary, single
  user, no hosted anything) doesn't have.

## `NodeType`-level versioning — latent, not built

Every one of the three researched platforms versions nodes/extensions
independently of the app that hosts them (n8n's node `version` field,
Zapier's app versions, Raycast's extension releases) so an existing
workflow keeps running against the node shape it was authored with
while a newer node version ships. Mill has the identical real need
(changing a `NodeType`'s `ConfigFields` today can silently break a
persisted `Node.Config`) but nothing analogous is built —
`Workflow.Versions`/`PublishedVersion` (ADR-0021) version the
*workflow*, not the `NodeType` definitions it references. Named here so
it isn't rediscovered as a surprise; not built speculatively ahead of a
concrete `NodeType` shape change that needs it (CLAUDE.md's Research→
Plan→Implement, same discipline `ConfigFieldType`'s own doc comment in
`types.go` already applies to Decision/Parallel's unbuilt field types).

## Error-prefix convention (item 6/8's sibling — reviewed, not grep-tested)

Every `nodeExec` function's returned errors are prefixed with that node
type's ID (e.g. `"child-workflow: %w"`, `"list-lookup: %w"` — see any
`*.go` file in this package) so a run's error trail names which step
failed without re-deriving it from context. This is checked at code
review time, not by an automated test: a test that greps this
package's `*.go` source for `return ctx, fmt.Errorf(...)` call sites to
verify a literal ID-prefix convention is exactly the kind of brittle
grep-over-source check that breaks on a harmless refactor (an extracted
helper, a wrapped error, a renamed local) without catching a real
regression. Skipped deliberately, not by oversight — revisit only if
this convention actually regresses in a way code review misses.
