package settingssvc

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
	updaterGithub "github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

func assets(names ...string) []updaterGithub.ReleaseAsset {
	out := make([]updaterGithub.ReleaseAsset, 0, len(names))
	for _, n := range names {
		out = append(out, updaterGithub.ReleaseAsset{Name: n})
	}
	return out
}

func req(platform, arch string) updater.CheckRequest {
	return updater.CheckRequest{Platform: platform, Arch: arch}
}

// Regression: the v0.2.0 release's real asset set — a "macos"-named zip
// plus SHA256SUMS — must match a darwin/arm64 request (the default
// matcher returned -1 for exactly this set).
func TestUpdaterAssetMatcher_DarwinMatchesMacosAsset(t *testing.T) {
	got := UpdaterAssetMatcher(req("darwin", "arm64"), assets("SHA256SUMS", "mill-0.2.0-macos-arm64.zip"))
	if got != 1 {
		t.Fatalf("want index 1 (the macos zip), got %d", got)
	}
}

func TestUpdaterAssetMatcher_SkipsChecksumAndSignatureSidecars(t *testing.T) {
	got := UpdaterAssetMatcher(req("darwin", "arm64"), assets(
		"mill-0.2.0-macos-arm64.zip.sig",
		"mill-0.2.0-macos-arm64.zip.sha256",
		"checksums.txt",
		"mill-0.2.0-macos-arm64.zip",
	))
	if got != 3 {
		t.Fatalf("want index 3 (the payload zip), got %d", got)
	}
}

func TestUpdaterAssetMatcher_ArchAliases(t *testing.T) {
	if got := UpdaterAssetMatcher(req("darwin", "arm64"), assets("mill-macos-aarch64.zip")); got != 0 {
		t.Fatalf("aarch64 alias: want 0, got %d", got)
	}
	if got := UpdaterAssetMatcher(req("darwin", "amd64"), assets("mill-macos-x86_64.zip")); got != 0 {
		t.Fatalf("x86_64 alias: want 0, got %d", got)
	}
}

func TestUpdaterAssetMatcher_WrongPlatformOrArchReturnsNoMatch(t *testing.T) {
	if got := UpdaterAssetMatcher(req("windows", "amd64"), assets("mill-0.2.0-macos-arm64.zip", "SHA256SUMS")); got != -1 {
		t.Fatalf("windows against macos-only assets: want -1, got %d", got)
	}
	if got := UpdaterAssetMatcher(req("darwin", "amd64"), assets("mill-0.2.0-macos-arm64.zip")); got != -1 {
		t.Fatalf("amd64 against arm64-only asset: want -1, got %d", got)
	}
}

func TestUpdaterAssetMatcher_LiteralPlatformStillMatches(t *testing.T) {
	if got := UpdaterAssetMatcher(req("darwin", "arm64"), assets("mill_darwin_arm64.tar.gz")); got != 0 {
		t.Fatalf("literal darwin naming: want 0, got %d", got)
	}
}
