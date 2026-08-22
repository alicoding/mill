export interface ShouldNotifyBrowserTabInput {
  isServerMode: boolean
  hasFocus: boolean
  alreadyNotified: boolean
}

// docs/goals/0132-remote-access.md SLICE A: a parked approval raises a
// Notifications-API banner on this tab only when all three hold at
// once -- server mode (desktop already has its own native banner and
// must never double-fire alongside it), the tab not focused (nothing
// to interrupt if the user is already looking at it), and this
// pending id not already notified (once per park, never repeated on
// re-render or reconnect). Pulled into its own dependency-free module
// so it can be unit-tested without pulling the DOM-touching
// Notification API through it.
export function shouldNotifyBrowserTab(input: ShouldNotifyBrowserTabInput): boolean {
  return input.isServerMode && !input.hasFocus && !input.alreadyNotified
}
