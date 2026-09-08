#!/usr/bin/env bash
# Probes semgrep/vendor-names.yml (goal 0385) against throwaway fixture
# trees, so an edit to the rule cannot silently stop catching a vendor
# name in a platform surface, or start flagging a legitimate
# Configure-entity/format-flavor value. Each fixture is scanned from
# ITS OWN tree root (never a subdirectory) -- the rule's path filters
# match against the relative path semgrep computes from the scan root,
# so a fixture must keep the full internal/domain/composition/... (etc)
# prefix relative to what gets passed to semgrep.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
config="$repo_root/semgrep/vendor-names.yml"
fails=0

# probe <expected: block|clean> <label> <root>
probe() {
  local want="$1" label="$2" root="$3" out rc
  set +e
  out="$(cd "$root" && semgrep --config "$config" --error --quiet . 2>&1)"
  rc=$?
  set -e
  if [ "$want" = "block" ] && [ "$rc" -eq 0 ]; then
    echo "FAIL: expected a blocking finding, got none: $label" >&2
    echo "$out" >&2
    fails=$((fails + 1))
  elif [ "$want" = "clean" ] && [ "$rc" -ne 0 ]; then
    echo "FAIL: expected zero findings, got a blocking finding: $label" >&2
    echo "$out" >&2
    fails=$((fails + 1))
  fi
}

trigger_bad="$(mktemp -d)"
mkdir -p "$trigger_bad/internal/domain/composition"
cat >"$trigger_bad/internal/domain/composition/fixturetrigger.go" <<'EOF'
package composition

func fixtureTrigger() string {
	return "trigger-slack-event"
}
EOF
probe block "a trigger id naming Slack as a platform concept" "$trigger_bad"

trigger_good="$(mktemp -d)"
mkdir -p "$trigger_good/internal/domain/composition"
cat >"$trigger_good/internal/domain/composition/fixturetrigger.go" <<'EOF'
package composition

func fixtureTrigger() string {
	return "trigger-webhook"
}
EOF
probe clean "a generic trigger id passes" "$trigger_good"

aiprovider_good="$(mktemp -d)"
mkdir -p "$aiprovider_good/internal/domain/aiprovider"
cat >"$aiprovider_good/internal/domain/aiprovider/fixture.go" <<'EOF'
package aiprovider

const KindAnthropic = "anthropic"
EOF
probe clean "an AI-provider Kind value outside the scanned scope passes" "$aiprovider_good"

view_bad="$(mktemp -d)"
mkdir -p "$view_bad/frontend/src/views"
cat >"$view_bad/frontend/src/views/FixtureView.tsx" <<'EOF'
export const label = "Notify via Slack"
EOF
probe block "frontend view copy naming Slack" "$view_bad"

view_good="$(mktemp -d)"
mkdir -p "$view_good/frontend/src/views"
cat >"$view_good/frontend/src/views/FixtureView.tsx" <<'EOF'
export const label = "Notify when a webhook fires"
EOF
probe clean "generic view copy passes" "$view_good"

locale_bad="$(mktemp -d)"
mkdir -p "$locale_bad/frontend/src/locales/en"
cat >"$locale_bad/frontend/src/locales/en/fixture.json" <<'EOF'
{ "fixtureLabel": "Works like Notion" }
EOF
probe block "locale copy naming Notion" "$locale_bad"

userdocs_bad="$(mktemp -d)"
mkdir -p "$userdocs_bad/userdocs"
cat >"$userdocs_bad/userdocs/fixture.md" <<'EOF'
For example, a Claude Code hook posts here.
EOF
probe block "userdocs naming Claude Code by product name" "$userdocs_bad"

userdocs_good="$(mktemp -d)"
mkdir -p "$userdocs_good/userdocs"
cat >"$userdocs_good/userdocs/fixture.md" <<'EOF'
For example, a coding agent's own Stop hook posts here.
EOF
probe clean "userdocs describing a category, not a product, passes" "$userdocs_good"

rm -rf "$trigger_bad" "$trigger_good" "$aiprovider_good" "$view_bad" "$view_good" "$locale_bad" "$userdocs_bad" "$userdocs_good"

if [ "$fails" -ne 0 ]; then
  echo "check-vendor-names-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "check-vendor-names-selftest: OK"
