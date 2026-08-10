import { closeSync, openSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// The real macOS pasteboard (internal/adapters/clipboard, osascript/
// pbcopy/pbpaste) is one OS-wide resource shared by every worker
// process on this machine -- per-worker server isolation (goal 0009,
// ./server.ts) does NOT isolate it, since it's outside any one
// server's own state. Confirmed by direct reproduction before this
// suite ran serially (playwright.config.ts's old header comment): one
// test's WriteHTML() clobbered by a concurrently-running test's own
// clipboard write before the first ever read it back. A plain
// cross-process file lock (atomic exclusive file creation, the same
// primitive `flock`/`mkdir`-based locks use) serializes just the
// handful of tests that actually touch the real clipboard, so the rest
// of the suite keeps real worker parallelism.
const LOCK_PATH = path.join(tmpdir(), 'mill-e2e-clipboard.lock')
const STALE_MS = 60_000
// A dozen or so tests across several spec files now contend for this
// one lock under parallel workers (goal 0009) -- comfortably under
// playwright.config.ts's own 60s per-test timeout, but longer than the
// old 30s: a test can legitimately queue behind several others' full
// run time before it even starts its own steps, which never happened
// when the suite was serial (workers: 1, nothing else ever running
// concurrently).
const ACQUIRE_TIMEOUT_MS = 45_000

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err
}

async function acquire(): Promise<void> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS
  for (;;) {
    try {
      closeSync(openSync(LOCK_PATH, 'wx'))
      return
    } catch (err) {
      if (!isNodeError(err) || err.code !== 'EEXIST') throw err
      // A worker that crashed mid-test could leave the lock file behind
      // forever -- steal a stale one rather than deadlock every future
      // run against it.
      try {
        if (Date.now() - statSync(LOCK_PATH).mtimeMs > STALE_MS) {
          unlinkSync(LOCK_PATH)
          continue
        }
      } catch {
        continue // lock vanished between the EEXIST and this stat -- retry immediately
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting ${ACQUIRE_TIMEOUT_MS}ms for the real-clipboard lock (${LOCK_PATH})`)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

function release(): void {
  try {
    unlinkSync(LOCK_PATH)
  } catch {
    // Already gone (e.g. stolen as stale by another waiter) -- fine.
  }
}

// Wrap any test (or helper) that runs a workflow touching the real OS
// clipboard (capture-clipboard-html, apply-clipboard-write-html/-text --
// including via a brand-new workflow's default capture-clipboard-html
// starter node) in this, end to end, not just around the click.
export async function withClipboardLock<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
