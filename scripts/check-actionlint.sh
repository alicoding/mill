#!/usr/bin/env bash
# Mirrors ci.yml's own workflow-lint job's actionlint step (goal 0419
# S1c) -- semantic/expression-type/shellcheck checks
# check-workflow-yaml.sh's parse-only pass can't see. actionlint itself
# is a one-time `brew install actionlint` (never installed by this
# script or any hook -- CI runs the SHA-pinned Docker image instead, so
# local absence never blocks a commit, only loses local-fast signal).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! command -v actionlint >/dev/null 2>&1; then
  echo "check-actionlint: actionlint not installed locally (brew install actionlint) -- skipping; CI's workflow-lint job still runs the pinned Docker image." >&2
  exit 0
fi

exec actionlint
