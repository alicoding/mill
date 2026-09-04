//go:build server

package systemaccent

// read returns no accent in server mode -- there is no desktop whose
// accent could be read, and the frontend keeps Mill's built-in one.
func read() string { return "" }
