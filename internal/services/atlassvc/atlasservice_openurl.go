package atlassvc

import (
	"fmt"
	"os"

	"github.com/alicoding/mill/internal/adapters/osopen"
)

// OpenURL opens url in the system's default browser -- the ONE
// Mill-bound door every external-link click in the frontend routes
// through (frontend/src/shared/openExternal.ts), so a click always
// goes through osopen.New()'s own Port selection rather than the
// adopted runtime's Browser.OpenURL directly (goal 0356 part 2: a test
// or an e2e-spawned server must never open a real browser tab on the
// machine running it).
func (a *AtlasService) OpenURL(url string) error {
	return osopen.New().OpenURL(url)
}

// DebugLastOpenedURLs returns every URL osopen's in-memory Port has
// recorded so far, oldest first. Gated to MILL_OPEN=memory -- the same
// posture SecretService.DebugCorruptVaultKeyForTests holds against
// MILL_TEST_KEYRING=memory -- so this can never be called expecting a
// Host it didn't get.
func (a *AtlasService) DebugLastOpenedURLs() ([]string, error) {
	if os.Getenv("MILL_OPEN") != "memory" {
		return nil, fmt.Errorf("debug test knobs are only available against the in-memory open port")
	}
	return osopen.DebugOpenedURLs(), nil
}
