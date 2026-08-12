import { describe, expect, it } from 'vitest'
import { isGoSourceStale } from './goLiveness'

// Goal 0029: the full dev-liveness behavior (a real `wails3 dev`
// rebuild wedging, the badge actually turning amber in a live window)
// is impractical to reproduce deterministically in CI -- see
// .claude/rules/testing.md's manual-only note for this feature. This
// covers the one piece that IS pure logic: given two timestamps, what
// does the comparison decide. Everything around it (the fetch poll,
// BuildInfo.BuiltAt, the vite middleware) is plumbing feeding these
// same two numbers into the same function.
describe('isGoSourceStale', () => {
  it('is not stale when Go source is older than the binary', () => {
    expect(isGoSourceStale(1_000, 2_000)).toBe(false)
  })

  it('is not stale when Go source moved after the binary but within the grace window', () => {
    expect(isGoSourceStale(2_000, 1_000, 5_000)).toBe(false)
  })

  it('is not stale exactly at the grace boundary', () => {
    expect(isGoSourceStale(6_000, 1_000, 5_000)).toBe(false)
  })

  it('is stale once Go source outlives the binary by more than the grace window', () => {
    expect(isGoSourceStale(6_001, 1_000, 5_000)).toBe(true)
  })

  it('is stale for a Go source change long after the binary was built (the wedged-watcher case)', () => {
    expect(isGoSourceStale(10_000_000, 1_000, 30_000)).toBe(true)
  })

  it('never false-alarms on a docs/frontend-only commit -- Go source mtime unchanged', () => {
    // The comparison only ever sees internal/**/*.go mtimes (vite's
    // dev middleware, vite.config.ts); a docs or frontend-only commit
    // never advances sourceMtimeMs, so this stays false regardless of
    // how much time elapses.
    const builtAtMs = 1_000
    const unchangedSourceMtimeMs = 500 // older than the binary itself
    expect(isGoSourceStale(unchangedSourceMtimeMs, builtAtMs)).toBe(false)
  })
})
