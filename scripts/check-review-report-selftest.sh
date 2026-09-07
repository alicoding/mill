#!/usr/bin/env bash
# Probes check-review-report.sh (the pre-PR review CI gate, goal 0383)
# with fixture PR bodies piped on stdin, so an edit to the gate cannot
# silently stop rejecting what it must reject or start rejecting a
# well-formed review.
set -euo pipefail

gate="$(cd "$(dirname "$0")" && pwd)/check-review-report.sh"
fails=0

# probe <expected-exit> <label> <<'BODY' ... BODY
probe() {
  local want="$1" label="$2" got
  set +e
  bash "$gate" >/dev/null 2>&1
  got=$?
  set -e
  if [ "$got" != "$want" ]; then
    echo "FAIL: want exit $want, got $got: $label" >&2
    fails=$((fails + 1))
  fi
}

probe 0 "well-formed pass, one Important fixed pre-PR" <<'BODY'
## Summary
did the thing.

## Review
Important — internal/services/foosvc/foo.go:42
the old claim
Violates: Contract match
Fix: applied

Contract match: yes — matches the brief

Important findings open: 0
BODY

probe 0 "well-formed pass, nothing to report" <<'BODY'
## Review
Nothing to report.

Contract match: yes — clean diff

Important findings open: 0
BODY

probe 1 "missing the Review heading entirely" <<'BODY'
## Summary
no review section here.
BODY

probe 1 "missing the findings/nothing-to-report line" <<'BODY'
## Review
Contract match: yes — ok

Important findings open: 0
BODY

probe 1 "missing Contract match line" <<'BODY'
## Review
Nit — foo.go:1
minor thing
Violates: copy rules
Fix: reword

Important findings open: 0
BODY

probe 1 "Contract match: no is never accepted" <<'BODY'
## Review
Nothing to report.

Contract match: no — brief drift found

Important findings open: 0
BODY

probe 1 "missing the exact 'Important findings open: 0' line" <<'BODY'
## Review
Nothing to report.

Contract match: yes — clean diff
BODY

probe 1 "an open Important finding blocks (count not 0)" <<'BODY'
## Review
Important — foo.go:1
unresolved

Contract match: yes — matches otherwise

Important findings open: 1
BODY

if [ "$fails" -ne 0 ]; then
  echo "check-review-report-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "check-review-report-selftest: OK"
