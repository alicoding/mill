#!/usr/bin/env bash
# Proves immediate issue mutations use create-an-issue's returned identity.
set -euo pipefail

root_dir="$(git rev-parse --show-toplevel)"
workflow="$root_dir/.github/workflows/engineering-health.yml"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

python3 - "$workflow" "$tmp_dir" <<'PY'
import pathlib
import sys

import yaml

workflow_path = pathlib.Path(sys.argv[1])
output_dir = pathlib.Path(sys.argv[2])
with workflow_path.open(encoding="utf-8") as workflow_file:
    workflow = yaml.safe_load(workflow_file)

contracts = (
    (
        "breach-issues",
        "create_breach_issue",
        "Apply this breach's labels and reopen if recovery-closed it",
        "breach-consumer.sh",
    ),
    (
        "health-issue",
        "create_health_issue",
        "Append the JSON as a collapsed comment",
        "health-consumer.sh",
    ),
)

for job_name, create_id, consumer_name, output_name in contracts:
    steps = workflow["jobs"][job_name]["steps"]
    create_step = next(step for step in steps if step.get("id") == create_id)
    expected_action = (
        "JasonEtco/create-an-issue@"
        "1b14a70e4d8dc185e5cc76d3bec9eab20257b2c5"
    )
    if create_step.get("uses") != expected_action:
        raise SystemExit(f"{job_name}: {create_id} is not the pinned issue action")

    consumer = next(step for step in steps if step.get("name") == consumer_name)
    expected_output = "${{ steps." + create_id + ".outputs.number }}"
    if consumer.get("env", {}).get("ISSUE_NUMBER") != expected_output:
        raise SystemExit(
            f"{job_name}: {consumer_name} must receive {expected_output}"
        )
    (output_dir / output_name).write_text(consumer["run"], encoding="utf-8")
PY

mkdir -p "$tmp_dir/bin"
cat >"$tmp_dir/bin/gh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
command_group="${1:-} ${2:-}"
{
  printf '%s' "$1"
  shift
  printf ' %s' "$@"
  printf '\n'
} >>"$GH_CALLS"

if [ "$command_group" = "issue list" ]; then
  exit 0
fi
if [ "$command_group" = "issue view" ]; then
  printf '%s\n' "${GH_ISSUE_STATE:-OPEN}"
fi
SH
chmod +x "$tmp_dir/bin/gh"

make_breach_fixture() {
  local dir="$1"
  mkdir -p "$dir/breaches"
  cat >"$dir/breaches/files-near-loc-cap.md" <<'EOF'
---
title: Files near the LOC cap
labels:
  - platform-health
  - files-near-loc-cap
  - escalate
---
Budget details.
EOF
}

run_consumer() {
  local script="$1" dir="$2" number="$3" state="${4:-OPEN}"
  (
    cd "$dir"
    PATH="$tmp_dir/bin:$PATH" \
      GH_CALLS="$dir/gh-calls" \
      GH_ISSUE_STATE="$state" \
      ISSUE_NUMBER="$number" \
      REPO="millhq/mill" \
      MATRIX_FILE="files-near-loc-cap.md" \
      bash "$script"
  )
}

breach_dir="$tmp_dir/breach-good"
make_breach_fixture "$breach_dir"
run_consumer "$tmp_dir/breach-consumer.sh" "$breach_dir" "894" "CLOSED"
cat >"$tmp_dir/expected-breach-calls" <<'EOF'
issue edit 894 --repo millhq/mill --add-label platform-health,files-near-loc-cap,escalate
issue view 894 --repo millhq/mill --json state --jq .state
issue reopen 894 --repo millhq/mill
EOF
diff -u "$tmp_dir/expected-breach-calls" "$breach_dir/gh-calls"

health_dir="$tmp_dir/health-good"
mkdir -p "$health_dir"
printf '%s\n' '{"status":"warning"}' >"$health_dir/engineering-health.json"
run_consumer "$tmp_dir/health-consumer.sh" "$health_dir" "895"
cat >"$tmp_dir/expected-health-calls" <<'EOF'
issue comment 895 --repo millhq/mill --body-file json-comment.md
EOF
diff -u "$tmp_dir/expected-health-calls" "$health_dir/gh-calls"
cat >"$tmp_dir/expected-comment" <<'EOF'
<details><summary>engineering-health.json</summary>

```json
{"status":"warning"}
```
</details>
EOF
diff -u "$tmp_dir/expected-comment" "$health_dir/json-comment.md"

assert_rejected_before_gh() {
  local script="$1" kind="$2" number="$3" case_name="$4"
  local dir="$tmp_dir/$case_name"
  mkdir -p "$dir"
  if [ "$kind" = "breach" ]; then
    make_breach_fixture "$dir"
  else
    printf '%s\n' '{}' >"$dir/engineering-health.json"
  fi

  if run_consumer "$script" "$dir" "$number" >"$dir/stdout" 2>"$dir/stderr"; then
    echo "FAIL: $case_name accepted invalid issue number '$number'" >&2
    exit 1
  fi
  if [ -s "$dir/gh-calls" ]; then
    echo "FAIL: $case_name called gh before rejecting issue number '$number'" >&2
    exit 1
  fi
  if [[ "$(cat "$dir/stderr")" != *"returned invalid"* ]]; then
    echo "FAIL: $case_name did not explain the invalid issue number" >&2
    exit 1
  fi
}

assert_rejected_before_gh "$tmp_dir/breach-consumer.sh" breach "" "breach-empty"
assert_rejected_before_gh "$tmp_dir/breach-consumer.sh" breach "0" "breach-zero"
assert_rejected_before_gh "$tmp_dir/breach-consumer.sh" breach "12x" "breach-invalid"
assert_rejected_before_gh "$tmp_dir/health-consumer.sh" health "" "health-empty"
assert_rejected_before_gh "$tmp_dir/health-consumer.sh" health "-1" "health-negative"
assert_rejected_before_gh "$tmp_dir/health-consumer.sh" health "null" "health-invalid"

echo "check-engineering-health-issue-results: OK"
