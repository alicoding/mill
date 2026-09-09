# Sourced (never executed directly) by lefthook's Go gate steps and by
# scripts/check-build-warnings.sh, wherever a bare `go build`/`go
# vet`/golangci-lint invocation needs to link Mill's own darwin cgo
# files against ONE deployment target -- Wails3's own scaffold floor
# (v3/internal/commands/build_assets/darwin/Taskfile.yml), matching
# build/darwin/Taskfile.yml's build:native task (root Taskfile.yml's
# own `env:` covers every `task` invocation already; this covers the
# bare-`go`/lefthook path the Task graph doesn't reach). No set -e/-u
# here -- sourced into a caller that already carries its own.

export MACOSX_DEPLOYMENT_TARGET=12.0
export CGO_CFLAGS="-mmacosx-version-min=12.0"
# -Wl,-no_warn_duplicate_libraries: every cgo package built with `-x
# objective-c` (Mill's own four darwin packages, plus Wails'
# pkg/application/pkg/services/{dock,notifications} and
# golang.design/x/hotkey) gets an automatic `-lobjc` from cgo itself,
# never from any package's own LDFLAGS -- linking five-plus such
# packages into one binary repeats that flag, which ld already
# de-duplicates correctly. This silences ld's advisory notice about
# work it already did right; confirmed via `go build -x` that no
# per-package LDFLAGS scoping removes the duplication, since each
# package's cgo invocation adds its own independently.
export CGO_LDFLAGS="-mmacosx-version-min=12.0 -Wl,-no_warn_duplicate_libraries"
# GOTOOLCHAIN pin: go.mod's `go 1.26` line is a floor, not a pin --
# GOTOOLCHAIN=auto (Go's default) keeps using whatever `go` binary is
# already on PATH once it satisfies that floor, even a newer one. A
# newer local toolchain's own linker embeds a higher default minimum
# macOS version into the Go-authored half of the binary regardless of
# MACOSX_DEPLOYMENT_TARGET (confirmed empirically: go1.27.1 emits `ld:
# warning: ... was built for newer macOS version (13.0) than being
# linked (12.0)`; go1.26.8 -- the version CI's setup-go actually
# resolves for its `go-version: '1.26'` pin -- does not). Pinning here
# keeps local gates matching CI's own toolchain exactly without moving
# the repo's declared minimum (go.mod's `go 1.26` line is untouched;
# S2 owns any real currency bump).
export GOTOOLCHAIN=go1.26.8
