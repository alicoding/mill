//go:build server

package dockbadge

// Set is a no-op in server mode -- no dock/taskbar icon exists there.
func Set(_ int) error { return nil }
