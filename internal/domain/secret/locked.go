package secret

import (
	"errors"
	"strings"
)

// ErrVaultLocked is the one sentinel every secret-resolution seam
// surfaces when the vault is locked -- the run executor maps it to a
// park (the run waits for the vault), never to a failed step. The
// adapter's own ErrLocked wraps it, so errors.Is works through every
// layer that wraps with %w.
var ErrVaultLocked = errors.New("vault is locked")

// IsVaultLocked reports whether err means the vault is locked. It
// matches by message as well as by identity: a checkpointed step's
// error crosses the durable engine's JSON round trip on replay, which
// preserves only Error(), never Go type or errors.Is (the same
// constraint composition.CancelledByUserMessage is matched under).
func IsVaultLocked(err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, ErrVaultLocked) || strings.Contains(err.Error(), ErrVaultLocked.Error())
}
