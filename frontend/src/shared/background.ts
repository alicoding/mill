import { create } from 'zustand'

// backgroundFailureStore counts what background() below swallows, per
// source tag (goal 0313). No UI reads this yet -- the Health view is
// the planned first consumer; until then this is the greppable record
// that a background failure happened at all, never a silent drop.
interface BackgroundFailureState {
  failures: Record<string, number>
  recordFailure: (source: string) => void
}

export const useBackgroundFailureStore = create<BackgroundFailureState>()((set) => ({
  failures: {},
  recordFailure: (source) =>
    set((s) => ({ failures: { ...s.failures, [source]: (s.failures[source] ?? 0) + 1 } })),
}))

// background is the escape hatch for a promise NOT started by a
// user-initiated command (shared/commands.ts's runCommand is that
// door) -- a poll, a refresh, a fire-and-forget window/badge call. It
// never re-throws and never surfaces to the user: the caller's job
// ends at "started". source is a stable, human-readable tag
// (`atlas.refreshCards`, `updates.checkStatus`) grepped straight back
// to its call site, never a generic label two sites could share.
//
// Returns a Promise<void> rather than void, on purpose: several
// existing refresh functions (atlas/atlasStore.ts's refreshAtlas*, the
// same shape in shared/configureEntityStore.ts and shared/store.ts)
// are AWAITED by their own callers -- "the new card exists server-side
// now, proceed" -- so background() still needs to settle once its
// promise does, just never rejecting. A caller with nothing to await
// simply ignores the return, same as any other fire-and-forget call.
export function background(promise: Promise<unknown>, source: string): Promise<void> {
  return promise.then(
    () => undefined,
    (err) => {
      console.warn(`[background:${source}]`, err)
      useBackgroundFailureStore.getState().recordFailure(source)
    },
  )
}
