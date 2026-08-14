# 0055 — Canvas note block (authoring-space annotation)

**Raised:** 2026-08-14, owner: documenting steps inside the authoring
space is a legitimate converged pattern ("I've seen in n8n at least
that pattern" — sticky notes on the canvas), distinct from the
workbench question (goal 0056) and buildable independently.

## Scope

A free-floating note/annotation block on the workflow canvas: plain
text (markdown rendering optional, decided in-goal against precedent),
movable/resizable, saved with the workflow, exported with it (it's
part of the workflow's definition, so it rides the same envelope —
which means the 0052 schema must include it if 0052 lands first;
coordinate whichever goal is second). NOT a step: it has no
execution, no edges, no config — verify the canvas/store/export
model can carry a non-step element cleanly before building
(capability check, not assumption).

## Research to open with

n8n sticky notes as the primary precedent (grouping/color behavior),
plus the other canvas tools' annotation shapes — what converged
(free note vs attached-to-step comment vs both), what's ignored in
practice. Pick the minimal converged shape; no color-taxonomy
speculation without evidence people use it.

## Acceptance (checkable)

- [ ] A note can be added, edited, moved, and deleted on the canvas;
      persists with the workflow; round-trips export/import.
- [ ] Notes are visibly not steps (no ports, excluded from
      execution/validation paths — asserted in a test).
- [ ] Seeded example workflow carries at least one note documenting
      its own steps (seeds ARE the proof).
- [ ] E2e covers add/edit/persist; unit covers any pure layout/
      serialization logic.
- [ ] SPEC §3 canvas section updated in the same change.
