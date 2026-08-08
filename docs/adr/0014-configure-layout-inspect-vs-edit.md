# ADR-0014: Configure layout — inspect-vs-edit split, one-scroll authoring, own pinned tab

## Status
accepted

## Context

Raised directly by the user, after a screenshot of a live error on the
Configure→Integration page: "since it is a full page and not while you
are editing in the workflow authoring space I don't know if we should
be hiding everything that way on the configure page." `ConnectorForm.tsx`
today crams General/Auth/Headers/Schema/Test into five Primer `Tabs`
inside a narrow inline card on `ConfigureIntegration.tsx`'s own list
page — a pattern borrowed from Composition's canvas Inspector, where
tabbing makes sense because the Inspector is genuinely space-
constrained (a side panel next to a canvas). Configure has no such
constraint — it's a full page — so the same pattern may be the wrong
fit there.

Researched rather than guessed at: a real screenshot walkthrough plus a
fuller consolidated review of a comparable no-code decisioning
platform's own Integration surface (`docs/SPEC.md` §3.2's Update and
its follow-up Update, kept vendor-name-free per the standing rule).
Direct finding: that platform tabs the **saved/view** summary (Details/
Available attributes/Input parameters/Testing) but uses **one long
guided scroll with no tabs at all** while actually creating/editing,
opened as its own pinned tab in the platform's own app-wide tab bar —
list stays visible, dimmed, alongside it. Ten reused UX patterns named
directly in that review reinforce the same conclusion, most relevantly
the "inspect-vs-edit split" — "use compact inspect tabs for
understanding and a separate full-width editor for mutation. Do not
reuse the inspect tabs as fragmented authoring steps."

## Decision

### 1. A saved connector opens read-only, tabbed; editing is a
deliberate mode switch

A new `ConnectorSummary.tsx` renders a saved `Connector`'s existing
data (already fetched by `ConfigureIntegration.tsx`, no new backend
call) across four tabs — **Details** (a flat key/value dump: BaseURL,
AuthType, Headers, whether an OpenAPISpec is set), **Available
attributes** (what a workflow node can reference once wired to this
connector — today's InputFields/OutputFields via `ConnectorOperationFields`),
**Input parameters** (the declared operations/schema, read-only), and
**Testing** (embeds the existing `ConnectorTestPanel.tsx` unchanged —
it already only needs `operations`/`effectiveSpec`/`baseURL`/etc., all
derivable from the saved `Connector` with no draft-specific state).
Delete/Duplicate/Edit render as explicit top-level actions, matching
`ConfigureIntegration.tsx`'s existing row actions moved up into the
open view. `LOCKED`

### 2. Create/Edit is one continuous scroll, not tabs

`ConnectorForm.tsx`'s five `Tabs`/`TabPanel` sections become `Heading`-
delimited sections in one scrollable column, in the same order they
already appear (General → Auth → Headers → Schema → Test) — the
underlying `ConnectorDraft` state shape, `onDraftChange`/`onSave`
contracts, and the `effectiveSpec`/`effectiveOperations` computation
(the exact mechanism that already avoids the documented stale-manual-
schema-mode bug, `.claude/rules/testing.md`) are **unchanged** — this
is a rendering-structure change only, not a data-flow rewrite. `LOCKED`

### 3. Opened as its own pinned tab, reusing `Tabs.tsx`

`ConfigureIntegration.tsx` adopts the exact `EditorTab{key, workflowId}`
/ `tabs`/`activeTab` state shape `CompositionView.tsx` already built
and proved out (`crypto.randomUUID()` per new tab, `openEditTab`
reuses an existing tab for the same connector instead of duplicating,
`closeTab` falls back to the pinned list tab) — same component
(`shared/Tabs.tsx`), same mechanism, extended to a second Configure
surface for the first time rather than reinvented. `ConnectorSummary`
and `ConnectorForm` both render inside a `TabPanel`, exactly like
`CompositionCanvas` does today. `LOCKED`

## Consequences

- New: `frontend/src/configure/ConnectorSummary.tsx`.
- `ConnectorForm.tsx`: `Tabs`/`TabPanel` sections replaced by `Heading`
  section breaks; no change to its props, state, or save logic.
- `ConfigureIntegration.tsx`: "New connector"/row-click/Edit switch
  from opening an inline card to opening/reusing a pinned `Tabs` tab;
  Delete/Duplicate stay on the list row (fast actions, no need to open
  a tab for them) — Edit and clicking a row both open the same kind of
  tab (view vs. edit), matching `CompositionView`'s own `openEditTab`
  precedent.
- Every other Connector-testing/duplicate/schema-authoring capability
  (ADR-0011, ADR-0013) is unaffected — this ADR only moves where those
  already-built pieces render, not what they do.
- Playwright: `configure-integration.spec.ts` and
  `connector-test-panel.spec.ts` updated for the new navigation (open
  a tab, confirm the read view's four tabs and Delete/Duplicate/Edit,
  confirm Edit reopens into the scroll form with existing values
  loaded, confirm editing the same connector twice reuses one tab) —
  a real interaction change, per `.claude/rules/testing.md`'s own
  discipline, not just a manual click-through.
