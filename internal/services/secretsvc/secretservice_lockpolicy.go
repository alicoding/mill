package secretsvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/localauth"
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// The lock policy's settings keys. They live in the settings store
// rather than the vault for the same reason requireAuthKey does: they
// configure the kernel, and hold nothing secret.
const (
	lockAfterKey        = "secrets.lockAfterSeconds"
	lockOnSleepKey      = "secrets.lockOnSleep"
	lockOnUserSwitchKey = "secrets.lockOnUserSwitch"
	lockOnMinimizeKey   = "secrets.lockOnMinimize"
)

// The policy's defaults. defaultLockAfterSeconds is the idle timeout
// this service enforced unconditionally before it was a setting.
const (
	defaultLockAfterSeconds = 900
	defaultLockOnSleep      = true
	defaultLockOnUserSwitch = true
	defaultLockOnMinimize   = false
	lockAfterNever          = 0
	minLockAfterSeconds     = 60
	maxLockAfterSeconds     = 43200 * 60
)

// Lock triggers, as the strings this service accepts. Strings, not the
// windowing package's own LockTrigger type, so a service package never
// depends on the toolkit port -- the composition root translates, and
// a test injects a synthetic trigger with a literal.
const (
	TriggerSleep      = "sleep"
	TriggerScreenLock = "screenLock"
	TriggerUserSwitch = "userSwitch"
	TriggerMinimize   = "minimize"
)

// LockPolicy is when the vault locks itself: one idle timeout plus the
// events that lock it regardless of idle time.
//
// LockAfterSeconds counts SYSTEM idle -- time since this Mac last saw
// keyboard or pointer input, not time since Mill was last used -- so
// working in another app keeps the vault open. 0 means it never locks
// on idle.
type LockPolicy struct {
	LockAfterSeconds int
	LockOnSleep      bool
	LockOnUserSwitch bool
	LockOnMinimize   bool
}

// clampLockAfter keeps a stored or submitted timeout inside the range
// the surface offers: 0 (never), otherwise one minute to thirty days.
// A value that would round to zero minutes would be a vault that locks
// itself the instant it opens.
func clampLockAfter(seconds int) int {
	switch {
	case seconds <= lockAfterNever:
		return lockAfterNever
	case seconds < minLockAfterSeconds:
		return minLockAfterSeconds
	case seconds > maxLockAfterSeconds:
		return maxLockAfterSeconds
	default:
		return seconds
	}
}

// settingBool/settingInt read one persisted value, falling back to def
// for an absent key, a value of the wrong type, or a service built
// without a settings store (some narrow integration tests). The int
// read accepts float64 because the store round-trips through JSON,
// where every number comes back as one.
func (s *SecretService) settingBool(key string, def bool) bool {
	if s.settings == nil {
		return def
	}
	v, ok := s.settings.Get(key).(bool)
	if !ok {
		return def
	}
	return v
}

func (s *SecretService) settingInt(key string, def int) int {
	if s.settings == nil {
		return def
	}
	switch v := s.settings.Get(key).(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	default:
		return def
	}
}

// VaultLockPolicy reports the persisted policy -- plain store reads,
// never a prompt, safe from any build and without holding s.mu.
func (s *SecretService) VaultLockPolicy() LockPolicy {
	return LockPolicy{
		LockAfterSeconds: clampLockAfter(s.settingInt(lockAfterKey, defaultLockAfterSeconds)),
		LockOnSleep:      s.settingBool(lockOnSleepKey, defaultLockOnSleep),
		LockOnUserSwitch: s.settingBool(lockOnUserSwitchKey, defaultLockOnUserSwitch),
		LockOnMinimize:   s.settingBool(lockOnMinimizeKey, defaultLockOnMinimize),
	}
}

// SetVaultLockPolicy persists the whole policy at once -- the surface
// edits one control at a time but always submits the current state of
// all four, so a partially-written policy is not a state that exists.
// Unlike the unlock requirement, this needs no open vault: it decides
// when the vault closes, which is answerable while it is shut.
func (s *SecretService) SetVaultLockPolicy(policy LockPolicy) error {
	if s.settings == nil {
		return fmt.Errorf("the lock policy can't be changed in this mode")
	}
	values := map[string]any{
		lockAfterKey:        clampLockAfter(policy.LockAfterSeconds),
		lockOnSleepKey:      policy.LockOnSleep,
		lockOnUserSwitchKey: policy.LockOnUserSwitch,
		lockOnMinimizeKey:   policy.LockOnMinimize,
	}
	for _, key := range []string{lockAfterKey, lockOnSleepKey, lockOnUserSwitchKey, lockOnMinimizeKey} {
		if err := s.settings.Set(key, values[key]); err != nil {
			return fmt.Errorf("saving the lock policy: %w", err)
		}
	}
	dataevent.Emit("secret", "")
	return nil
}

// UnlockCapability reports what this Mac would actually ask for when
// the unlock requirement is on -- "none", "password", "touchID",
// "touchIDAndWatch" or "watch". The surface words its own label from
// it rather than promising Touch ID on a Mac that has none.
func (s *SecretService) UnlockCapability() string {
	return string(localAuthCapabilityFn())
}

// localAuthCapabilityFn is localauth.Describe's own swappable seam --
// same test-pinning shape localAuthAvailableFn establishes.
var localAuthCapabilityFn = localauth.Describe

// lockAfterDuration is the idle timeout as a duration, or zero when
// the vault never locks on idle.
func (s *SecretService) lockAfterDuration() time.Duration {
	return time.Duration(s.VaultLockPolicy().LockAfterSeconds) * time.Second
}

// HandleLockTrigger locks the vault when trigger is one this policy
// acts on. Sleep and screen lock share one checkbox: both mean the
// Mac is no longer in front of the person who unlocked it, and a
// surface offering them separately would be two controls for one
// decision.
//
// Safe to call from any goroutine and from a build with no vault open
// -- an unrecognized trigger, a locked vault, and a policy that
// ignores this trigger are all silent no-ops.
//
//wails:ignore
func (s *SecretService) HandleLockTrigger(trigger string) {
	if !s.vault.Unlocked() {
		return
	}
	policy := s.VaultLockPolicy()
	var enabled bool
	switch trigger {
	case TriggerSleep, TriggerScreenLock:
		enabled = policy.LockOnSleep
	case TriggerUserSwitch:
		enabled = policy.LockOnUserSwitch
	case TriggerMinimize:
		enabled = policy.LockOnMinimize
	default:
		return
	}
	if !enabled {
		return
	}
	s.lockVaultNow()
}

// lockVaultNow closes the vault and tells every surface that reads its
// state to re-read. The one place an automatic lock happens, so the
// idle timer and the event triggers can never drift on what "lock"
// means.
func (s *SecretService) lockVaultNow() {
	s.vault.Lock()
	dataevent.Emit("secret", "")
}

// WireLockTriggers relays the OS moments window can observe into this
// service's policy. One call from the composition root; a build with
// no live desktop app (server mode, headless tests) subscribes nothing
// and this becomes a no-op.
//
//wails:ignore
func (s *SecretService) WireLockTriggers(window *windowing.Window) {
	window.WireLockTriggers(func(trigger windowing.LockTrigger) {
		s.HandleLockTrigger(string(trigger))
	})
}
