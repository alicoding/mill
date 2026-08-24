//go:build !darwin && !server

package launchatlogin

// smAppServiceRequiresApproval is always false outside darwin --
// SMAppService is a macOS-only mechanism, and AutostartManager's own
// Status() is trusted as-is on Windows/Linux (registry Run key,
// XDG autostart -- neither has a pending-approval concept).
func smAppServiceRequiresApproval() bool {
	return false
}

// retireLegacySystemEventsItem is a no-op outside darwin -- Mill's
// pre-SMAppService login-item mechanism (System Events) only ever ran
// on macOS, so there is nothing to retire on another platform.
func retireLegacySystemEventsItem(_ string) {}
