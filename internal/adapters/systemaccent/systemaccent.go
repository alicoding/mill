// Package systemaccent reads the operating system's own accent color
// through Wails3's own EnvironmentManager.GetAccentColor -- the toolkit
// already owns this domain (docs/adr/0032 §3's "read the dependency's
// whole API" rule), so nothing here reimplements NSColor access.
//
// Split by !server/server build tag, same shape and reasoning as
// internal/adapters/dockbadge: server mode has no desktop to read an
// accent from (docs/SPEC.md §1.3).
package systemaccent

// readImpl is the platform seam, swapped in tests.
var readImpl = read

// Read returns the system accent color as the platform reports it
// ("rgb(r,g,b)" on macOS), or "" when the platform has none -- the
// caller's signal to keep Mill's built-in accent.
func Read() string { return readImpl() }
