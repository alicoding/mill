#!/usr/bin/env bash
# Advisory affected-only Go package selection for CI's test-go-affected job
# (goal 0401): maps the Go files changed since the diff base to the
# packages that contain them, then adds every package whose transitive
# import graph (go list -json's own Deps field, which is already the full
# transitive closure) reaches one of those packages -- a change to a leaf
# package can break any package that imports it, directly or indirectly.
# Uses only the go toolchain's own `go list -json` (no third-party
# workspace-graph tool, e.g. Turborepo/Nx): Mill is a single Go module with
# one flat package graph, not a monorepo of independently-versioned
# packages, so there is no larger graph to compute over.
#
# Writes a human-readable selection summary to GITHUB_STEP_SUMMARY (stdout
# when unset, e.g. local runs) and, unless nothing was selected, runs
# `go test -race` on the selected packages.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ] && [ -n "${GITHUB_BASE_REF:-}" ]; then
  git fetch --quiet origin "$GITHUB_BASE_REF" || true
  BASE="$(git merge-base "origin/$GITHUB_BASE_REF" HEAD)"
else
  # No PR base (a push to main, or a local/manual run): compare against
  # the immediate parent commit, falling back to HEAD itself for a
  # single-commit history (e.g. a fresh shallow clone with no parent).
  BASE="$(git rev-parse HEAD^ 2>/dev/null || git rev-parse HEAD)"
fi

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    cat >>"$GITHUB_STEP_SUMMARY"
  else
    cat
  fi
}

CHANGED_FILES="$(git diff --name-only "$BASE"...HEAD -- '*.go')"
if [ -z "$CHANGED_FILES" ]; then
  {
    echo "### test-go-affected"
    echo "Diff base \`$BASE\`: no changed Go files -- nothing selected."
  } | summary
  exit 0
fi

WORKSPACE="$(pwd)"
CHANGED_DIRS_JSON="$(printf '%s\n' "$CHANGED_FILES" | xargs -n1 dirname | sort -u |
  jq -R -s --arg ws "$WORKSPACE" 'split("\n") | map(select(length > 0)) | map($ws + "/" + .)')"

PKGS_JSON="$(mktemp)"
trap 'rm -f "$PKGS_JSON"' EXIT
go list -json ./... | jq -s '.' >"$PKGS_JSON"

AFFECTED_JSON="$(jq -c --argjson dirs "$CHANGED_DIRS_JSON" \
  '[.[] | select(.Dir as $d | $dirs | index($d) != null) | .ImportPath] | unique' "$PKGS_JSON")"

if [ "$(echo "$AFFECTED_JSON" | jq 'length')" -eq 0 ]; then
  {
    echo "### test-go-affected"
    echo "Diff base \`$BASE\`: changed Go files matched no package -- nothing selected."
  } | summary
  exit 0
fi

# A package is selected when it IS a directly-changed package, or when a
# directly-changed package appears anywhere in its own transitive Deps.
SELECTED_JSON="$(jq -c --argjson affected "$AFFECTED_JSON" '
  [.[]
    | select(
        (.ImportPath as $p | $affected | index($p) != null)
        or ((.Deps // []) as $deps | any($affected[]; . as $a | $deps | index($a) != null))
      )
    | .ImportPath
  ] | unique | sort
' "$PKGS_JSON")"

mapfile -t SELECTED < <(echo "$SELECTED_JSON" | jq -r '.[]')
AFFECTED_COUNT="$(echo "$AFFECTED_JSON" | jq 'length')"

{
  echo "### test-go-affected"
  echo "Diff base \`$BASE\`: $AFFECTED_COUNT package(s) directly changed, ${#SELECTED[@]} selected with dependents:"
  echo '```'
  printf '%s\n' "${SELECTED[@]}"
  echo '```'
} | summary

go test -race "${SELECTED[@]}"
