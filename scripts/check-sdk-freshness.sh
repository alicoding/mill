#!/usr/bin/env bash
# Keeps the two committed, generated plugin-author artifacts honest
# (goal 0319): frontend/plugin-sdk/index.d.ts, the installable type
# package, and userdocs/reference/plugin-api/, its generated reference.
# Both derive from frontend/src/plugins/sdk.ts and are COMMITTED so a
# git install and a fresh clone need no build -- so both can go stale.
# Regenerate and diff, the same commit-and-verify shape docsgen's own
# TestUserDocs_MatchCommitted already uses. Run by lefthook
# (pre-commit) and CI's sdk-freshness job.
set -euo pipefail

cd "$(dirname "$0")/.."

npm --prefix frontend run sdk:build >/dev/null
npm --prefix frontend run docs:sdk >/dev/null

if ! git diff --exit-code -- frontend/plugin-sdk/index.d.ts userdocs/reference/plugin-api; then
  echo >&2
  echo "error: the plugin SDK types or their generated reference are stale." >&2
  echo "Run 'npm run sdk:build && npm run docs:sdk' in frontend/ and commit the result." >&2
  exit 1
fi
