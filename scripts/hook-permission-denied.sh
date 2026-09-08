#!/usr/bin/env bash
# PermissionDenied hook: auto mode's classifier reports a denial to the
# model as the bare string "Blocked by classifier", so the exact command
# is only visible in /permissions -> Recently denied. This hook appends
# one JSON line per denial (tool, input, reason) to a local log so
# denials are reviewable after the fact and can be turned into
# autoMode.environment entries or narrow allow rules. Never blocks or
# retries anything; always exits 0.
set -uo pipefail
log="${MILL_PERMISSION_DENIED_LOG:-$HOME/Library/Logs/mill-permission-denials.log}"
mkdir -p "$(dirname "$log")" 2>/dev/null || exit 0
input=$(cat)
printf '%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$input" >> "$log" 2>/dev/null
exit 0
