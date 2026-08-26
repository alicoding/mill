package settingssvc

import "github.com/alicoding/mill/internal/adapters/codesigning"

// trustIdentityFn is the trust-granting seam TrustSigningIdentity
// calls -- the same swappable-var shape as resignBundleFn
// (settingsservice_updates_resign.go) so tests can substitute a fake
// instead of touching a real macOS keychain and its authentication
// dialog.
var trustIdentityFn = codesigning.TrustIdentity

// TrustSigningIdentity grants Mill's own local signing certificate
// "Always Trust" for code signing -- the Settings > Updates button
// that replaces the former "find it in Keychain Access" instructions
// (docs/goals/0220-update-experience-one-pattern.md S3). Idempotent
// and safe to call repeatedly: it never depends on whether the
// identity is already trusted, since that state cannot be detected
// reliably (the spike's own finding, recorded in codesigning's
// TrustIdentity doc comment).
func (s *SettingsService) TrustSigningIdentity() error {
	return trustIdentityFn()
}
