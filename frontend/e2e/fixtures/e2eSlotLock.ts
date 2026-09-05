import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// A machine-wide mutex serializing Playwright runs on this box: only
// one process may hold the lock directory at a time, so a concurrent
// run WAITS instead of racing an external `ps` check for a free slot.
// `mkdirSync` without `recursive` is atomic (POSIX mkdir(2)), so
// exactly one concurrent caller ever wins the lock directory.
const DEFAULT_LOCK_DIR = path.join(tmpdir(), 'mill-e2e-slot.lock')
const OWNER_FILE = 'owner.json'
const POLL_INTERVAL_MS = 5_000
const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000

interface SlotOwner {
  pid: number
  cwd: string
  startedAt: string
}

export interface SlotLockOptions {
  /** Override the lock directory -- production never sets this; tests isolate their own path. */
  lockDir?: string
  /** Override the poll cadence -- production never sets this; tests use a short interval. */
  pollIntervalMs?: number
}

// CI shards each run on its own runner, so the lock would only ever
// serialize a single-worker suite against itself -- skipped whenever
// `CI` is set. MILL_E2E_NO_SLOT_LOCK=1 is the same bypass for a caller
// that isn't CI but knows it owns the machine.
function isBypassed(): boolean {
  return !!process.env.CI || process.env.MILL_E2E_NO_SLOT_LOCK === '1'
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 sends nothing; it only probes whether the pid is
    // addressable, throwing ESRCH once the process has exited.
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readOwner(dir: string): SlotOwner | undefined {
  try {
    return JSON.parse(readFileSync(path.join(dir, OWNER_FILE), 'utf8')) as SlotOwner
  } catch {
    return undefined
  }
}

function describeOwner(owner: SlotOwner | undefined): string {
  return owner ? `pid ${owner.pid} (${owner.cwd})` : 'an unknown process'
}

// Returns an owner record on success, undefined if a still-live
// process already holds the slot. A lock directory whose owner.json
// names a dead pid is stale -- e.g. a killed Playwright run that never
// reached its own release -- and is reclaimed rather than waited out.
function tryAcquire(dir: string): SlotOwner | undefined {
  const owner: SlotOwner = { pid: process.pid, cwd: process.cwd(), startedAt: new Date().toISOString() }
  try {
    mkdirSync(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    const existing = readOwner(dir)
    if (existing && isAlive(existing.pid)) return undefined
    try {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir)
    } catch (reclaimErr) {
      // Another caller won the reclaim race first -- keep polling,
      // never throw here (a throw would abort a run that should wait).
      if ((reclaimErr as NodeJS.ErrnoException).code !== 'EEXIST') throw reclaimErr
      return undefined
    }
  }
  writeFileSync(path.join(dir, OWNER_FILE), JSON.stringify(owner))
  return owner
}

/**
 * Blocks until this process holds the machine-wide e2e slot, polling
 * every 5s. Rejects, naming the current holder, if `timeoutMs` (default
 * 45 min) elapses first. A no-op under CI or MILL_E2E_NO_SLOT_LOCK=1.
 */
export async function acquireE2ESlot(timeoutMs = DEFAULT_TIMEOUT_MS, opts: SlotLockOptions = {}): Promise<void> {
  if (isBypassed()) return
  const dir = opts.lockDir ?? DEFAULT_LOCK_DIR
  const pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS
  const deadline = Date.now() + timeoutMs
  let warned = false
  for (;;) {
    const owner = tryAcquire(dir)
    if (owner) {
      console.log(`[e2e-slot-lock] acquired by pid ${owner.pid} (${owner.cwd})`)
      return
    }
    const holder = readOwner(dir)
    if (Date.now() >= deadline) {
      throw new Error(`[e2e-slot-lock] timed out after ${timeoutMs}ms waiting for the e2e slot held by ${describeOwner(holder)}`)
    }
    if (!warned) {
      console.log(`[e2e-slot-lock] waiting for the e2e slot held by ${describeOwner(holder)}...`)
      warned = true
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
}

/**
 * Releases the e2e slot if this process holds it. Never removes a lock
 * directory owned by a different pid -- a caller that raced past its
 * own timeout, or a stale-reclaim by another process, must never make
 * this a no-op release destroy someone else's slot.
 */
export function releaseE2ESlot(opts: SlotLockOptions = {}): void {
  if (isBypassed()) return
  const dir = opts.lockDir ?? DEFAULT_LOCK_DIR
  const owner = readOwner(dir)
  if (owner && owner.pid !== process.pid) return
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Already gone -- nothing to release.
  }
}
