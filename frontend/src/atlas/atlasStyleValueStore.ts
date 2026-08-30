import { create } from 'zustand'

// The style surface's one generic value store (goal 0209): every
// noun's CURRENT style choices, keyed by noun id then field key -- one
// shape any noun (compiled-in or plugin-registered) costs nothing to
// join; since goal 0252 demoted the drawing tools into the bundled
// Drawing plugin, every seeded entry arrives through registration
// (canvasToolAdapter's seedStyleValues) rather than a literal here.
// Seeds the NEXT placed instance; an ALREADY-placed instance's own
// style instead lives in its BoardObject.Payload, which IS persisted
// document data -- this store is never read back from there.
// Deliberately in-memory only -- no persist middleware, no backend
// call, nothing written through AtlasService -- so quitting Mill loses
// it and a fresh session starts back at the registered defaults rather
// than resurrecting a prior session's choice as if it were saved
// content.
export type AtlasStyleValue = string | number

interface AtlasStyleValueState {
  values: Record<string, Record<string, AtlasStyleValue>>
  setValue: (nounId: string, key: string, value: AtlasStyleValue) => void
}

// Exported for atlasStyleValueStore.test.ts's own imperative
// `.getState()`/`.setState()` access -- vitest cannot call a React hook
// (this store's own `use...` consumers below) outside a component
// render, so the unit test drives the underlying zustand store
// directly, the same imperative escape hatch zustand's own docs
// recommend for non-component tests.
export const useAtlasStyleValues = create<AtlasStyleValueState>()((set) => ({
  values: {},
  setValue: (nounId, key, value) =>
    set((s) => ({ values: { ...s.values, [nounId]: { ...s.values[nounId], [key]: value } } })),
}))

// useAtlasNounStyle / useAtlasSetStyleValue -- the generic read/write
// pair AtlasStylePanel.tsx uses (goal 0211's own conformance test bans
// any noun-id branch in that file): one noun's current values by id,
// and the one setter, with no per-noun name appearing in either.
export function useAtlasNounStyle(nounId: string): Record<string, AtlasStyleValue> {
  return useAtlasStyleValues((s) => s.values[nounId] ?? {})
}

export function useAtlasSetStyleValue(): (nounId: string, key: string, value: AtlasStyleValue) => void {
  return useAtlasStyleValues((s) => s.setValue)
}
