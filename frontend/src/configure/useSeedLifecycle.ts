import { useState } from 'react'
import { ConfigureService } from '../shared/bindings'
import { background } from '../shared/background'

// Seed lifecycle (docs/goals/0037): every seeded-example Configure
// entity page tracks the shipped SeedRevisions map plus its own
// tombstoned-and-restorable list, refreshed together after any
// create/update/delete. One hook shared across entity pages instead of
// each re-declaring the same two pieces of state and the same
// two-call refresh function.
export function useSeedLifecycle<T>(fetchRestorable: () => Promise<T[] | null | undefined>) {
  const [seedRevisions, setSeedRevisions] = useState<Record<string, number | undefined>>({})
  const [restorable, setRestorable] = useState<T[]>([])

  const refresh = () => {
    void background(ConfigureService.SeedRevisions().then((m) => setSeedRevisions(m ?? {})), 'seedLifecycle.seedRevisions')
    void background(fetchRestorable().then((r) => setRestorable(r ?? [])), 'seedLifecycle.restorable')
  }

  return { seedRevisions, restorable, refresh }
}
