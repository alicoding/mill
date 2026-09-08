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
# `go test -race` on the selected packages. Bash-3.2-safe throughout
# (scripts/check-bash-portability.sh): CI's macos-latest runner's system
# /bin/bash predates bash 4's array-reading builtins.
set -euo pipefail
cd "$(dirname "$0")/.."

# HEAD_REF/DRY_RUN exist for scripts/check-affected-selftest.sh: HEAD_REF
# points the diff at a historical commit instead of the real working-tree
# HEAD, and DRY_RUN skips the final `go test -race` so the selftest can
# assert the selection summary without paying for a real test run.
HEAD_REF="${LIST_AFFECTED_HEAD_REF:-HEAD}"
DRY_RUN="${LIST_AFFECTED_DRY_RUN:-}"

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    cat >>"$GITHUB_STEP_SUMMARY"
  else
    cat
  fi
}

# resolve_base: echoes the diff base SHA and returns 0, or returns 1 with
# nothing echoed when this event's base can't be resolved. Each event this
# workflow triggers on (ci.yml's `on:`) is handled explicitly -- never a
# shared fallback that happens to work for one and silently mis-resolves
# another.
resolve_base() {
  case "${GITHUB_EVENT_NAME:-}" in
    pull_request)
      # github.base_ref is a pull_request-only field.
      if [ -n "${GITHUB_BASE_REF:-}" ]; then
        git fetch --quiet origin "$GITHUB_BASE_REF" || true
        if base="$(git merge-base "origin/$GITHUB_BASE_REF" "$HEAD_REF" 2>/dev/null)"; then
          echo "$base"
          return 0
        fi
      fi
      return 1
      ;;
    merge_group)
      # A queued merge run's base is the merge group's own base commit
      # (github.event.merge_group.base_sha, threaded in by ci.yml as
      # MERGE_GROUP_BASE_SHA) -- GITHUB_BASE_REF is empty for this event,
      # so falling through to the pull_request branch's condition would
      # silently miss it instead of resolving it. fetch-depth: 0 already
      # has the commit locally.
      if [ -n "${MERGE_GROUP_BASE_SHA:-}" ] && git cat-file -e "${MERGE_GROUP_BASE_SHA}^{commit}" 2>/dev/null; then
        echo "$MERGE_GROUP_BASE_SHA"
        return 0
      fi
      return 1
      ;;
    push | *)
      # A push to main, or a local/manual run with no event name at all:
      # compare against the immediate parent commit.
      if git rev-parse --verify -q "${HEAD_REF}^" >/dev/null 2>&1; then
        git rev-parse "${HEAD_REF}^"
        return 0
      fi
      return 1
      ;;
  esac
}

PKGS_JSON="$(mktemp)"
trap 'rm -f "$PKGS_JSON"' EXIT
load_pkgs() {
  if [ ! -s "$PKGS_JSON" ]; then
    go list -json ./... | jq -s '.' >"$PKGS_JSON"
  fi
}

run_selected() {
  if [ -n "$DRY_RUN" ]; then
    exit 0
  fi
  go test -race "${SELECTED[@]}"
}

# A base that can't be resolved (a shallow/single-commit history, a
# missing merge-group base) must never read as "nothing changed" -- that
# would silently skip real coverage. Fall back to selecting every package
# instead.
if ! BASE="$(resolve_base)"; then
  load_pkgs
  SELECTED_JSON="$(jq -c '[.[].ImportPath] | unique | sort' "$PKGS_JSON")"
  SELECTED=()
  while IFS= read -r pkg; do
    [ -n "$pkg" ] && SELECTED+=("$pkg")
  done < <(echo "$SELECTED_JSON" | jq -r '.[]')
  {
    echo "### test-go-affected"
    echo "Diff base could not be determined for event \`${GITHUB_EVENT_NAME:-<unset>}\` -- running the full ${#SELECTED[@]}-package set as a safe fallback."
  } | summary
  run_selected
  exit 0
fi

CHANGED_FILES="$(git diff --name-only "$BASE"..."$HEAD_REF" -- '*.go')"
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

load_pkgs

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

SELECTED=()
while IFS= read -r pkg; do
  [ -n "$pkg" ] && SELECTED+=("$pkg")
done < <(echo "$SELECTED_JSON" | jq -r '.[]')
AFFECTED_COUNT="$(echo "$AFFECTED_JSON" | jq 'length')"

{
  echo "### test-go-affected"
  echo "Diff base \`$BASE\`: $AFFECTED_COUNT package(s) directly changed, ${#SELECTED[@]} selected with dependents:"
  echo '```'
  printf '%s\n' "${SELECTED[@]}"
  echo '```'
} | summary

run_selected
