//go:build !production

package windowing

// isReleaseBuild is false for every dev/test build (task dev, go
// build/vet/test with no explicit -tags production) -- see
// release_flag_production.go for the true half.
const isReleaseBuild = false
