# Sourced (never executed directly) by lefthook's Go gate steps and by
# scripts/check-build-warnings.sh, wherever a bare `go build`/`go
# vet`/golangci-lint invocation needs to link Mill's own darwin cgo
# files against ONE deployment target -- Wails3's own scaffold floor
# (v3/internal/commands/build_assets/darwin/Taskfile.yml), matching
# build/darwin/Taskfile.yml's build:native task (root Taskfile.yml's
# own `env:` covers every `task` invocation already; this covers the
# bare-`go`/lefthook path the Task graph doesn't reach). No set -e/-u
# here -- sourced into a caller that already carries its own.

# goal 0419 S2c: Go 1.27 discontinued macOS 12 support in its own
# linker (go.dev/doc/go1.27, "Darwin" -- the toolchain now stamps
# LC_BUILD_VERSION's minimum at 13.0 unconditionally, independent of
# any -mmacosx-version-min flag passed in). 12.0 -> 13.0 here isn't a
# discretionary target choice; it's the floor the Go 1.27 toolchain
# itself enforces, matched everywhere else this value is set
# (root Taskfile.yml's env: block, ci.yml's macOS legs) to stay one
# value.
export MACOSX_DEPLOYMENT_TARGET=13.0
export CGO_CFLAGS="-mmacosx-version-min=13.0"
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
export CGO_LDFLAGS="-mmacosx-version-min=13.0 -Wl,-no_warn_duplicate_libraries"
# GOTOOLCHAIN pin: go.mod's `go 1.27` line is a floor, not a pin --
# GOTOOLCHAIN=auto (Go's default) keeps using whatever `go` binary is
# already on PATH once it satisfies that floor, even a newer one.
# Pinning here keeps local gates matching CI's own toolchain exactly
# without depending on whatever `go` happens to be on a contributor's
# PATH.
export GOTOOLCHAIN=go1.27.1
