//go:build production

package windowing

// isReleaseBuild: the build-tag half of the main-thread assertion's
// dev-vs-release posture (assert.go) -- same file-pair shape as
// internal/adapters/buildinfo's isServerBuild. `production` is stamped
// only by build/Taskfile.yml's non-DEV path (task build / task
// package), never by `task dev` or a bare `go test`, so this is true
// only in an actual release/production binary.
const isReleaseBuild = true
