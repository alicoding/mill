import { useSyncExternalStore } from 'react'

// The flush registry (goal 0295 S2): every surface holding an
// uncommitted edit registers an entry while it does -- a sticky note
// mid-edit or held unsaved, a sheet with cells waiting to be written,
// the canvas's debounced draft -- and quit / restart ask the page to
// flush them all before the process goes (app/useBeforeQuitFlush.ts).
// In explicit save mode (shared/saveMode.ts) the same registry IS the
// dirty list: ⌘S flushes the focused entry (edit.save,
// shared/saveCommands.ts), the leave sheet flushes or discards them
// all. Nothing here decides WHAT saving means; each surface's own
// commit is the flusher and its own revert is the discard.
type Flusher = () => void | Promise<void>

export interface FlushEntry {
  flush: Flusher
  // Reverts the surface to its last saved state; a surface with no
  // way back (a never-saved draft) omits it and is simply left behind.
  discard?: () => void
  // The surface's DOM root -- lets edit.save find the entry the focused
  // element belongs to. Entries without one only flush via "all".
  root?: () => Element | null
}

const entries = new Map<string, FlushEntry>()
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((l) => l())
}

// Registers a flusher (or a full entry) under a stable id; returns the
// unregister. A surface registers on entering its dirty state and
// unregisters on leaving it (or on unmount), so the registry only ever
// lists live edits.
export function registerFlusher(id: string, entry: Flusher | FlushEntry): () => void {
  const normalized: FlushEntry = typeof entry === 'function' ? { flush: entry } : entry
  entries.set(id, normalized)
  notify()
  return () => {
    if (entries.get(id) === normalized) {
      entries.delete(id)
      notify()
    }
  }
}

export function pendingFlushCount(): number {
  return entries.size
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// The subscription itself, for the unit test only -- components use
// usePendingFlushCount.
export const subscribeForTest = subscribe

// Live count for dirty-aware UI (the leave sheet's body, the settings
// caption) -- re-renders on every register / unregister.
export function usePendingFlushCount(): number {
  return useSyncExternalStore(subscribe, pendingFlushCount)
}

async function runBounded(flushers: Flusher[], boundMs: number): Promise<void> {
  if (flushers.length === 0) return
  const bound = new Promise<void>((resolve) => setTimeout(resolve, boundMs))
  await Promise.race([
    Promise.allSettled(flushers.map((flush) => Promise.resolve().then(flush))).then(() => undefined),
    bound,
  ])
}

// Runs every registered flusher, bounded: a flusher that hangs must not
// hold the quit hostage past `boundMs`. Failures are swallowed -- the
// caller is leaving; the surface's own error path already reported.
export async function flushAll(boundMs: number): Promise<void> {
  await runBounded(Array.from(entries.values()).map((e) => e.flush), boundMs)
}

// ⌘S: flushes the entry whose root holds the focused element; with no
// such entry (focus on the board, nowhere in particular) it saves
// everything -- what a reflexive ⌘S means when nothing is focused.
export async function flushFocused(
  boundMs: number,
  active: { contains?: never } | Node | null = typeof document === 'undefined' ? null : document.activeElement,
): Promise<void> {
  const focused = active
    ? Array.from(entries.values()).find((e) => e.root?.()?.contains(active as Node))
    : undefined
  if (focused) {
    await runBounded([focused.flush], boundMs)
    return
  }
  await flushAll(boundMs)
}

// Reverts every entry that knows how; the leave sheet's Discard.
export function discardAll(): void {
  Array.from(entries.values()).forEach((e) => {
    try {
      e.discard?.()
    } catch {
      // The surface is being left behind either way.
    }
  })
}
