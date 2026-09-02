// The flush registry (goal 0295 S2): every surface holding an
// uncommitted edit registers a flusher while it does -- a sticky note
// mid-edit, a sheet cell being typed into, the canvas's debounced
// draft -- and quit / restart ask the page to flush them all before
// the process goes (app/useBeforeQuitFlush.ts). Nothing here decides
// WHAT saving means; each surface's own commit is the flusher.
type Flusher = () => void | Promise<void>

const flushers = new Map<string, Flusher>()

// Registers a flusher under a stable id; returns the unregister. A
// surface registers on entering its editing state and unregisters on
// leaving it (or on unmount), so the registry only ever lists live edits.
export function registerFlusher(id: string, flush: Flusher): () => void {
  flushers.set(id, flush)
  return () => {
    if (flushers.get(id) === flush) flushers.delete(id)
  }
}

export function pendingFlushCount(): number {
  return flushers.size
}

// Runs every registered flusher, bounded: a flusher that hangs must not
// hold the quit hostage past `boundMs`. Failures are swallowed -- the
// caller is leaving; the surface's own error path already reported.
export async function flushAll(boundMs: number): Promise<void> {
  const entries = Array.from(flushers.values())
  if (entries.length === 0) return
  const bound = new Promise<void>((resolve) => setTimeout(resolve, boundMs))
  await Promise.race([
    Promise.allSettled(entries.map((flush) => Promise.resolve().then(flush))).then(() => undefined),
    bound,
  ])
}
