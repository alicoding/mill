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

## Review verdict — DECIDED 2026-08-14 (owner-picked from ranked mockups)

Precedent research (primary sources, current versions, full report in
the session record): the actively-evolving field (n8n, Windmill,
Retool, Zapier) converged on step config and step run data living in
ONE interaction opened from the canvas; only n8n gives true
side-by-side co-visibility (its Node Details View: input | parameters
| output panes, opened on double-click, with Schema/Table/JSON data
views and drag-to-map from input to fields). Node-RED's
config-drawer-plus-separate-debug-sidebar is the abandoned shape —
and structurally the closest to Mill's current 260px inspector +
separate Runs tab, which is exactly the pain raised. Key grounding:
`NodeInspector.tsx` ALREADY receives `runStep` and renders
`NodeExecutionSection` — the data is plumbed; only the surface is
wrong.

**Chosen: the three-pane step-detail overlay** (owner-picked over a
bottom data drawer and a tabbed modal, both recorded as rejected —
the drawer leaves config cramped, tabs never co-show config and
data): double-click (or an explicit expand affordance) opens a large
overlay above the canvas — input (last recorded run) | the existing
generic ConfigField rendering | output — with text/JSON toggles on
the data panes; Esc/click-away returns to canvas; the sidebar stays
for quick glances. Drag-to-map from input into fields is explicitly
DEFERRED (n8n's expression-mapping machinery is a capability, not a
layout — it gets its own goal if wanted). Build from Primer's kit
per frontend.md.

## Acceptance (checkable)

- [x] Precedent review recorded here (per-tool, current versions,
      primary sources) with an explicit verdict: the chosen surface,
      what it reuses, what it rejects and why.
- [x] The chosen surface implemented: a step's configuration AND its
      latest recorded input/output visible together at a workable
      size, reachable from the canvas without leaving authoring
      context.
- [x] Existing patterns honored: generic ConfigField rendering
      unchanged in kind; Runs tab remains the run-history home; no
      regression to canvas drag/connect interactions (e2e-pinned).
- [x] SPEC.md §3 updated (the authoring-surface section gains the
      step-detail decision with status).
