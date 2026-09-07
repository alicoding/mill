#!/usr/bin/env bash
# Enforces goal 0383's pre-PR review gate as a mechanical check, not an
# honor system: a PR body must carry a "## Review" section with the
# reviewer's fixed report shape, a "Contract match: yes" line, and the
# exact line "Important findings open: 0" (every Important finding was
# fixed before the PR opened) -- CI rejects the PR otherwise. This is a
# presence/format check only; it cannot re-verify the review's own
# accuracy, only that the assertion was made in the required shape.
set -euo pipefail

usage() {
  echo "usage: $0 [pr-number]   (reads the PR body from stdin if omitted)" >&2
  exit 2
}

[[ $# -le 1 ]] || usage

if [[ $# -eq 1 ]]; then
  body="$(gh pr view "$1" --json body --jq '.body')"
else
  body="$(cat)"
fi

fail() {
  echo "review-report: $1"
  exit 1
}

grep -qE '^## Review[[:space:]]*$' <<<"$body" \
  || fail "PR body has no '## Review' section heading"

# Everything between the "## Review" heading and the next "## " heading
# (or end of body) is the section this gate reads.
section="$(awk '/^## Review[[:space:]]*$/{f=1;next} f && /^## /{f=0} f' <<<"$body")"

grep -qE '^(Important|Nit|Pre-existing) — ' <<<"$section" \
  || grep -qiE 'nothing to report' <<<"$section" \
  || fail "Review section has no severity-tagged finding and no 'nothing to report' line"

grep -qE '^Contract match: yes' <<<"$section" \
  || fail "Review section is missing the 'Contract match: yes' line"

grep -qxF 'Important findings open: 0' <<<"$section" \
  || fail "Review section is missing the exact line 'Important findings open: 0'"

echo "review-report: ok"
