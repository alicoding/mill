package secretsvc

import (
	"errors"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/presencekey"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// presenceService namespaces the vault master key's OPT-IN
// presence-gated keychain item under its own recognizable Keychain
// Access entry -- deliberately a DIFFERENT keychain "service" name than
// credential.Store's "mill-connector" (goal 0204 item 4's collision
// finding: the desktop app and a LaunchAgent server instance share that
// namespace, and the vault file itself, by construction --
// windowing.ConfigDirOrEnv's own doc comment says every MILL_* data
// path resolves identically across both unless explicitly overridden).
// Using a separate identity means enabling protection can create the
// NEW item before the OLD plain one is touched -- never two writes to
// one identity, never a window where neither exists.
const presenceService = "mill-secret-vault-presence"

// presenceSentinel replaces the master key's own plain credential.Store
// value once Touch ID protection is enabled. Any build -- including a
// server build that never even compiles presencekey's real darwin code
// -- can then tell "this vault requires Touch ID" from one plain,
// unprompted read, which is what lets VaultStatus/PresenceProtected
// word the status line correctly everywhere, and lets UnlockVault fail
// closed with ErrPresenceUnsupported instead of a bare not-found.
const presenceSentinel = "mill-vault-key-presence-protected"

// unlockPrompt/enablePrompt/disablePrompt are the operation-specific
// kSecUseOperationPrompt strings shown in the system authentication
// sheet (.claude/rules/ux-writing.md: front-loaded action, user
// vocabulary, no internals).
const (
	unlockPrompt  = "Unlock the Mill vault"
	enablePrompt  = "Confirm Touch ID protection for the Mill vault"
	disablePrompt = "Turn off Touch ID protection for the Mill vault"
)

// ErrPresenceUnsupported is returned wherever this build/mode cannot
// present platform authentication -- server mode, or any non-darwin
// build (goal 0204 item 4: fail closed with an actionable message,
// never hang, never a raw keychain/cgo error).
//nolint:staticcheck // ST1005: starts with "Touch ID", a fixed product name whose capitalization staticcheck's proper-noun heuristic doesn't recognize -- this text reaches the user unwrapped (.claude/rules/ux-writing.md), never chained with other error text
var ErrPresenceUnsupported = errors.New("Touch ID protection isn't available in this mode")

// ErrAuthenticationCanceled is returned when the user dismisses the
// system authentication prompt.
var ErrAuthenticationCanceled = errors.New("authentication was canceled")

// presenceWrapFn/presenceReadFn/presenceRemoveFn are
// presencekey.Wrap/Read/Remove's own swappable seams -- same
// test-pinning shape idleTimeFn/clipboardWriteFn already establish in
// secretservice_autolock.go: a test never wants to touch the real
// keychain or trigger a live authentication prompt.
var (
	presenceWrapFn   = presencekey.Wrap
	presenceReadFn   = presencekey.Read
	presenceRemoveFn = presencekey.Remove
)

// clarifyPresenceErr maps presencekey's own low-level sentinels into
// the honest, actionable text this goal's UI surfaces directly (every
// Go error here reaches the frontend as its own message, unwrapped --
// .claude/rules/ux-writing.md applies to these strings, not just JSX
// copy) -- a complete sentence on its own, never prefixed with an
// operation label. Every other presencekey error is wrapped with the
// calling operation's own context by the caller instead, via
// wrapPresenceErr.
func clarifyPresenceErr(err error) error {
	switch {
	case errors.Is(err, presencekey.ErrUnsupported):
		return ErrPresenceUnsupported
	case errors.Is(err, presencekey.ErrCanceled):
		return ErrAuthenticationCanceled
	default:
		return err
	}
}

// wrapPresenceErr clarifies err first; a clarified sentinel is already
// a complete, honest sentence and returns as-is, while anything else
// gets context prefixed so it's still traceable to the operation that
// failed.
func wrapPresenceErr(context string, err error) error {
	clarified := clarifyPresenceErr(err)
	if errors.Is(clarified, ErrPresenceUnsupported) || errors.Is(clarified, ErrAuthenticationCanceled) {
		return clarified
	}
	return fmt.Errorf("%s: %w", context, clarified)
}

// currentlyPresenceProtected reports whether the master key's plain
// credential.Store slot currently holds presenceSentinel -- a plain
// read, never a prompt, safe to call from any build including server
// mode and without holding s.mu (credentials has its own thread-safety;
// this never touches s.vault). An unreadable/missing key (e.g. before
// SetupVault) reads as "not protected", matching VaultStatus's own
// default-false posture before a vault exists at all.
func (s *SecretService) currentlyPresenceProtected() bool {
	encoded, err := s.credentials.Get(masterKeyID)
	if err != nil {
		return false
	}
	return encoded == presenceSentinel
}

// resolveMasterKeyLocked decodes the vault's master key from encoded --
// the plain credential.Store value directly, or (when encoded is
// presenceSentinel) via the presence-gated read, which BLOCKS through
// the system authentication prompt. Caller must hold s.mu.
func (s *SecretService) resolveMasterKeyLocked(encoded string) ([]byte, error) {
	if encoded != presenceSentinel {
		return secretvault.DecodeMasterKey(encoded)
	}
	raw, err := presenceReadFn(presenceService, masterKeyID, unlockPrompt)
	if err != nil {
		return nil, wrapPresenceErr("unlocking with Touch ID", err)
	}
	return secretvault.DecodeMasterKey(string(raw))
}

// SetTouchIDProtection turns Touch ID protection on or off for the
// vault's master key (goal 0204's BUILD CONTRACT). The vault must
// already be unlocked -- this manages where the KEY is stored, not the
// in-memory decrypted vault, but toggling protection for a vault you
// can't currently see would be a confusing surface to expose.
func (s *SecretService) SetTouchIDProtection(enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.vault.Unlocked() {
		return secretvault.ErrLocked
	}
	if enabled == s.currentlyPresenceProtected() {
		return nil
	}
	if enabled {
		return s.enablePresenceLocked()
	}
	return s.disablePresenceLocked()
}

// enablePresenceLocked re-wraps the CURRENT master key behind a NEW
// presence-gated keychain item, reads it back to VERIFY it actually
// works, and only THEN overwrites the plain slot with presenceSentinel.
// The old plain item is never deleted -- only ever overwritten after a
// successful verify -- so a failed enable (including the user
// dismissing the confirmation prompt) never loses the key: it rolls
// back by removing the just-added presence item and leaves the plain
// slot exactly as it was.
func (s *SecretService) enablePresenceLocked() error {
	encoded, err := s.credentials.Get(masterKeyID)
	if err != nil {
		if errors.Is(err, credential.ErrNotFound) {
			return ErrNoVaultKey
		}
		return fmt.Errorf("reading vault key: %w", err)
	}
	if err := presenceWrapFn(presenceService, masterKeyID, []byte(encoded)); err != nil {
		return wrapPresenceErr("enabling Touch ID protection", err)
	}
	readBack, err := presenceReadFn(presenceService, masterKeyID, enablePrompt)
	if err != nil {
		_ = presenceRemoveFn(presenceService, masterKeyID)
		return wrapPresenceErr("confirming Touch ID protection", err)
	}
	if string(readBack) != encoded {
		_ = presenceRemoveFn(presenceService, masterKeyID)
		return errors.New("confirming Touch ID protection: the key read back didn't match")
	}
	if err := s.credentials.Set(masterKeyID, presenceSentinel); err != nil {
		_ = presenceRemoveFn(presenceService, masterKeyID)
		return fmt.Errorf("finishing Touch ID protection: %w", err)
	}
	dataevent.Emit("secret", "")
	return nil
}

// disablePresenceLocked requires passing the authentication prompt
// FIRST -- the anti-downgrade property this goal exists to add.
// Removing protection without proving presence would let any process
// silently strip it, which is exactly Finding C's original hole. Once
// the real key is confirmed and restored to the plain slot, removing
// the now-redundant presence item is best-effort: if it fails, the
// vault is already safe on the plain path, and the next enable's own
// duplicate-item retry (presencekey_darwin.go's cgoWrap) cleans up the
// orphan.
func (s *SecretService) disablePresenceLocked() error {
	key, err := presenceReadFn(presenceService, masterKeyID, disablePrompt)
	if err != nil {
		return wrapPresenceErr("turning off Touch ID protection", err)
	}
	if err := s.credentials.Set(masterKeyID, string(key)); err != nil {
		return fmt.Errorf("turning off Touch ID protection: %w", err)
	}
	_ = presenceRemoveFn(presenceService, masterKeyID)
	dataevent.Emit("secret", "")
	return nil
}
