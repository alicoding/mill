# 0058 — Step inspector UX: config + input/output out of the tiny sidebar

**Raised:** 2026-08-14, owner-directed: "review the steps input and
output — the tiny sidebar for everything seems to be a weird
difficult pattern to work with." The canvas Inspector crams a
selected step's configuration into a narrow side panel, and a step's
actual input/output data lives elsewhere entirely (the Runs tab's
per-step detail) — configuring a step and seeing what flows through
it are split across surfaces, neither sized for the job.

## Goal

Review-first, then implement from the verdict (one goal, two
phases):

1. **Review** — precedent research on how the converged
   workflow-automation field presents a step's
   configuration-plus-data surface (the known strong precedent: a
   step detail view that opens LARGE — input data | configuration |
   output data side by side — because a sidebar structurally cannot
   hold config and data at once; verify against the current versions
   of the major tools, not memory), mapped honestly onto Mill's
   existing pieces (canvas Inspector, Runs per-step detail, step
   mode, TestRunDialog). Deliverable: a design verdict recorded here
   — which surface Mill adopts, what it reuses, what it deliberately
   rejects — plus the SPEC §3 update.
2. **Implement** — the decided surface, with the standing proof
   discipline (e2e for the interaction states; the seeded examples
   already provide the data to display). Scope guard: this is a
   presentation change over existing recorded data and existing
   config machinery — no new execution capability, no schema change.

## Constraints from what already exists

- Per-step input/output is already recorded and served (RunStep
  Input/InputAttributes/Output/OutputAttributes) — the Runs tab
  renders it today; step mode pauses per step; the receipt renders
  evidence. The review decides where this data SURFACES during
  authoring, not whether it exists.
- The generic ConfigField Inspector (no bespoke per-node UI) is a
  deliberate, working pattern — the review may resize/relocate it,
  not fork it into per-node custom forms.
- Primer-first (frontend.md): whatever surface is chosen builds from
  the kit's own components (Dialog/SplitPageLayout/whatever fits),
  never hand-rolled chrome.

## Acceptance (checkable)

- [ ] Precedent review recorded here (per-tool, current versions,
      primary sources) with an explicit verdict: the chosen surface,
      what it reuses, what it rejects and why.
- [ ] The chosen surface implemented: a step's configuration AND its
      latest recorded input/output visible together at a workable
      size, reachable from the canvas without leaving authoring
      context.
- [ ] Existing patterns honored: generic ConfigField rendering
      unchanged in kind; Runs tab remains the run-history home; no
      regression to canvas drag/connect interactions (e2e-pinned).
- [ ] SPEC.md §3 updated (the authoring-surface section gains the
      step-detail decision with status).
