#!/usr/bin/env bash
# Probes check-build-warnings.sh's warning-vs-failure classification
# (goal 0419 S1/S1c) against a stubbed `go`, so an edit to the gate
# can't silently start treating a real warning as clean or a real
# build failure as a warning -- same probe-on-touch shape as
# review-report-selftest.sh, but PATH-stubbing the tool under test
# instead of piping fixture bodies, since the gate's subject is a
# `go build`/`go vet`/`go test` invocation, not a file it reads.
set -euo pipefail

gate="$(cd "$(dirname "$0")" && pwd)/check-build-warnings.sh"
fails=0

stubdir="$(mktemp -d)"
trap 'rm -rf "$stubdir"' EXIT

# The fake `go` only needs to answer the three subcommands the gate
# invokes (build/vet/test); FAKE_GO_MODE picks its stdout/stderr/exit
# so one stub covers every probe below.
cat >"$stubdir/go" <<'EOF'
#!/usr/bin/env bash
case "${FAKE_GO_MODE:-clean}" in
  clean)
    exit 0
    ;;
  warn)
    echo "ld: warning: object file (fixture.o) was built for newer 'macOS' version (12.0) than being linked (11.0)" >&2
    exit 0
    ;;
  fail)
    echo "internal/adapters/fixturesvc/fixture.go:1:1: undefined: fixtureSymbol" >&2
    exit 2
    ;;
  *)
    echo "unknown FAKE_GO_MODE: ${FAKE_GO_MODE:-}" >&2
    exit 99
    ;;
esac
EOF
chmod +x "$stubdir/go"

# probe <expected-exit> <label> <FAKE_GO_MODE>
probe() {
  local want="$1" label="$2" mode="$3" got
  set +e
  ( PATH="$stubdir:$PATH" FAKE_GO_MODE="$mode" bash "$gate" >/dev/null 2>&1 )
  got=$?
  set -e
  if [ "$got" != "$want" ]; then
    echo "FAIL: want exit $want, got $got: $label" >&2
    fails=$((fails + 1))
  fi
}

probe 0 "clean build/vet/test output passes" "clean"
probe 1 "a linker warning on stderr fails, even with exit 0" "warn"
probe 2 "a real build error (no 'warning' text) fails with its own status, not 1" "fail"

if [ "$fails" -gt 0 ]; then
  echo "check-build-warnings-selftest: $fails probe(s) failed" >&2
  exit 1
fi

exit 0
