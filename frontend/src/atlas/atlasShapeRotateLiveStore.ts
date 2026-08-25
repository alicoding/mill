import { create } from 'zustand'

// The rotation handle's own ephemeral drag state (goal 0214): while a
// drag is in flight, AtlasShapeContent.tsx needs to render an angle
// that hasn't persisted yet -- this store is that one bridge, keyed by
// object id so at most one shape carries a live override at a time (a
// rotation handle only ever renders on the sole-selected shape). Never
// persisted, never read by anything outside the render path -- the
// committed angle always lives in BoardObject.Payload; this is purely
// "what to paint this frame" during an active drag.
interface AtlasShapeRotateLiveState {
  live: Record<string, number | undefined>
  setLive: (objectID: string, angle: number | null) => void
}

export const useAtlasShapeRotateLiveStore = create<AtlasShapeRotateLiveState>()((set) => ({
  live: {},
  setLive: (objectID, angle) =>
    set((s) => {
      if (angle === null) {
        if (!(objectID in s.live)) return s
        const next = { ...s.live }
        delete next[objectID]
        return { live: next }
      }
      return { live: { ...s.live, [objectID]: angle } }
    }),
}))

export function useAtlasShapeRotateLive(objectID: string): number | undefined {
  return useAtlasShapeRotateLiveStore((s) => s.live[objectID])
}

export function setAtlasShapeRotateLive(objectID: string, angle: number | null): void {
  useAtlasShapeRotateLiveStore.getState().setLive(objectID, angle)
}
