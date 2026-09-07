import { useEffect, useState } from 'react'

// The pairing-code card's whole countdown/expiry math (goal 0369),
// shared by the Devices and Browsers twins so neither drifts from the
// server's own PairingCodeInfo.expiresAt
// (remoteauthservice_pairing.go's pairingCodeTTL) -- no separate TTL
// constant is duplicated client-side, since the server already hands
// back the absolute instant the code dies.

// How often the displayed countdown re-reads the clock.
export const COUNTDOWN_TICK_MS = 1000

// How often a card with a code showing re-checks the paired list for a
// new member, since Mill has no server push to tell it a pairing
// completed (goal 0369).
export const PAIRING_POLL_MS = 3000

// Milliseconds left before expiresAt, floored at zero -- never
// negative, so a caller can compare against it with a plain `<= 0`.
export function remainingMs(expiresAt: string): number {
  return Math.max(0, new Date(expiresAt).getTime() - Date.now())
}

export function isExpired(expiresAt: string): boolean {
  return remainingMs(expiresAt) <= 0
}

// mm:ss, rounded up -- the displayed second must never undercount what
// is actually left, or the card reads as already dead a beat early.
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

// A code card must clear itself the instant the list it watches grows
// past the count it had when the code was minted -- the only pairing-
// succeeded signal available without a server push.
export function gainedMember(baselineCount: number, currentCount: number): boolean {
  return currentCount > baselineCount
}

// Ticks once a second while a code is showing so a caption's countdown
// stays live. Returns the remaining milliseconds; the caller clears its
// own pairing state once that reaches zero (this hook only reports the
// number, it holds no pairing state itself).
export function usePairingCountdown(expiresAt: string | undefined): number {
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!expiresAt) return
    const id = setInterval(() => forceTick((n) => n + 1), COUNTDOWN_TICK_MS)
    return () => clearInterval(id)
  }, [expiresAt])
  return expiresAt ? remainingMs(expiresAt) : 0
}
