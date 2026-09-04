import { useCallback } from 'react'
import { getNotificationPermission, raiseNotification } from '../shared/browserNotify'
import { NotificationService } from '../shared/bindings'
import { background } from '../shared/background'

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

// docs/goals/0171-notification-spine.md: the browser-tab channel's
// client half. The gate (server mode, presence) and the dedupe (has
// this dedupeKey already been delivered through the "browser-tab"
// channel) both live server-side now -- NotificationService.Publish is
// the same one entry point every producer goes through, so this hook
// only decides whether to raise the actual `Notification`, based on
// whether Publish's own response says "browser-tab" newly delivered on
// THIS call. Replaces goal 0132 slice A's local shouldNotifyBrowserTab
// predicate (focus-only, no idle) and its in-memory notifiedKeys Set
// (reset on reload) -- both are gone, not just unused.
export function useBrowserNotify() {
  return useCallback((req: BrowserNotifyRequest) => {
    if (getNotificationPermission() !== 'granted') return
    void background(NotificationService.Publish({
      type: 'guardrail', title: req.title, body: req.body,
      dedupeKey: req.dedupeKey, sourceRef: req.dedupeKey, focused: document.hasFocus(),
    }).then((result) => {
      if (result.delivered?.includes('browser-tab')) {
        raiseNotification(req.title, req.body, req.onClick)
      }
    }), 'browserNotify.publish')
  }, [])
}
