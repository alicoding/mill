#!/usr/bin/env bash
# Asserts the ruleset/code-scanning config goal 0403 S0a's merge-queue
# migration depends on, against the repo named by `git remote get-url
# origin`. Each assertion protects against a real incident this
# session: a dropped code-scanning setup left every PR blocked at
# enqueue waiting for CodeQL; `strict_required_status_checks_policy`
# left on reintroduces the update-branch storm the merge queue exists
# to remove. Read-only via `gh api`; `gh` auth is assumed already
# configured. Called by the orchestrator's tick, not by any automatic
# hook. A missing `gh` prints SKIP and exits 0; any failed assertion
# prints a `FAIL:` line and the script exits non-zero.
set -uo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "SKIP: gh not installed -- cannot assert repo health"
  exit 0
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "SKIP: jq not installed -- cannot assert repo health"
  exit 0
fi

origin_url="$(git remote get-url origin 2>/dev/null || true)"
repo_slug="$(echo "${origin_url%.git}" | awk -F'[:/]' '{print $(NF-1)"/"$NF}')"
if [ -z "$repo_slug" ]; then
  echo "SKIP: could not resolve owner/repo from the origin remote"
  exit 0
fi

fails=0

rulesets_json="$(gh api "repos/$repo_slug/rulesets" 2>/dev/null)" || rulesets_json="[]"
merge_queue_found=0
strict_off_found=0
for id in $(echo "$rulesets_json" | jq -r '.[] | select(.target=="branch") | .id' 2>/dev/null); do
  detail="$(gh api "repos/$repo_slug/rulesets/$id" 2>/dev/null)" || continue
  if echo "$detail" | jq -e '.rules[] | select(.type=="merge_queue")' >/dev/null 2>&1; then
    merge_queue_found=1
  fi
  if echo "$detail" | jq -e '.rules[] | select(.type=="required_status_checks") | select(.parameters.strict_required_status_checks_policy==false)' >/dev/null 2>&1; then
    strict_off_found=1
  fi
done

if [ "$merge_queue_found" -eq 1 ]; then
  echo "OK: $repo_slug's main ruleset carries a merge_queue rule"
else
  echo "FAIL: no branch ruleset on $repo_slug carries a merge_queue rule"
  fails=$((fails + 1))
fi

scanning_state="$(gh api "repos/$repo_slug/code-scanning/default-setup" 2>/dev/null | jq -r '.state // "unknown"')"
if [ "$scanning_state" = "configured" ]; then
  echo "OK: $repo_slug's code-scanning/default-setup.state == configured"
else
  echo "FAIL: $repo_slug's code-scanning/default-setup.state == $scanning_state (every PR blocks at enqueue waiting for CodeQL)"
  fails=$((fails + 1))
fi

if [ "$strict_off_found" -eq 1 ]; then
  echo "OK: $repo_slug's required-checks rule has strict_required_status_checks_policy == false"
else
  echo "FAIL: no branch ruleset on $repo_slug has strict_required_status_checks_policy == false (an update-branch storm is live)"
  fails=$((fails + 1))
fi

if [ "$fails" -ne 0 ]; then
  exit 1
fi
exit 0
