package secretsvc

import (
	"errors"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/localauth"
	"github.com/alicoding/mill/internal/adapters/presencekey"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// requireAuthKey persists the app-level unlock requirement. It lives in
// the settings store, not the keychain, because it configures the
// kernel rather than holding anything secret: a keychain ACL cannot
// carry this requirement in a build without an Apple Team ID (the
// localauth package doc has the full reasoning), so the requirement is
// a gate Mill enforces in front of a plain keychain item.
const requireAuthKey = "secrets.requireAuthToUnlock"

// unlockReason is the localized explanation the system authentication
// sheet renders as "Mill is trying to <reason>".
const unlockReason = "Unlock the Mill vault"

// ErrUnlockCancelled is returned when the person dismisses the system
// authentication sheet, or steps out of it. The leading token is the
// stable handle the frontend matches on (see ErrNoVaultKey).
var ErrUnlockCancelled = errors.New("unlock-cancelled: authentication was not completed")

// ErrAuthUnavailable is returned wherever the requirement cannot be
// honoured: no biometry enrolled and no password set, or a build with
// no console session to show a sheet in (server mode, non-darwin).
// Turning the requirement ON is refused for the same reason. Fails
// closed -- a vault whose owner asked for a gate never opens without
// one.
var ErrAuthUnavailable = errors.New("auth-unavailable: no Touch ID or password authentication is set up on this Mac")

// localAuthAvailableFn/localAuthAuthenticateFn are localauth's own
// swappable seams -- same test-pinning shape idleTimeFn/
// clipboardWriteFn establish in secretservice_autolock.go: no test may
// raise a real authentication sheet.
var (
	localAuthAvailableFn    = localauth.Available
	localAuthAuthenticateFn = localauth.Authenticate
)

// requireAuthToUnlock reports the persisted setting -- a plain store
// read, never a prompt, safe from any build and without holding s.mu.
// A service constructed without a settings store (some narrow
// integration tests) reads as "no requirement".
func (s *SecretService) requireAuthToUnlock() bool {
	if s.settings == nil {
		return false
	}
	v, _ := s.settings.Get(requireAuthKey).(bool)
	return v
}

// gateUnlockLocked runs the authentication gate when the requirement is
// on, translating localauth's error surface into the sentences (and
// match tokens) the unlock surface words itself from. Caller holds
// s.mu; the call BLOCKS this goroutine through the system sheet.
func (s *SecretService) gateUnlockLocked() error {
	if !s.requireAuthToUnlock() {
		return nil
	}
	err := localAuthAuthenticateFn(unlockReason)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, localauth.ErrCancelled), errors.Is(err, localauth.ErrFallback):
		return ErrUnlockCancelled
	case errors.Is(err, localauth.ErrNotAvailable),
		errors.Is(err, localauth.ErrUnsupported),
		errors.Is(err, localauth.ErrNotInteractive):
		return ErrAuthUnavailable
	case errors.Is(err, localauth.ErrLockout):
		return errors.New("Too many failed attempts. Unlock this Mac with your password, then try again.") //nolint:staticcheck // ST1005: reaches the user as a complete sentence, never wrapped
	case errors.Is(err, localauth.ErrFailed):
		return errors.New("Mill couldn't confirm it's you.") //nolint:staticcheck // ST1005: reaches the user as a complete sentence, never wrapped
	default:
		return fmt.Errorf("confirming it's you: %w", err)
	}
}

// SetTouchIDProtection turns the unlock requirement on or off. The
// vault must already be unlocked: changing how a vault opens while you
// can't see inside it is a surface with no honest read-back. Turning it
// on is refused where this Mac cannot authenticate at all, so the
// requirement never lands in a state that would lock the vault shut.
func (s *SecretService) SetTouchIDProtection(enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.vault.Unlocked() {
		return secretvault.ErrLocked
	}
	if s.settings == nil {
		return errors.New("this unlock requirement can't be changed in this mode")
	}
	if enabled && !localAuthAvailableFn() {
		return ErrAuthUnavailable
	}
	if enabled == s.requireAuthToUnlock() {
		return nil
	}
	if err := s.settings.Set(requireAuthKey, enabled); err != nil {
		return fmt.Errorf("saving the unlock requirement: %w", err)
	}
	dataevent.Emit("secret", "")
	return nil
}

// legacyPresenceService/legacyPresenceSentinel name the keychain
// identity and the marker value an earlier design used: the master key
// was moved into an item carrying kSecAttrAccessControl and its plain
// slot overwritten with the marker. That ACL is inert outside the
// data-protection keychain (localauth's package doc), so the item read
// back with no prompt and the protection it promised never existed.
const (
	legacyPresenceService  = "mill-secret-vault-presence"
	legacyPresenceSentinel = "mill-vault-key-presence-protected"
)

// presenceReadFn/presenceRemoveFn are the migration's own swappable
// seams. presencekey survives ONLY to serve this migration -- reading
// the inert ACL'd item back and deleting it. Nothing else in Mill
// creates such an item.
var (
	presenceReadFn   = presencekey.Read
	presenceRemoveFn = presencekey.Remove
)

// MigrateLegacyPresenceProtection moves a vault off the inert ACL'd
// keychain item and onto the setting-backed gate, once, at startup: the
// key returns to its plain slot (where the vault-identity binding then
// picks it up on the next unlock), the ACL'd item is deleted, and the
// unlock requirement is turned on so the protection that item only
// promised is now actually enforced. Every step is best-effort: a vault that
// can't be migrated this launch is left exactly as it was and tried
// again on the next one, never left half-moved with no readable key.
//
//wails:ignore
func (s *SecretService) MigrateLegacyPresenceProtection() {
	encoded, err := s.credentials.Get(legacyMasterKeyID)
	if err != nil || encoded != legacyPresenceSentinel {
		return
	}
	raw, err := presenceReadFn(legacyPresenceService, legacyMasterKeyID, unlockReason)
	if err != nil {
		return
	}
	if err := s.credentials.Set(legacyMasterKeyID, string(raw)); err != nil {
		return
	}
	_ = presenceRemoveFn(legacyPresenceService, legacyMasterKeyID)
	if s.settings != nil {
		_ = s.settings.Set(requireAuthKey, true)
	}
}
