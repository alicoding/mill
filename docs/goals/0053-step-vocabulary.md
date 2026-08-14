# 0053 — "Step", not "node": user-facing vocabulary rename

**Ratified:** 2026-08-13, owner decision after precedent review:
"step" resonates with developers too — a step in the workflow, not a
node in the workflow; "which node?" is graph jargon, "which step?" is
a question about work — while staying generic enough to not read
engineer-only. Precedent: the business-user-facing field converged on
step/action (the developer-first tools are the ones that say node);
Mill's own run history already says step (`RunStep`, the Activity
surface's per-step detail) — the app currently speaks two dialects,
and this goal picks the one users already see in their run results.

## Scope — three tiers, priced differently

1. **UI copy sweep (this goal's build work):** every user-facing
   "node" becomes "step" — locale JSON (`frontend/src/locales/`),
   palette labels/groups, editor/canvas copy, Settings, seeded
   entity descriptions, SPEC.md's user-facing vocabulary where it
   describes surfaces. Gate-checked by the existing ui-copy/
   ux-writing machinery; the sweep includes verifying no copy string
   mixes dialects afterward.
2. **Wire vocabulary (decided here, implemented inside goal 0052):**
   the export envelope's `nodes` field, schema names, and MCP
   discovery tool names (`list_node_types`) adopt step terms as part
   of 0052's contract freeze — this goal is sequenced BEFORE 0052
   precisely so the contract never ships the rejected word under a
   stable schema id (rename-after-freeze is the breaking-change
   class goal 0046 exists to prevent). Exports are human-inspectable
   by thesis: wire and UI must agree.
3. **Internal code identifiers: untouched, deliberately.**
   `NodeType`, `composition.Node`, bindings, test ids stay — code is
   not user-facing (the same split ux-writing.md already draws), and
   churning hundreds of references buys users nothing. The
   boundary: if a string reaches an eye that isn't reading source,
   it says step; if it's an identifier in code, it stays.

## Acceptance (checkable)

- [ ] No user-visible surface (locale strings, palette, editor,
      Settings, seeded descriptions) contains "node" as the term for
      a workflow step; grep-verified across locales +
      manually-eyeballed canvas/palette pass.
- [ ] SPEC.md's surface-describing sections use step; internal/
      architecture sections may keep Node where naming code types.
- [ ] Goal 0052's contract items reference this decision and ship
      step-vocabulary wire names (checked there, recorded here).
- [ ] Internal identifiers demonstrably unchanged (no mass rename in
      the diff).
- [ ] E2e/unit suites green; any test asserting on visible copy
      updated in the same change.
