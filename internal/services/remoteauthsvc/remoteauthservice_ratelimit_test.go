package remoteauthsvc

import (
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/settings"
)

func newRateLimitTestService(t *testing.T) *Service {
	t.Helper()
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	return New(store, slog.New(slog.DiscardHandler))
}

// TestRateLimit_LockoutDoublesOnEachRepeatOffense pins the SLICE 1
// DESIGN CONTRACT's exact number: 5 failures locks for 60s, and a
// source that keeps failing after each lockout expires gets a longer
// lockout each time.
func TestRateLimit_LockoutDoublesOnEachRepeatOffense(t *testing.T) {
	s := newRateLimitTestService(t)
	const source = "198.51.100.1"
	now := time.Unix(1_700_000_000, 0)

	failUntilLocked := func(at time.Time) {
		for i := 0; i < maxFailuresBeforeLockout; i++ {
			s.recordPairingFailure(source, at)
		}
	}

	failUntilLocked(now)
	if allowed, retryAfter := s.checkRateLimit(source, now); allowed || retryAfter != baseLockoutDuration {
		t.Fatalf("after first lockout: allowed=%v retryAfter=%v, want locked for %v", allowed, retryAfter, baseLockoutDuration)
	}

	// Once the first lockout has fully elapsed, failing 5 more times
	// doubles the next lockout to 120s.
	afterFirstLockout := now.Add(baseLockoutDuration)
	failUntilLocked(afterFirstLockout)
	wantSecondLockout := 2 * baseLockoutDuration
	if allowed, retryAfter := s.checkRateLimit(source, afterFirstLockout); allowed || retryAfter != wantSecondLockout {
		t.Fatalf("after second lockout: allowed=%v retryAfter=%v, want locked for %v", allowed, retryAfter, wantSecondLockout)
	}
}

func TestRateLimit_SuccessClearsFailureHistory(t *testing.T) {
	s := newRateLimitTestService(t)
	const source = "198.51.100.2"
	now := time.Unix(1_700_000_000, 0)

	for i := 0; i < maxFailuresBeforeLockout-1; i++ {
		s.recordPairingFailure(source, now)
	}
	s.recordPairingSuccess(source)

	if allowed, retryAfter := s.checkRateLimit(source, now); !allowed || retryAfter != 0 {
		t.Fatalf("after success: allowed=%v retryAfter=%v, want unlocked with no history", allowed, retryAfter)
	}

	// The cleared history means a fresh run of 4 failures still
	// doesn't lock -- proof the counter actually reset to zero, not
	// just below the threshold.
	for i := 0; i < maxFailuresBeforeLockout-1; i++ {
		s.recordPairingFailure(source, now)
	}
	if allowed, _ := s.checkRateLimit(source, now); !allowed {
		t.Fatalf("4 failures after a reset should not lock out yet")
	}
}
