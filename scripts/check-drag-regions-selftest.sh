#!/usr/bin/env bash
# Probes check-drag-regions.sh's frameless-window cross-check (goal
# 0385) against throwaway git repos, so a new Frameless: true window
# can't ship without an explicit drag disposition going unnoticed again
# (the 0377-shaped gap this check exists to close).
set -euo pipefail
# shellcheck source=lib/git-fixture.sh
source "$(dirname "$0")/lib/git-fixture.sh"

gate="$(cd "$(dirname "$0")" && pwd)/check-drag-regions.sh"
fails=0

fixture() {
  local dir="$1"
  git_fixture_init "$dir"
}

# probe <expected-exit> <label> <dir>
probe() {
  local want="$1" label="$2" dir="$3" got
  git -C "$dir" add -A
  set +e
  ( cd "$dir" && bash "$gate" >/dev/null 2>&1 )
  got=$?
  set -e
  if [ "$got" != "$want" ]; then
    echo "FAIL: want exit $want, got $got: $label" >&2
    fails=$((fails + 1))
  fi
}

known="$(mktemp -d)"
fixture "$known"
cat >"$known/fixturewindows.go" <<'EOF'
package main

func newQuickPanelWindow(app *application.App) *application.WebviewWindow {
	return app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "quickpanel",
		Frameless: true,
	})
}
EOF
probe 0 "a window already accounted for (no-drag) passes" "$known"

unknown="$(mktemp -d)"
fixture "$unknown"
cat >"$unknown/fixturewindows.go" <<'EOF'
package main

func newFixtureWindow(app *application.App) *application.WebviewWindow {
	return app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "fixturewindow",
		Frameless: true,
	})
}
EOF
probe 1 "a new Frameless window absent from the disposition table fails" "$unknown"

rm -rf "$known" "$unknown"

if [ "$fails" -ne 0 ]; then
  echo "check-drag-regions-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "check-drag-regions-selftest: OK"
