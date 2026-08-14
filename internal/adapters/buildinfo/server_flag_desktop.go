//go:build !server

package buildinfo

// isServerBuild: the build-tag half of Info.Server -- same
// server/!server file-pair shape as internal/adapters/hotkey.
const isServerBuild = false
