package settingssvc

import (
	"strings"

	"github.com/wailsapp/wails/v3/pkg/updater"
	updaterGithub "github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

// UpdaterAssetMatcher replaces the provider's DefaultAssetMatcher, which
// requires the asset name to contain the literal GOOS string: Mill's
// release assets are named for humans ("mill-0.2.0-macos-arm64.zip",
// build/release.yml), and "macos" never contains "darwin", so the
// default matcher rejected the only real asset on every check
// ("release v0.2.0 has no asset for darwin/arm64"). Platform aliases
// fix that the same way the provider's own containsArch already
// aliases arm64/aarch64 — recognize the ecosystem's common spellings,
// keep the human-friendly release naming.
func UpdaterAssetMatcher(req updater.CheckRequest, assets []updaterGithub.ReleaseAsset) int {
	plat := strings.ToLower(req.Platform)
	arch := strings.ToLower(req.Arch)
	for i, a := range assets {
		name := strings.ToLower(a.Name)
		if isSidecarAsset(name) {
			continue
		}
		if plat != "" && !containsPlatform(name, plat) {
			continue
		}
		if arch != "" && !containsUpdaterArch(name, arch) {
			continue
		}
		return i
	}
	return -1
}

// Sidecars are never the update payload: signatures, checksum manifests
// (Mill publishes SHA256SUMS next to the zip), and installers.
func isSidecarAsset(name string) bool {
	if strings.HasSuffix(name, ".sig") || strings.HasSuffix(name, ".asc") {
		return true
	}
	if strings.Contains(name, "sha256") || strings.Contains(name, "checksum") {
		return true
	}
	return strings.Contains(name, "-installer.") || strings.Contains(name, "_installer.") || name == "installer.exe"
}

func containsPlatform(name, plat string) bool {
	if strings.Contains(name, plat) {
		return true
	}
	switch plat {
	case "darwin":
		return strings.Contains(name, "macos") || strings.Contains(name, "mac-") || strings.Contains(name, "osx")
	case "windows":
		return strings.Contains(name, "win64") || strings.Contains(name, "win32")
	}
	return false
}

// Same aliases the provider's unexported containsArch applies (amd64 as
// x86_64/x64, arm64 as aarch64), minus the 386 family Mill never ships.
func containsUpdaterArch(name, arch string) bool {
	if strings.Contains(name, arch) {
		return true
	}
	if arch == "amd64" && (strings.Contains(name, "x86_64") || strings.Contains(name, "x64")) {
		return true
	}
	return arch == "arm64" && strings.Contains(name, "aarch64")
}
