#!/usr/bin/env bash
# Enforces goal 0387: the webhook door is named for the protocol, not
# for one agent tool. Two checks:
#
# 1. No stray "hook" identifier/string survives in the files this goal
#    renamed or introduced, outside the word "webhook" itself. Scoped
#    to those files deliberately, not the whole repo: "hook" is also
#    the converged, unrelated name for a React hook
#    (react-hooks/rules-of-hooks), a Go test's injectable observer
#    callback (dataevent.TestHook and its siblings across a dozen
#    packages), a native window lifecycle callback (Wails'
#    RegisterHook), and other pre-existing generic uses with nothing
#    to do with this door -- rewriting those is a different, unbounded
#    goal this one does not own. The one legitimate exception even
#    inside scope is the retired device-Kind value itself: loadDevices
#    migrates a persisted record literally spelled "hook" (goal 0387's
#    own backward-compat contract), so an exact quoted "hook" is
#    allowed -- everything else must read "webhook".
#
# 2. userdocs/how-to/webhooks.md never names a product, vendor, or
#    agent-coding-tool (the owner's "patterns, not named use cases"
#    ruling) -- narrower than semgrep/vendor-names.yml's own
#    userdocs rule (which deliberately excludes GitHub/Jira/Anthropic,
#    legitimate elsewhere as Configure-entity/connector values, e.g.
#    the Jira PAT example workflow and the Anthropic AI-provider
#    option) because THIS page has no such legitimate use for any of
#    them: it is deliberately not folded into that broader gate.
#
# Run by lefthook (pre-commit) and CI's webhook-naming job -- one
# script both call, same non-drift shape as check-loc.sh.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

violations=0

# --- Check 1: no stray "hook" outside "webhook" in the touched files ---

scope_dirs=(
  internal/services/bridgesvc
  internal/services/remoteauthsvc
)
scope_files=(
  internal/services/triggersvc/triggerwebhook.go
  internal/services/triggersvc/webhook_seed_test.go
  internal/domain/composition/builtinworkflows_webhook.go
  internal/domain/composition/builtinworkflows.go
  internal/domain/composition/triggers.go
  internal/domain/composition/seedproof_test.go
  internal/domain/composition/notifystep_test.go
  internal/services/wiring/wiring_webhookrespond.go
  internal/domain/audit/audit.go
  main.go
  frontend/src/shared/webhookTokensStore.ts
  frontend/src/shared/webhookCommands.ts
  frontend/src/shared/bindings.ts
  frontend/src/views/WebhooksSection.tsx
  frontend/src/views/SettingsConnectionsPane.tsx
  frontend/src/locales/en/views.json
)

targets=()
for d in "${scope_dirs[@]}"; do
  while IFS= read -r -d '' f; do
    targets+=("$f")
  done < <(find "$d" -type f \( -name '*.go' -o -name '*.ts' -o -name '*.tsx' \) -print0)
done
for f in "${scope_files[@]}"; do
  [[ -f "$f" ]] && targets+=("$f")
done

# Lines that legitimately keep the bare word "hook" even inside scope,
# each pre-existing and unrelated to the webhook door itself: goal
# 0387's own retired device-Kind migration value, and Wails' own
# native hook APIs/terminology (main.go's WindowClosing registration,
# the AssetServer Middleware hook) that this goal does not touch or
# rename.
allow_patterns=(
  '"hook"'
  'RegisterHook'
  'Assets.Middleware hook'
  'Hooks run BEFORE'
)

# "(^|[^b])hook" excludes "webhook" (preceded by 'b') but matches every
# other casing/position of "hook" -- case-insensitive since a comment
# or label may capitalize it.
for f in "${targets[@]}"; do
  hits="$(grep -niE '(^|[^b])hook' "$f" 2>/dev/null || true)"
  for pat in "${allow_patterns[@]}"; do
    hits="$(echo "$hits" | grep -vF "$pat" || true)"
  done
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do
      echo "webhook-naming: $f:$hit"
      violations=$((violations + 1))
    done <<< "$hits"
  fi
done

# --- Check 2: no vendor/agent-tool name in the new how-to page ---

webhooks_doc="userdocs/how-to/webhooks.md"
if [[ -f "$webhooks_doc" ]]; then
  hits="$(grep -niE 'claude|anthropic|copilot|cursor|codex|github|slack|jira' "$webhooks_doc" || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do
      echo "webhook-naming: $webhooks_doc: $hit"
      violations=$((violations + 1))
    done <<< "$hits"
  fi
else
  echo "webhook-naming: $webhooks_doc not found" >&2
  violations=$((violations + 1))
fi

if [[ $violations -gt 0 ]]; then
  echo "webhook-naming: $violations violation(s). The door is named for the protocol -- see goal 0387." >&2
  exit 1
fi
