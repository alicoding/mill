import { useEffect } from 'react'
import { useAppStore } from '../shared/store'
import type { View } from '../shared/store'
import { groupFromHash } from '../views/settingsRoute'
import { kindFromHash } from '../configure/configureRoute'

// A `#/settings/<group>` or `#/configure/<kind>` address opened
// directly -- a reload, a bookmark, a link someone kept (goal 0321,
// goal 0116). The routed view owns its route while it is mounted; this
// is the one-time landing that mounts it in the first place, read once
// on mount the way the review deep link is. Distinct from the aux-
// window hash routes main.tsx branches on before <App/> even mounts:
// these land inside the normal app shell, not a separate window.
//
// The hash is deliberately NOT cleared: it is a real route, and the
// view keeps it in step with its pane from here on.
//
// A reload restores the page AND its open work tabs, the active one
// included (goal 0033). When the restored page is already the routed
// surface, the landing only pins the pane the address names -- it
// never goes through setView, whose own contract deactivates the work
// tab, or the reload would land on the page beneath the tab the user
// was reading.
export function useRouteLanding(setView: (view: View) => void): void {
  useEffect(() => {
    const hash = window.location.hash
    const group = groupFromHash(hash)
    const kind = group ? null : kindFromHash(hash)
    const next: View | null = group
      ? { kind: 'settings', section: group }
      : kind ? { kind: 'configure', tab: kind } : null
    if (!next) return
    if (useAppStore.getState().view.kind === next.kind) useAppStore.setState({ view: next })
    else setView(next)
  }, [setView])
}
