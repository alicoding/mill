import { useEffect } from 'react'
import type { View } from '../shared/store'
import { groupFromHash } from '../views/settingsRoute'

// A `#/settings/<group>` address opened directly -- a reload, a
// bookmark, a link someone kept (goal 0321). SettingsView owns the
// route while it is mounted; this is the one-time landing that mounts
// it in the first place, read once on mount the way the review deep
// link is. Distinct from the aux-window hash routes main.tsx branches
// on before <App/> even mounts: #/settings lands inside the normal app
// shell, not a separate window.
//
// The hash is deliberately NOT cleared: it is a real route, and
// SettingsView keeps it in step with the pane from here on.
export function useSettingsRouteLanding(setView: (view: View) => void): void {
  useEffect(() => {
    const group = groupFromHash(window.location.hash)
    if (!group) return
    setView({ kind: 'settings', section: group })
  }, [setView])
}
