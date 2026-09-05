import { create } from 'zustand'

// The last refusal a row action met, per entity family (goal 0346).
//
// A row action is a registry command now, so its run() returns nothing a
// page can await -- the failure has to reach the page that offered it
// some other way, the same reason the vault's lock/unlock outcome lives
// in shared/vaultStatusStore.ts rather than in the Secrets view. A
// refusal reaches the reader twice on purpose: here, beside the list it
// acted on, AND as the footer's own error pill, which runCommand posts
// independently.
//
// A reference-integrity refusal names every workflow still holding the
// entity (docs/adr/0040 decision 3), which is what makes it actionable,
// so the text stored here is the server's own, not a code-keyed
// sentence.
interface EntityActionErrorState {
  byEntity: Record<string, string | undefined>
  setError: (entity: string, text: string) => void
  clearError: (entity: string) => void
}

export const useEntityActionErrorStore = create<EntityActionErrorState>()((set) => ({
  byEntity: {},
  setError: (entity, text) => set((s) => ({ byEntity: { ...s.byEntity, [entity]: text } })),
  clearError: (entity) => set((s) => ({ byEntity: { ...s.byEntity, [entity]: undefined } })),
}))

/** The refusal to render beside this family's list, if its last action met one. */
export function useEntityActionError(entity: string): string | undefined {
  return useEntityActionErrorStore((s) => s.byEntity[entity])
}
