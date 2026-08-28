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

// isTrustedFn is the trust-state read seam IsSigningTrusted calls --
// the same swappable-var shape as trustIdentityFn, so tests can
// substitute a fake instead of touching the real keychain/security
// binary.
var isTrustedFn = codesigning.IsTrusted

// IsSigningTrusted reports whether Mill's own signing certificate
// already carries "Always Trust" for code signing. Unlike
// TrustSigningIdentity's write, this is a plain state read with no
// authorization step, so the Settings > Updates "How updates stay
// trusted" section calls it on every mount to hide itself once trust
// is already established, rather than showing a button there is no
// longer any reason to click.
func (s *SettingsService) IsSigningTrusted() (bool, error) {
	return isTrustedFn()
}
