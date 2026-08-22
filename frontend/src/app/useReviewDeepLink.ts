import { useEffect } from 'react'
import type { View } from '../shared/store'

// The phone channel's click URL lands here (docs/goals/0132-remote-
// access.md SLICE B item 4): its ntfy notification opens a fresh page
// load with no live Wails runtime already connected, so unlike
// useMillNavigate's event listener (which only reaches an
// already-loaded window) this reads the hash once on mount instead.
// Distinct from the aux-window hash routes main.tsx branches on before
// <App/> even mounts -- #/review lands inside the normal app shell,
// not a separate window, so the branch belongs here, after mount.
export function useReviewDeepLink(setView: (view: View) => void): void {
  useEffect(() => {
    if (window.location.hash !== '#/review') return
    // Clears the hash so a later reload/bookmark doesn't keep forcing
    // Review -- the deep link is a one-time landing, not a persistent
    // route.
    history.replaceState(null, '', window.location.pathname + window.location.search)
    setView({ kind: 'review' })
  }, [setView])
}
