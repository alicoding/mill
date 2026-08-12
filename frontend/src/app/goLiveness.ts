import { useEffect, useState } from 'react'

// Goal 0029 -- dev-liveness honesty. BuildIdentityBadge's DEV·live
// state answers "is the FRONTEND live" (vite HMR, true by
// construction); it says nothing about the GO SIDE, and two real
// incidents in one night proved that gap costs real debugging time: a
// disk-full `wails3 dev` rebuild wedged silently with the badge still
// green, and a separate slow watcher cycle left the running binary 15
// commits behind while the badge stayed green -- the owner debugged a
// working Settings feature as broken because of it. A third state
// closes it: amber `DEV · go-stale` when Go source has moved since
// this binary was built but the rebuild hasn't landed yet.
//
// Mechanism (chosen over a task-dev-written heartbeat file, the goal's
// other candidate): the binary already self-reports when it was
// actually linked (BuildInfo.BuiltAt, its own executable's mtime --
// settingsservice_buildinfo.go) and vite's own dev server can compute
// the newest mtime under internal/**/*.go AT REQUEST TIME with no new
// process of its own (vite.config.ts's goLivenessPlugin,
// `/__mill/go-source-mtime`). Two numbers, one comparison, no extra
// moving part to itself go stale -- simpler than teaching `wails3
// dev`'s rebuild (a third-party supervisor) to write a heartbeat file,
// which was the only way to make the other candidate work.
//
// Deliberately Go-source-mtime, not git HEAD (goal 0019's own trap):
// committing during a running `task dev` never touches a working-tree
// file's mtime, so a docs-only or frontend-only commit can never move
// this comparison -- it only reacts to an actual internal/**/*.go
// save.
//
// This logic is pulled into its own dependency-free module (rather
// than living alongside BuildIdentityBadge.tsx's @primer/react import)
// specifically so BuildIdentityBadge.test.ts can unit-test the pure
// comparison without pulling Primer's CSS through Vitest's Node
// environment -- confirmed by hitting exactly that failure first.
const isDevBuild = import.meta.env.DEV

export const GO_LIVENESS_POLL_MS = 5000
// Absorbs a normal save-triggered rebuild in flight: a plain Go change
// relinks in a few seconds, and a bound-method-signature change adds
// the ~20s `wails3 generate bindings` step (Taskfile.yml's dev target
// doc) before the whole process (and this React tree) restarts fresh.
// Longer than either, so amber means "no rebuild is landing," not
// "one is still running."
export const GO_LIVENESS_GRACE_MS = 30000

// Pure comparison, unit-tested directly (real dev-loop rebuild timing
// is impractical to reproduce in CI -- see .claude/rules/testing.md's
// manual-only note for this feature): Go source moved more recently
// than this binary was built, by more than the grace window.
export function isGoSourceStale(sourceMtimeMs: number, builtAtMs: number, graceMs: number = GO_LIVENESS_GRACE_MS): boolean {
  return sourceMtimeMs > builtAtMs + graceMs
}

// Polls vite's dev-only middleware for the newest internal/**/*.go
// mtime and compares it against builtAtMs -- captured once, at mount,
// from BuildInfo.BuiltAt. builtAtMs itself never needs re-polling: a
// REAL rebuild replaces the whole process (Go isn't hot-reloadable),
// which remounts the caller with a fresh BuildInfo for free; only the
// OLD process staying up (the wedged/slow case) needs watching.
export function useGoSourceStale(builtAtMs: number | undefined): boolean {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    if (!isDevBuild || !builtAtMs) return
    let cancelled = false
    const check = () => {
      fetch('/__mill/go-source-mtime')
        .then((r) => r.json())
        .then((body: { mtimeMs: number }) => {
          if (!cancelled) setStale(isGoSourceStale(body.mtimeMs, builtAtMs))
        })
        .catch(() => { /* dev middleware unreachable -- leave the last known state */ })
    }
    check()
    const id = setInterval(check, GO_LIVENESS_POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [builtAtMs])
  return stale
}
