import { create } from 'zustand'

// The pencil tool's own "current defaults" cache (goal 0169 slice 3's
// styleDefaults dual model): seeds the NEXT stroke's colour/size.
// Deliberately in-memory only -- no persist middleware, no backend
// call, nothing written through AtlasService -- so quitting Mill loses
// it and a fresh session starts back at PENCIL_DEFAULT_STYLE rather
// than resurrecting a prior session's choice as if it were saved
// content. A drawn stroke's OWN colour/size instead lives baked into
// its SVG mirror file (atlasTools.ts's pencilTool.commit), which IS
// persisted document data -- this store is never read back from there.
export const PENCIL_COLORS = ['#1f6feb', '#da3633', '#238636', '#9a6700', '#8250df', '#24292f']
export const PENCIL_SIZES = [2, 4, 8] as const

interface PencilStyleState {
  color: string
  size: number
  setColor: (color: string) => void
  setSize: (size: number) => void
}

export const useAtlasPencilStyle = create<PencilStyleState>()((set) => ({
  color: PENCIL_COLORS[0],
  size: PENCIL_SIZES[1],
  setColor: (color) => set({ color }),
  setSize: (size) => set({ size }),
}))
