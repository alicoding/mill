#!/usr/bin/env bash
# Commit gate wrapper around ls_lint (.ls-lint.yml, goal 0358 S10).
# Lefthook's summary renders a failed unconditional job as a bare
# boxing-glove line among green ticks with no FAIL wording, so the
# job's own output must state the block unmistakably -- on failure
# this script's last printed line is the COMMIT BLOCKED banner.
# ls_lint v2.3.1 already honors .gitignore for untracked paths and
# its -error-output-format json carries no extra path detail; the
# wrapper therefore blocks every non-zero exit and changes no
# allowlist semantics.
set -uo pipefail

output="$(ls_lint 2>&1)"
status=$?

if [ "$status" -ne 0 ]; then
  printf '%s\n' "$output" >&2
  offending="$(printf '%s\n' "$output" | sed -n 's/ failed for .*//p' | head -n 1)"
  printf 'COMMIT BLOCKED: root-file-naming — %s is not allowed at the repo root\n' "${offending:-see the ls_lint output above}" >&2
fi

exit "$status"
