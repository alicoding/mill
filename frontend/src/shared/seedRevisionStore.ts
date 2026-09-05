import { create } from 'zustand'
import { CompositionService, ConfigureService } from './bindings'
import { background } from './background'

// The SHIPPED seed revision per entity id, held once for the whole app
// (goal 0346). Each inventory page used to fetch SeedRevisions() into its
// own useState, which was fine while "can this row be reset" was decided
// inside that page's render -- it no longer is: the reset command's
// enabled() answers it, from shared/, for every surface that offers the
// action. A row's own stamp is not enough on its own (shared/
// seedLifecycle.ts's describeSeedReset says why), so the map has to be
// reachable outside a component.
//
// Two scopes because two services answer it: workflows come from
// CompositionService, every Configure entity from ConfigureService.
export type SeedScope = 'configure' | 'workflow'

type RevisionMap = Record<string, number | undefined>

interface SeedRevisionState {
  configure: RevisionMap
  workflow: RevisionMap
  setRevisions: (scope: SeedScope, revisions: RevisionMap) => void
}

export const useSeedRevisionStore = create<SeedRevisionState>()((set) => ({
  configure: {},
  workflow: {},
  setRevisions: (scope, revisions) => set({ [scope]: revisions } as Pick<SeedRevisionState, SeedScope>),
}))

export function refreshSeedRevisions(scope: SeedScope): Promise<void> {
  const fetch = scope === 'workflow' ? CompositionService.SeedRevisions() : ConfigureService.SeedRevisions()
  return background(fetch.then((m) => useSeedRevisionStore.getState().setRevisions(scope, m ?? {})), `seedRevisions.${scope}`)
}

// The revision to judge a row against: the shipped map when it has been
// read, else the row's own stamp -- which is what a not-yet-loaded map
// means, not "revision zero".
export function shippedRevision(scope: SeedScope, id: string, fallback: number): number {
  return useSeedRevisionStore.getState()[scope][id] ?? fallback
}
