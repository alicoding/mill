//go:build !server

package settingssvc

// isServerBuild: the build-tag half of BuildInfo.Server (see its doc
// comment) -- same `server`/`!server` file-pair shape as
// internal/adapters/hotkey.
const isServerBuild = false
