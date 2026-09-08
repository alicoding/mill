#!/usr/bin/env bash
# Probes the gomodguard_v2 wiring in .golangci.yml (goal 0385) against a
# throwaway Go module, so an edit to the linter config cannot silently
# stop rejecting a blocked import. Uses github.com/google/uuid (already
# in Mill's own module graph and Go's local module cache, so both
# probes resolve with no network fetch) as the fixture's own blocked
# module rather than the real 5-entry list -- this proves the MECHANISM
# (gomodguard_v2 configured + enabled correctly rejects a blocked
# import), which is what a config edit could break; each real entry's
# own correctness is the reviewable diff, not something a fixture
# re-derives per module name.
set -euo pipefail

fails=0

fixture_go_mod() {
  local dir="$1"
  printf 'module fixture\n\ngo 1.25\n\nrequire github.com/google/uuid v1.6.0\n' >"$dir/go.mod"
}

fixture_golangci_yml() {
  local dir="$1"
  cat >"$dir/.golangci.yml" <<'EOF'
version: "2"
linters:
  default: none
  enable:
    - gomodguard_v2
  settings:
    gomodguard_v2:
      blocked:
        - module: github.com/google/uuid
          reason: fixture-only block for check-gomodguard-selftest.sh.
EOF
}

# probe <expected-exit> <label> <dir>
probe() {
  local want="$1" label="$2" dir="$3" got out
  set +e
  out="$(cd "$dir" && golangci-lint run --allow-parallel-runners . 2>&1)"
  got=$?
  set -e
  if [ "$got" != "$want" ]; then
    echo "FAIL: want exit $want, got $got: $label" >&2
    echo "$out" >&2
    fails=$((fails + 1))
  fi
}

bad="$(mktemp -d)"
fixture_go_mod "$bad"
fixture_golangci_yml "$bad"
cat >"$bad/main.go" <<'EOF'
package main

import (
	"fmt"

	"github.com/google/uuid"
)

func main() {
	fmt.Println(uuid.New().String())
}
EOF
probe 1 "a blocked module import fails" "$bad"

good="$(mktemp -d)"
fixture_go_mod "$good"
fixture_golangci_yml "$good"
cat >"$good/main.go" <<'EOF'
package main

import "fmt"

func main() {
	fmt.Println("no blocked import here")
}
EOF
probe 0 "no blocked import passes" "$good"

rm -rf "$bad" "$good"

if [ "$fails" -ne 0 ]; then
  echo "check-gomodguard-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "check-gomodguard-selftest: OK"
