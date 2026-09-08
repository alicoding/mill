#!/usr/bin/env bash
# Probes check-drag-regions.sh's frameless-window cross-check (goal
# 0385) against throwaway git repos, so a new Frameless: true window
# can't ship without an explicit drag disposition going unnoticed again
# (the 0377-shaped gap this check exists to close).
set -euo pipefail

# A git-commit-invoked pre-commit hook (unlike a bare `lefthook run`)
# runs with GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE set to the repo being
# committed; those env vars override `-C <fixturedir>` for every git
# subcommand below, redirecting `init`/`add` at the REAL repo's worktree
# instead of the fixture. Clearing them scopes every git call here to
# its own `-C` target regardless of the calling context.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CEILING_DIRECTORIES 2>/dev/null || true

gate="$(cd "$(dirname "$0")" && pwd)/check-drag-regions.sh"
fails=0

fixture() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
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
