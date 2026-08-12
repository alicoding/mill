# 0029 — Dev-liveness honesty: the DEV·live badge must not vouch for a dead watcher

## Goal
The green DEV·live badge claimed liveness twice while the Go binary
was stale (once wedged by disk-full, once 15 commits behind — the
owner's "can't toggle" Settings report was this, not a bug). Goal
0019's "DEV wins unconditionally" traded away Go-rebuild honesty for
no-false-alarms; both scalps prove the trade needs a third state.

## Plan
1. [x] Research-first (small): the cheapest honest Go-liveness signal
   in dev — candidates: the binary self-reports its build time via
   GetBuildInfo (exists) and the frontend compares against the
   NEWEST mtime of internal/**/*.go at bundle-serve time (vite can
   compute at request time in dev middleware); or task dev writes a
   heartbeat file the binary's own watcher-restart updates. Must NOT
   false-alarm on docs-only commits (goal 0019's original trap) —
   compare against Go-source state only, never git HEAD.
   **Chosen: candidate 1 (binary mtime vs. vite-middleware mtime)** —
   the binary already self-reports (`GetBuildInfo` existed; added
   `BuiltAt`, its own executable's mtime, since `vcs.time` is pinned to
   the last COMMIT and never moves across an uncommitted `wails3 dev`
   relink). The heartbeat-file candidate would need teaching a
   third-party supervisor (`wails3 dev`/`atterpac/refresh`) to write a
   file on rebuild — no such hook exists. Two numbers, one comparison,
   no new watcher process to itself go stale.
2. [x] A third badge state: green DEV·live (both live), amber
   DEV·go-stale ("Go changes not yet in this binary — the watcher
   may be wedged; restart task dev"), red STALE unchanged. The amber
   text names the remedy.
   Built: `frontend/src/app/goLiveness.ts` (`isGoSourceStale`,
   `useGoSourceStale`, a 30s grace window absorbing a normal
   save-triggered rebuild incl. the ~20s bindings-regen path),
   `frontend/src/app/BuildIdentityBadge.tsx` (amber `Label
   variant="attention"`, label + title both name the remedy),
   `frontend/vite.config.ts` (`goLivenessPlugin`, dev-only
   `/__mill/go-source-mtime` middleware, request-time mtime walk of
   `internal/**/*.go` — never git HEAD, so a docs/frontend-only commit
   can't move it), `internal/services/settingssvc/settingsservice_buildinfo.go`
   (`BuildInfo.BuiltAt`).
3. [x] Dev-loop guards from tonight's incidents: the task dev
   start-sweep also clears the orphaned vite port (lsof -ti :9245);
   a pre-build disk-space check (< 2GB free → loud warning naming
   `go clean -cache`, the recurring silent killer).
   Built in `Taskfile.yml`'s `dev` task, both non-blocking. Verified
   live against the actual tight-disk conditions this session ran
   under (~1.8GB free triggered the real warning text).
4. [x] E2e where testable; manual-only registry for the rest.
   The pure comparison (`isGoSourceStale`) is unit-tested directly
   (`frontend/src/app/goLiveness.test.ts`, 6 cases incl. the
   docs-commit-never-moves-it case). The full live behavior (an
   actually wedged watcher flipping a real window's badge amber) is
   impractical to reproduce deterministically in CI — entered in
   `.claude/rules/testing.md`'s manual-only note with its reason,
   pointing at `.claude/skills/run-mill` for the manual check.

## Acceptance
A wedged watcher shows amber within one poll interval while docs-only
commits stay green; the owner never again debugs a working feature
against a stale binary.

**Met 2026-08-12.** The comparison polls every 5s
(`GO_LIVENESS_POLL_MS`) so a genuinely wedged watcher (source mtime
outliving `BuiltAt` past the 30s grace) surfaces amber within one poll
interval of that threshold; the comparison only ever reads
`internal/**/*.go` mtimes (never git HEAD, never the frontend tree), so
a docs-only or frontend-only commit structurally cannot move it —
covered by `goLiveness.test.ts`'s dedicated case. `docs/SPEC.md` §3.8's
build-identity entry documents the third state and mechanism choice.
