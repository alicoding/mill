package remoteauthsvc

import "time"

// maxFailuresBeforeLockout and baseLockoutDuration are the SLICE 1
// DESIGN CONTRACT's abuse-resistance numbers verbatim: 5 failed
// pairing-code attempts from one source lock that source out for 60
// seconds, doubling on every lockout that follows.
const (
	maxFailuresBeforeLockout = 5
	baseLockoutDuration      = 60 * time.Second
)

// rateLimitEntry tracks one source's recent pairing-code failures.
// lockoutStep counts how many times this source has been locked out,
// so the next lockout's duration doubles rather than resetting.
type rateLimitEntry struct {
	failures    int
	lockedUntil time.Time
	lockoutStep int
}

// checkRateLimit reports whether source may attempt a pairing code
// right now, and how long it must still wait when it may not. Held
// under mu by callers.
func (s *RemoteAuthService) checkRateLimit(source string, now time.Time) (allowed bool, retryAfter time.Duration) {
	entry, ok := s.limiter[source]
	if !ok {
		return true, 0
	}
	if now.Before(entry.lockedUntil) {
		return false, entry.lockedUntil.Sub(now)
	}
	return true, 0
}

// recordPairingFailure registers one failed pairing-code attempt from
// source, locking it out once it crosses maxFailuresBeforeLockout.
// Held under mu by callers.
func (s *RemoteAuthService) recordPairingFailure(source string, now time.Time) {
	entry, ok := s.limiter[source]
	if !ok {
		entry = &rateLimitEntry{}
		s.limiter[source] = entry
	}
	entry.failures++
	if entry.failures >= maxFailuresBeforeLockout {
		lockout := baseLockoutDuration << entry.lockoutStep
		entry.lockedUntil = now.Add(lockout)
		entry.lockoutStep++
		entry.failures = 0
	}
}

// recordPairingSuccess clears source's failure history -- a correct
// code should not leave a stale near-lockout behind it.
func (s *RemoteAuthService) recordPairingSuccess(source string) {
	delete(s.limiter, source)
}
