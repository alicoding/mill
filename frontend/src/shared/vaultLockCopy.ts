// The vault lock policy's own copy mapping, kept out of the components
// that render it so both the Locking controls and the Secrets status
// line word themselves from one place -- and so the mapping is provable
// without a DOM. Every function here returns i18next KEYS and their
// interpolation values, never sentences: the strings themselves live in
// locales/en/secrets.json.

// UnlockCapability's five values (SecretService.UnlockCapability). A
// string, not a union the bindings hand over, because the Go method
// returns a plain string.
export type UnlockCapability = 'none' | 'password' | 'touchID' | 'touchIDAndWatch' | 'watch'

// The presets the "Lock the vault after" menu offers, in the order it
// offers them. 0 is Never, and is deliberately part of the same list:
// it is a timeout choice, not a separate switch.
export const LOCK_AFTER_PRESETS = [60, 300, 900, 1800, 3600, 14400, 28800, 0] as const

// A custom timeout is entered in MINUTES, from one minute to thirty
// days -- the same range the service clamps to.
export const CUSTOM_MINUTES_MIN = 1
export const CUSTOM_MINUTES_MAX = 43200

export function isLockAfterPreset(seconds: number): boolean {
  return (LOCK_AFTER_PRESETS as readonly number[]).includes(seconds)
}

// humanizeLockAfter picks the largest whole unit a timeout divides
// into, so 900 reads as "15 minutes" and 7200 as "2 hours" rather than
// "120 minutes". Returns null for Never, which has no duration to name.
export function humanizeLockAfter(seconds: number): { key: string; count: number } | null {
  if (seconds <= 0) return null
  if (seconds % 86400 === 0) return { key: 'locking.days', count: seconds / 86400 }
  if (seconds % 3600 === 0) return { key: 'locking.hours', count: seconds / 3600 }
  return { key: 'locking.minutes', count: Math.max(1, Math.round(seconds / 60)) }
}

// unlockToggleLabelKey is the label on the unlock requirement, worded
// for the hardware in front of the reader: a Mac with no Touch ID will
// only ever ask for a password, and a label promising Touch ID would be
// a lie on it. 'none' has no honest label at all, so the toggle is
// disabled and the caption carries the reason instead.
export function unlockToggleLabelKey(capability: string): string {
  switch (capability) {
    case 'touchID':
      return 'touchId.toggleLabelTouchId'
    case 'touchIDAndWatch':
      return 'touchId.toggleLabelTouchIdAndWatch'
    case 'watch':
      return 'touchId.toggleLabelWatch'
    default:
      return 'touchId.toggleLabelPassword'
  }
}

// unlockStatusKey is the same mapping in the Secrets page's own voice:
// what IS required, rather than what Mill will ask for.
export function unlockStatusKey(capability: string): string {
  switch (capability) {
    case 'touchID':
      return 'touchId.requiredStatusTouchId'
    case 'touchIDAndWatch':
      return 'touchId.requiredStatusTouchIdAndWatch'
    case 'watch':
      return 'touchId.requiredStatusWatch'
    default:
      return 'touchId.requiredStatusPassword'
  }
}
