//go:build !production

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// No single-instance guard in non-production builds -- see
// singleinstance_production.go for the full why. Critically, `task dev`
// (which builds without -tags production) MUST NOT activate the guard:
// SingleInstance makes a second launch defer to the first, so a
// `wails3 dev` rebuild would defer to the STALE window instead of
// replacing it. Returning nil leaves application.Options.SingleInstance
// unset, exactly as before this existed.
func singleInstanceOptions(func() *application.WebviewWindow) *application.SingleInstanceOptions {
	return nil
}
