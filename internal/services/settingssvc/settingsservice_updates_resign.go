package settingssvc

import (
	"log/slog"
	"strings"

	"github.com/alicoding/mill/internal/adapters/codesigning"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// resignBundleFn is the re-sign seam DownloadAndInstallUpdate calls --
// a package-level var (the same swappable-seam shape as
// settingsservice_attention.go's dockBounceFn) so tests can substitute
// a fake signer without a real macOS keychain.
var resignBundleFn = codesigning.SignBundle

// resignStagedBundle re-signs the staged, already-verified update at
// bundlePath with Mill's own per-machine signing identity
// (docs/goals/archive/0158-stable-signing-identity.md): a
// certificate-signed bundle's designated requirement pins the
// certificate leaf instead of the build's cdhash, so it stays
// constant across every future rebuild that re-signs with the same
// identity -- unlike the ad-hoc default, which changes every build
// and silently invalidates TCC's Accessibility/Input-Monitoring
// grants.
//
// Called with Wails3's own Updater.DownloadedPath() -- the on-disk
// staged copy DownloadAndInstall already verified against the
// published SHA256 digest -- rather than anything already installed:
// Wails3's own Restart spawns a DETACHED HELPER PROCESS that performs
// the actual bundle swap only after this process has quit, so Mill's
// own code can never run again after the real, in-place swap. Signing
// the staged copy before that swap achieves the identical end state
// (the bundle that lands at the install path carries the stable
// identity) without depending on code Mill doesn't own.
//
// Deliberately never returns an error to its caller: the download this
// runs after has already verified and staged successfully, and a
// signing failure (most commonly: the local identity exists but has
// not yet been granted "Always Trust") must never make an otherwise-
// good update look failed. It logs and records a notice-pill warning
// instead (s.resignWarning, surfaced via UpdateNoticeState).
func (s *SettingsService) resignStagedBundle(bundlePath string) {
	if !strings.HasSuffix(bundlePath, ".app") {
		// Not a macOS app bundle (e.g. no staged path at all) --
		// nothing to re-sign.
		return
	}
	if err := resignBundleFn(bundlePath); err != nil {
		slog.Warn("re-sign staged update failed; the update itself still installed", "bundle", bundlePath, "error", err)
		s.mu.Lock()
		s.resignWarning = "Mill updated, but couldn't re-sign itself. If Accessibility stops working, open Keychain Access, find \"Mill Local Signing\", and set it to Always Trust for code signing."
		s.mu.Unlock()
		dataevent.Emit("update-notice", "resign-warning")
		return
	}
	slog.Info("re-signed the staged update with Mill's local signing identity", "bundle", bundlePath)
}
