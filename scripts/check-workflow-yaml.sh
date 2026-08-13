#!/usr/bin/env bash
# Every .github/workflows/*.yml must parse as YAML. GitHub only parses a
# workflow when its trigger fires, so a syntax error in a rarely-fired
# workflow (release.yml runs only on tags) can merge through green CI
# and fail at the worst moment -- exactly what happened to v0.2.0's
# first run: a run:| block's unindented continuation line terminated
# the literal scalar. Parse-only here (no new local tooling; python3 +
# PyYAML ship with macOS dev setups and ubuntu runners); CI's
# workflow-lint job additionally runs actionlint for semantic checks.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
for f in .github/workflows/*.yml; do
  if ! python3 -c "import yaml, sys; yaml.safe_load(open(sys.argv[1]))" "$f" 2>/tmp/workflow-yaml-err; then
    echo "INVALID YAML: $f"
    cat /tmp/workflow-yaml-err
    fail=1
  fi
done
exit $fail
