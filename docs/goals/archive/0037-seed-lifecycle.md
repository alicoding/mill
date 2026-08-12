---
# 0037 — Seed lifecycle: provenance, upgrade-in-place, reset, restore

## Goal
Owner-delegated, research-locked design (orchestrator, 2026-08-12).
Today's seeded-example machinery (`internal/services/seeding`,
`topUpBuiltIns`/`topUpBuiltIn*`) only ever does one thing: insert a
golden if its ID is absent and untombstoned. Two real gaps that
follow from that:

1. **A shipped golden can never improve an existing install.** If a
   seeded workflow's content changes in a later Mill release (a bug
   fix, a clearer example), an existing instance's already-present
   copy is never touched — the "top-up" only covers brand-new IDs.
2. **No distinction between "still exactly what shipped" and "the
   user has edited this."** Without that distinction, an upgrade
   can't safely decide whether it's safe to touch an existing artifact
   at all — clobbering a user's edit would be exactly the silent-
   overwrite failure class this design exists to avoid.

Researched precedent (CLAUDE.md's Research→Plan→Implement — this is a
genuine prior-art problem, config-management/GitOps solved it years
ago):

- **Kubernetes Server-Side Apply** moved from client-side hash/diff
  detection (`kubectl apply`'s three-way-merge annotation, notoriously
  fragile under concurrent editors) to **write-time field ownership**:
  each write records who owns each field, decided at the moment of
  the write, not reconstructed later from a diff. This goal's
  `Modified` latch is the same move — decided at write time (every
  mutation choke point sets it), never inferred after the fact by
  comparing content.
- **Grafana's provisioned-dashboard `version` field**: provisioning
  only overwrites a dashboard whose stored `version` is *older* than
  the file's — the same "ignored version" mistake documented widely
  in Grafana's own provisioning issues (dashboards silently reverting
  a user's UI edits, or silently never updating) is the cautionary
  tale for why `SeedRevision` has to gate the upgrade, not just
  presence/absence.
- **Helm's release history + `helm rollback`**: an upgrade is a new
  revision, never an in-place mutation of history — rollback is
  "point at an old revision," not "reconstruct what it looked like."
  Mill already has exactly this mechanism for workflows
  (`docs/adr/0021`'s `Versions`/`PublishedVersion`) — reused here
  rather than inventing a second versioning concept: a golden upgrade
  is "append a new version from the golden, publish it," and rollback
  is the existing Versions UI, unchanged.
- **The Home Assistant / WordPress "explicit fork" lesson**: both
  platforms learned the hard way that silently modifying a
  user-customized file/config on upgrade is the single worst thing an
  update can do — the fix in both ecosystems was requiring an
  explicit, visible fork point before any user edit stops receiving
  automatic updates. `Modified` is that fork point, just latched at
  write time instead of asked about, since Mill has no upgrade-time
  interactive prompt to ask through.
- **No-ambient-notification, converged independently**: none of the
  above systems nag ambiently about drift (no persistent "3 configs
  outdated" badge anywhere in k8s/Grafana/Helm's own UIs) — staleness
  is only surfaced on-demand, at the point where you're already
  looking at the specific resource. Mill's own `.claude/rules/
  testing.md` seed layer and `docs/SPEC.md §2.2`'s "fully editable
  from the moment it exists" principle point the same direction.
  Locked: **no ambient "N seeds outdated" badge anywhere** — the reset
  affordance is on-demand disclosure only, at the row/canvas level.

## Design (locked, owner-ratified 2026-08-12 — see conversation for
full item-by-item brief)

1. **`SeedOrigin` provenance** (`internal/domain/seedorigin`) on every
   built-in-origin artifact (workflows + Configure entities):
   `{SeedRevision int, Modified bool}`. Each golden in code declares
   an explicit `SeedRevision`, starting at 1. Platform-owned, never
   user-editable directly (same precedent as `list.Row.Status`).
2. **`Modified` latch, set at write time.** ANY mutation to a
   built-in-origin artifact through ANY path (UI RPC, MCP write tool)
   sets `Modified = true`, one-way. Choke points, not scattered:
   `compositionsvc`'s `mutateWorkflow` (covers Publish/
   PublishExistingVersion/RestoreVersionToDraft/SetWorkflowDisabled/
   SnapshotDraft) + `UpdateWorkflow` + `UpdateAttributes`;
   `configuresvc`'s per-entity `Update*` (HTTPRequest/Decision/List/
   MCPServer/ExecEnv) + List's `UpdateListRow`/`DeleteListRow`/
   `AddListRow` (row-level content mutation counts as list content
   changing). MCP write tools reach these same choke points already
   (`update_workflow`→`UpdateWorkflowFromExport`→`UpdateWorkflow`/
   `UpdateAttributes`; `publish_workflow`/`SnapshotDraft`→
   `mutateWorkflow`) — confirmed no separate Configure-entity MCP
   write tool exists (`import_*` always mints a new ID, never
   overwrites), so no additional latch site needed there.
3. **Top-up becomes reconcile.** For each golden: absent+untombstoned
   → insert (stamp `SeedOrigin`, today's behavior). Present +
   `!Modified` + stored revision < code's → **upgrade**: workflows
   append a new version via the existing ADR-0021 mechanism and
   publish it (history preserved, rollback free via the existing
   Versions UI); unversioned Configure entities replace content in
   place, stamp new revision. Present + `Modified` → leave entirely
   alone regardless of revision. Tombstoned → skip.
4. **Reset-to-shipped-example affordance** on built-in-origin
   artifacts (workflow row kebab; Configure entity rows) — label
   reflects state at the point of action: current ("Up to date with
   shipped example", disabled) vs. outdated/modified ("Reset to
   shipped example vN"). Workflows: new version from golden +
   publish (non-destructive, history preserved). Configure entities:
   in-place replace behind `ConfirmDialog` (button-semantics rule b).
   Reset clears `Modified`, stamps current revision. No ambient
   outdated badge anywhere.
5. **Restore deleted examples**: where tombstoned built-ins exist for
   an inventory, its page gains a "Restore example…" affordance
   listing them; restoring clears the tombstone and re-seeds at the
   current golden.
6. **Migration**: an existing artifact whose ID matches a golden slug
   but carries no `SeedOrigin` (`SeedRevision == 0`) is stamped
   `{current SeedRevision, Modified: true}` — conservative, never
   auto-clobbers a pre-goal-0037 install; the reset affordance is its
   path back to golden if the owner wants it.
7. **Authoring discipline, CI-enforced**: a Go test fingerprints each
   golden's content (hash used here is legitimate — authoring-time CI
   enforcement, never runtime drift detection, which is exactly the
   client-side-diff failure mode the k8s SSA precedent moved away
   from) against a committed fingerprints file
   (`internal/services/seeding/seed_fingerprints.json`); changing a
   golden's content without bumping its `SeedRevision` fails the
   build with an explanatory message and the new fingerprint to copy
   in.
8. **Weekly seeded-endpoint liveness**: `.github/workflows/
   seed-liveness.yml` already exists (goal 0010) — advisory, weekly,
   runs `TestSeededHTTPRequests_LiveEndpointsRespond` against the real
   httpbin.org/postman-echo.com endpoints the goldens reference. This
   goal extends it (does not duplicate a parallel curl script, which
   would re-list the same endpoints a second time and drift): on
   failure, open/update a single labeled issue (`gh issue create`/
   `comment`, checking for an existing open one first) so a rotted
   seed surfaces somewhere durable instead of only in a job log
   nobody watches.

## Plan
1. [x] `internal/domain/seedorigin` — `Origin{SeedRevision, Modified}`
   + `Touch()` (latch helper, only sets `Modified` when
   `SeedRevision > 0` — a non-seed artifact is never touched).
2. [x] Add `Seed seedorigin.Origin` to `composition.Workflow`,
   `httprequest.HTTPRequest`, `decision.Decision`, `list.List`,
   `mcpserver.MCPServer`, `execenv.ExecEnv`; stamp `SeedRevision: 1`
   on all 17 built-in workflows + 7 HTTPRequests + 3 Decisions + 1
   List + 1 MCPServer + 1 ExecEnv (30 goldens total).
3. [x] Reconcile: rewrite `topUpBuiltIns`
   (`compositionsvc/compositionservice.go`) and `topUpBuiltIn*`
   (`configuresvc/configureservice_builtin.go`) to the insert/upgrade/
   leave-alone/skip algorithm above. Workflow upgrade path reuses
   `composition.PublishHead`/`SnapshotHead`; Configure-entity upgrade
   replaces content fields in place. Migration stamping (item 6) folds
   into the same reconcile pass (same ID-matching walk).
4. [x] Modified latch at the choke points named in Design item 2.
5. [x] Reset RPCs: `CompositionService.ResetWorkflowToSeed(id)`;
   `ConfigureService.Reset{HTTPRequest,Decision,List,MCPServer,
   ExecEnv}ToSeed(id)`.
6. [x] Restore RPCs: `CompositionService.RestorableWorkflows()`/
   `RestoreWorkflow(id)`; equivalent pair per Configure entity type.
7. [x] Fingerprint test + committed fingerprints file
   (`internal/services/seeding`).
8. [x] `seed-liveness.yml`: add the gh-issue-on-failure step.
9. [x] Frontend: reset affordance on workflow row kebab + Configure
   entity rows (`InventoryMenuAction`, existing `confirm`-gated
   pattern); restore-example affordance on each inventory page,
   shown only when applicable.
10. [x] Go tests per testing.md's layering (see Proofs below). E2e:
    minimal — reset affordance visible+correctly labeled on a
    modified seed; restore-example menu appears after deleting a
    seed. Unit: latch choke points set `Modified` for both UI-RPC and
    MCP write paths.
11. [x] Docs: SPEC.md Seed lifecycle subsection (LOCKED);
    testing.md's seed section gets the `SeedRevision` bump-discipline
    pointer; this file's boxes checked + archived.

## Proofs
- Go, real DBOS-backed services: unmodified-outdated workflow upgrades
  via a new version (history length grows, published version's
  content matches golden); modified workflow left untouched by
  reconcile; reset-from-modified appends a golden version + clears the
  latch; Configure-entity reconcile (insert/upgrade/leave-alone) +
  reset paths; migration stamping (pre-goal-0037 data gets
  `Modified: true`); tombstone→restore round-trip (delete → tombstoned
  → restore → present at current revision, tombstone cleared).
- Unit: latch fires for both a direct UI-RPC path and an MCP write
  path (`update_workflow`) reaching the same choke point.
- E2e: reset affordance label/enabled-state on a modified vs.
  up-to-date seed; restore-example menu entry appears after deleting a
  seed and disappears once restored.

## Acceptance
- A shipped golden's content change reaches an existing, unmodified
  install automatically (as a new published version, never silently
  overwriting an edit).
- Any edit to a built-in-origin artifact, through any path, is
  detectable (`Modified`) and permanently protects it from silent
  upgrade.
- A user can deliberately reset a modified/outdated seed back to
  shipped, and restore a deleted one — both on-demand, no ambient
  nagging.
- CI fails a PR that changes a golden's content without bumping its
  `SeedRevision`.
- The seed-liveness check surfaces a rotted external endpoint as a
  durable, deduped GitHub issue, not just a job log.
