# 0029 — Dev-liveness honesty: the DEV·live badge must not vouch for a dead watcher

## Goal
The green DEV·live badge claimed liveness twice while the Go binary
was stale (once wedged by disk-full, once 15 commits behind — the
owner's "can't toggle" Settings report was this, not a bug). Goal
0019's "DEV wins unconditionally" traded away Go-rebuild honesty for
no-false-alarms; both scalps prove the trade needs a third state.

## Plan
1. [ ] Research-first (small): the cheapest honest Go-liveness signal
   in dev — candidates: the binary self-reports its build time via
   GetBuildInfo (exists) and the frontend compares against the
   NEWEST mtime of internal/**/*.go at bundle-serve time (vite can
   compute at request time in dev middleware); or task dev writes a
   heartbeat file the binary's own watcher-restart updates. Must NOT
   false-alarm on docs-only commits (goal 0019's original trap) —
   compare against Go-source state only, never git HEAD.
2. [ ] A third badge state: green DEV·live (both live), amber
   DEV·go-stale ("Go changes not yet in this binary — the watcher
   may be wedged; restart task dev"), red STALE unchanged. The amber
   text names the remedy.
3. [ ] Dev-loop guards from tonight's incidents: the task dev
   start-sweep also clears the orphaned vite port (lsof -ti :9245);
   a pre-build disk-space check (< 2GB free → loud warning naming
   `go clean -cache`, the recurring silent killer).
4. [ ] E2e where testable; manual-only registry for the rest.

## Acceptance
A wedged watcher shows amber within one poll interval while docs-only
commits stay green; the owner never again debugs a working feature
against a stale binary.
