#!/usr/bin/env bash
# Probes the NoticeAction inline-onClick ban in frontend/eslint.config.js
# (goal 0385, the third typed-action-family selector alongside
# menuActions/ContextMenuItem) against a real, transient fixture file --
# so an edit to the selector cannot silently stop catching an inline
# onClick smuggled onto a notice action. The fixture is a real file
# (ESLint's type-aware parser refuses a virtual/in-memory path outside
# the tsconfig project), written and removed within this one script run;
# `trap` guarantees cleanup even on an unexpected failure.
set -euo pipefail

frontend_dir="$(cd "$(dirname "$0")/../frontend" && pwd)"
fixture="$frontend_dir/src/__eslint_notice_action_fixture__.tsx"
fails=0

cleanup() { rm -f "$fixture"; }
trap cleanup EXIT

# probe <expect: fires|clean> <label> <content>
probe() {
  local want="$1" label="$2" content="$3" out rc
  printf '%s' "$content" >"$fixture"
  set +e
  out="$(cd "$frontend_dir" && npx eslint --format json "src/$(basename "$fixture")" 2>&1)"
  rc=$?
  set -e
  local hit
  hit="$(printf '%s' "$out" | grep -c '"ruleId": *"no-restricted-syntax"' || true)"
  if [ "$want" = "fires" ] && { [ "$rc" -eq 0 ] || [ "$hit" -eq 0 ]; }; then
    echo "FAIL: expected the rule to fire, got exit $rc, $hit match(es): $label" >&2
    echo "$out" >&2
    fails=$((fails + 1))
  elif [ "$want" = "clean" ] && { [ "$rc" -ne 0 ] || [ "$hit" -ne 0 ]; }; then
    echo "FAIL: expected no finding, got exit $rc, $hit match(es): $label" >&2
    echo "$out" >&2
    fails=$((fails + 1))
  fi
}

probe fires "an inline onClick on a notice action fires the ban" \
  "export const bad = {
  actions: [
    { id: 'x', label: 'y', onClick: () => {} },
  ],
}
"

probe clean "a commandId-only notice action passes" \
  "export const good = {
  actions: [
    { id: 'x', label: 'y', commandId: 'foo.bar' },
  ],
}
"

if [ "$fails" -ne 0 ]; then
  echo "check-notice-action-eslint-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "check-notice-action-eslint-selftest: OK"
