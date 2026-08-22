export type BrowserNotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied'

// The Notifications API is a secure-context-only browser feature --
// unavailable over a plain http connection (a Tailscale-reached
// server-mode instance today has no TLS). window.isSecureContext
// already covers this (true for https and for loopback origins, false
// for a remote http origin), so every caller goes through this door
// rather than touching `Notification` directly -- same pattern as
// clipboardWrite.ts for navigator.clipboard.
export function getNotificationPermission(): BrowserNotifyPermission {
  if (typeof window === 'undefined' || !window.isSecureContext || !('Notification' in window)) {
    return 'unsupported'
  }
  return Notification.permission
}

// Must only be called from a user gesture (a click handler) -- browsers
// silently resolve to 'denied' when requestPermission fires any other
// way.
export async function requestNotificationPermission(): Promise<BrowserNotifyPermission> {
  if (getNotificationPermission() === 'unsupported') return 'unsupported'
  return Notification.requestPermission()
}

// Raises the OS notification. No-ops when permission isn't actually
// granted, so a caller can't accidentally trigger a browser permission
// prompt by calling this directly. Clicking it focuses this tab and
// hands off to onClick before closing the notification.
export function raiseNotification(title: string, body: string, onClick: () => void): void {
  if (getNotificationPermission() !== 'granted') return
  const notification = new Notification(title, { body })
  notification.onclick = () => {
    window.focus()
    onClick()
    notification.close()
  }
}
