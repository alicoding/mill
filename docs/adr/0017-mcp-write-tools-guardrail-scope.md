# ADR-0017: Guardrail scope for MCP-driven writes

Status: accepted — fully implemented (coarse default-off gate + export/import tools, and per-write synchronous approval via ADR-0022's MCP section: a bounded 120s in-process park surfaced in Mill's window, approval-required by default whenever writes are enabled)

## Context

Task #12 (this session) built Mill as an MCP server exposing its own
workflows and Configure-authored entities as **read-only** Resources
(`docs/SPEC.md` §3.6's Update). The natural next capability — an
external MCP client calling **Tools** to create or import a workflow,
HTTPRequest, List, or MCP Server definition — is a materially different
risk than the read side, for one specific reason: it would be the
first path in Mill where an action that mutates Mill's own automation
definitions can be initiated by something other than a human clicking
a button in Mill's own UI.

`docs/SPEC.md` §8 (Guardrails/policy) is still `OPEN`. What exists
today is a *researched scoping design* — three layers (node-kind,
Connector, workflow), deny-always-wins precedence, `expr-lang/expr`
reused rather than adopting OPA/Rego — and zero implementation.
`internal/domain/guardrail` does not exist. There is no mechanism in
Mill today that gates *any* action, human- or agent-initiated.

Per CLAUDE.md: "If `docs/SPEC.md` marks something `OPEN`, do not
silently resolve it by implementing one option — surface the choice."
Shipping working MCP write Tools without a guardrail mechanism behind
them would be exactly that — silently resolving §8 by building on top
of the "no guardrail exists yet" default, for the single riskiest
action category this repo has considered so far (an unattended,
network-reachable actor creating persisted definitions). This ADR
exists to write down the shape of the eventual decision, and to record
explicitly why nothing beyond the read side got built this session.

## What §8's existing scoping design doesn't cover

§8's three-layer model (node-kind / Connector / workflow) was scoped to
one specific question: *"should this node's execution, during a
workflow run, be auto-approved or require a check?"* — i.e., it governs
**running** an already-authored workflow. Creating or importing a
workflow definition in the first place is a different action entirely,
and none of the three layers apply to it: there is no node-kind, no
Connector, and no workflow yet at the moment of the write. A fourth,
orthogonal gate is needed — call it **authoring-capability scope**:
whether an external actor (a specific MCP client connection, or MCP
writes as a whole) is allowed to create/modify Mill's own definitions
at all, independent of what any individual node inside the result would
do when later run.

## Options

**Option A — No MCP write Tools at all, indefinitely.** Keep Mill's MCP
surface read-only until §8 has a real, implemented mechanism (not just
a scoping design) to hang an authoring-capability gate on. Costs
nothing to maintain, but permanently forecloses the capability this
session's broader scope (§11, the import/export + MCP work) was
building toward.

**Option B — Ship MCP write Tools gated by a single, coarse, default-off
toggle; every write still requires synchronous human approval in
Mill's own UI.** Concretely: a Settings-level "Allow MCP Tools to
create workflows/Configure entities" switch, off by default (§2.2's
already-locked "progressive enhancement by permission, not a hard
gate" principle — the capability doesn't exist for a user who hasn't
opted in, same shape as Accessibility-gated features). When on, an
MCP `create_workflow`/`import_workflow`/etc. Tool call does not
complete until a human approves it via a real dialog in Mill's running
UI — the MCP response blocks on that approval, mirroring §2.1's
already-locked "the hotkey press is the guardrail gesture" principle:
a deliberate, human-initiated confirmation, not a silent auto-run.
This is the option this ADR recommends, once its two open sub-questions
below are actually resolved — not before.

**Option C — Ship MCP write Tools with §8's full three-layer
skip-rule engine, so some writes can be pre-approved.** Rejected for
now, not permanently: §8's skip-rule *authoring UI* doesn't exist
either (the scoping design names it, nothing builds it), so this option
requires building two unimplemented things (the authoring-capability
gate *and* a real skip-rule engine with an authoring surface) before
anything ships. Worth revisiting once Option B is live and real usage
shows whether always-synchronous approval is too much friction for a
legitimate, trusted workflow.

## Recommendation

**Option B, once two genuinely open sub-questions are answered — not
guessed at here:**

1. **Does a real MCP host tolerate a long-blocking tool call** while it
   waits on a human to click approve/deny in a separate application
   window? The MCP spec's request/response shape doesn't preclude a
   slow response, but no real-world behavior has been checked against
   an actual client (Claude Desktop, Claude Code, etc.) — a host with
   its own client-side timeout could simply fail the call before a
   human ever sees the prompt. This needs an actual test against a
   real MCP client, not an assumption, before Option B is implementable
   as designed.
2. **What "approval" UI is shown**, and whether it can render enough of
   the proposed write (a workflow's real node graph, not just its ID)
   for the approval to be meaningful — the same "make sure the human's
   view and the AI's about-to-happen action are the same view, before
   it happens" principle §1's own thesis already states, applied to
   this specific new surface. Not designed here; a real UI pass of its
   own once Option B is chosen.

## Consequences

- Read-only MCP Resources (task #12) ship now; MCP write Tools do not.
  Nothing in `millmcpservice.go` registers a `Tool`, only `Resource`/
  `ResourceTemplate` — this is enforced by what's simply absent from
  the code, not a flag or a check that could be silently flipped.
- The next real step, if this direction is taken, is answering the two
  sub-questions above — likely via a small spike against a real MCP
  client — before any write-tool code is written, not alongside it.
- This ADR does not resolve §8. It narrows one future corner of it
  (authoring-capability scope for MCP-originated writes) and records
  why that corner needs its own gate, distinct from the node-execution
  layers §8 already scoped.

## Status

`proposed` — no implementation exists or is planned until the two open
sub-questions above are answered. `docs/SPEC.md` §8 remains `OPEN`.

## Update — export/import tools shipped behind Option B's coarse gate; per-write approval still open

The user explicitly asked for MCP-side management of Mill's data
("manage the app data ... including import or export JSON for Workflow
or Configure ... that also include List") -- the human decision this
ADR was waiting on for whether the capability should exist at all.
What shipped (`millmcpservice_tools.go`):

- **Eight tools over the existing export/import model** — `export_workflow`/
  `export_request`/`export_list`/`export_mcpserver` (read-only,
  ungated -- the same data the Resources already expose, reshaped as
  callable tools since real hosts reach for tools far more readily
  than resources) and `import_workflow`/`import_request`/`import_list`/
  `import_mcpserver` (each a thin wrapper over the exact `Import*`
  method the UI's own Import button calls -- always mints a new ID,
  never overwrites, never touches a secret).
- **Option B's authoring-capability gate, coarse half**: a default-off
  Settings toggle ("Allow MCP clients to import data",
  `SettingsService.Get/SetMCPWriteEnabled`, stored as
  `mcp-write-tools-enabled`), read fresh on every import call so
  flipping it applies immediately. While off, an import tool returns a
  tool-error pointing the agent at Mill's Settings page -- proven
  against a real MCP client over real HTTP
  (`TestMillMCPService_Tools_ImportGatedExportOpen`), including that
  nothing is written while the gate is off.

**Deliberately not shipped, still open — not silently resolved**: the
per-write synchronous human approval (Option B's second half) and its
two sub-questions (host timeout tolerance for a blocking tool call;
what the approval dialog renders). The toggle is per-instance opt-in a
human sets in Mill's own UI -- a real gate, but coarser than
per-write approval; revisit once §8's guardrail machinery exists to
hang a real approval flow on.

Status: `accepted` (the gate + tool set above); the per-write-approval
half stays `proposed` future work.
