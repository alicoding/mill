import { useEffect, useState } from 'react'
import { refreshSeedRevisions, useSeedRevisionStore } from '../shared/seedRevisionStore'
import { background } from '../shared/background'

// Seed lifecycle (docs/goals/0037): every seeded-example Configure
// entity page tracks the shipped SeedRevisions map plus its own
// tombstoned-and-restorable list, refreshed together after any
// create/update/delete. One hook shared across entity pages instead of
// each re-declaring the same two pieces of state and the same
// two-call refresh function.
//
// The revisions map itself is app-wide state (shared/seedRevisionStore.ts,
// goal 0346), not this hook's: the reset command's enabled() answers
// from outside any component. Only the restorable list -- which differs
// per family -- stays here.
export function useSeedLifecycle<T>(fetchRestorable: () => Promise<T[] | null | undefined>, watched?: unknown) {
  const seedRevisions = useSeedRevisionStore((s) => s.configure)
  const [restorable, setRestorable] = useState<T[]>([])

  const refresh = () => {
    void refreshSeedRevisions('configure')
    void background(fetchRestorable().then((r) => setRestorable(r ?? [])), 'seedLifecycle.restorable')
  }

  // A delete or a reset is a registry command now (goal 0346), reached
  // from a row, the table view, or an agent -- none of which can call
  // this page's refresh. The family's own list IS the signal: it changed,
  // so what is tombstoned-and-restorable may have too.
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is re-created every render; `watched` is the family's list, the one thing that must re-trigger it
  }, [watched])

  return { seedRevisions, restorable, refresh }
}
