import { useCallback, useRef } from 'react'
import { getNotificationPermission, raiseNotification } from '../shared/browserNotify'
import { shouldNotifyBrowserTab } from './browserNotifyPredicate'

export interface BrowserNotifyRequest {
  // Identifies the thing being notified about (a run id, a pending
  // approval id, ...) -- never notified twice for the same key.
  dedupeKey: string
  title: string
  body: string
  // What clicking the raised notification does: focus this tab (handled
  // by raiseNotification itself) and land on whatever the caller
  // considers "the thing that needs attention" -- an in-app setView
  // call, not a URL, since the tab is already alive.
  onClick: () => void
}

// docs/goals/0132-remote-access.md SLICE A: the one browser-tab
// notification seam every consumer goes through, never a bespoke
// notifier per event type. A new event that wants this (a finished
// run, an agent action while away) is a new call site with its own
// dedupeKey/title/body/onClick -- never a change here. The parked-
// approval call in App.tsx is this seam's first consumer, not its only
// intended one.
export function useBrowserNotify(isServerMode: boolean) {
  const notifiedKeys = useRef<Set<string>>(new Set())

  return useCallback((req: BrowserNotifyRequest) => {
    const alreadyNotified = notifiedKeys.current.has(req.dedupeKey)
    if (!shouldNotifyBrowserTab({ isServerMode, hasFocus: document.hasFocus(), alreadyNotified })) return
    if (getNotificationPermission() !== 'granted') return
    notifiedKeys.current.add(req.dedupeKey)
    raiseNotification(req.title, req.body, req.onClick)
  }, [isServerMode])
}
