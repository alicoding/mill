# 0008 — Authoring validation panel + the workflow-ending model

## Goal
Raised live (2026-08-10) from a real demonstrated gap: the owner saved
a workflow whose only node was a Capture (no trigger, no ending) —
`findRoot` requires exactly one root but never checks its Kind, and
Mill has no authoring-validation surface (both reference platforms
show all issues at once; Mill emits one save-rejection string).
Validation ownership clarified: **Mill's own
`composition.ValidateGraph` owns all graph rules** (client mirrors at
draw/save time); DBOS owns none of it (pure execution durability).

## Decided (owner, 2026-08-10)
- **Errors block save; warnings don't** — the severity contract, per
  the owner's direct platform experience ("error is not allowing
  people to save").
- **A non-Trigger root is an ERROR** (blocks save) — matches n8n's
  hard requirement and §3.4's own "a trigger's output IS the
  workflow's input — one concept."
- **Validation panel priority: next after goal 0007.**

## The design core (OPEN — decide via a small ADR before building)
The owner's instinct ("even the coding loop will have a terminal; the
terminal can have different outputs — or no message but still be a
decision") exposes a real inconsistency: Mill's built model has Apply
as a chainable mid-kind and Decision as the only terminal kind, but
the owner's own recorded architecture treats delivery as terminal —
ADR-0023's pipeline ends in "a terminal node whose target is the DOM,
falling back to clipboard," and §3.8's prototype taxonomy has no
Apply category at all, only TERMINAL. Proposed synthesis to evaluate:
**"terminal" is the ending concept with two flavors** — typed Decision
outcome (ADR-0027; empty-outputs decisions are legal, "categorize the
ending") and delivery terminal (clipboard/DOM write). A workflow must
end in a terminal flavor (error or warning — decide), and a Process
leaf is at minimum a warning ("computed something, delivered it
nowhere"). Key sub-question that decides the shape: is Apply ever
legitimately mid-chain (write clipboard THEN call an API)? If no real
case exists, Apply unifies into terminal-kind (no source handle,
matching decision-outcome); if yes, Apply stays chainable and the
rule is "must END in Apply-or-Decision" instead. Interacts directly
with ADR-0026's code-execution pipeline (its terminal is DOM/clipboard
delivery with §5's fallback order) — decide both against that.

## Plan
1. [ ] Small ADR: the ending model (Apply-as-terminal vs ending-rule),
   the full initial rule list with severities (missing-trigger-root:
   error; Process leaf: warning at minimum; unreachable node: error?;
   unconfigured required ref (decisionId/requestId empty): warning or
   error — check what execution does today), and whether draft-save
   leniency vs publish-strictness should differ (ADR-0021's
   draft/publish split exists; owner's stated pattern is errors block
   SAVE — confirm this applies to drafts too, or errors block
   publish/arming while draft saves warn).
2. [ ] `ValidateGraph` returns a full issue LIST with severity (today:
   first error only); save keeps rejecting on errors.
3. [ ] Editor validation surface: toolbar badge (n/errors, n/warnings)
   + expandable issues panel + per-node canvas badges (the guardrail
   badge's nothing-hidden pattern); issues link to/select the
   offending node.
4. [ ] The MCP authoring loop gets the same list (`validate_workflow`
   returns all issues, not first-error) — ADR-0025's iterate-against-
   errors loop improves for free.
5. [ ] E2e + seeds per the standing rules.

## Acceptance
The owner's exact repro (single-Capture workflow) can no longer save,
with a clear multi-issue panel explaining why; a trigger+process-leaf
workflow saves with a visible warning; the ending-model ADR is
accepted and enforced consistently across canvas, save, and MCP
validation.
