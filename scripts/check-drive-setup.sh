#!/usr/bin/env bash
# Fast (<10s) local-only preflight for driving the installed app (goal
# 0381, .claude/skills/drive-installed-app/SKILL.md): every check here
# is exactly what an earlier verification pass (docs/goals/
# 0381-drive-the-installed-app.md's Today section) burned ~25 minutes
# discovering by trial and error. Prints every failing line with its
# fix, never a bare failure; exits 0 only when everything passes.
set -uo pipefail

identity_name="Mill Dev Signing"
login_keychain="$HOME/Library/Keychains/login.keychain-db"
app_path="/Applications/Mill.app"
mcp_port="${MILL_SMOKE_MCP_PORT:-9099}"

fail=0
note() { echo "FAIL  $1"; fail=1; }
pass() { echo "PASS  $1"; }

# (a) The stable dev signing identity is present AND trusted for code
# signing -- `find-identity -v` still LISTS an imported-but-untrusted
# certificate (confirmed live), annotated e.g. "(CSSMERR_TP_NOT_TRUSTED)"
# or "(Invalid Key Usage for policy)", so a bare name grep alone would
# false-positive here; only an UNANNOTATED line is genuinely trusted.
identity_line="$(security find-identity -v -p codesigning "$login_keychain" 2>/dev/null | grep "\"$identity_name\"" || true)"
if echo "$identity_line" | grep -qE '^\s*[0-9]+\) [0-9A-F]+ "'"$identity_name"'"\s*$'; then
  pass "signing identity \"$identity_name\" present and trusted"
else
  note "signing identity \"$identity_name\" not found or not trusted -- run scripts/setup-dev-signing.sh"
fi

# (b) The installed app is actually signed BY that identity, not still
# ad-hoc (`task install:app` falls back to ad-hoc silently when the
# identity isn't set up yet -- this is what would keep dropping the
# Accessibility grant on every reinstall).
if [ ! -d "$app_path" ]; then
  note "$app_path not found -- run \`task install:app\` first"
else
  # -dvvv, not -dv: plain -dv omits the Authority line entirely for a
  # self-signed identity with no CA chain (confirmed live) -- only the
  # verbose form prints it. An ad-hoc signature has no Authority line
  # at all (it prints "Signature=adhoc" instead), so an empty $signer
  # below covers both "ad-hoc" and "unsigned."
  signer="$(codesign -dvvv "$app_path" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
  if [ "$signer" = "$identity_name" ]; then
    pass "$app_path is signed by \"$identity_name\""
  else
    note "$app_path is signed by \"${signer:-<ad-hoc/unsigned>}\", not \"$identity_name\" -- reinstall with \`task install:app\` after scripts/setup-dev-signing.sh has run"
  fi
fi

# (c) Accessibility for the terminal host running this script -- a
# no-op keystroke is the cheapest real probe (System Events refuses it
# outright without the grant); confirmed this is a DIFFERENT grant from
# (a)/(b) (the goal's own Today section: this Mac's terminal already
# had it while Mill's OWN grant was still the real blocker).
if osascript -e 'tell application "System Events" to keystroke ""' >/dev/null 2>&1; then
  pass "Accessibility granted to the terminal host (System Events keystroke probe)"
else
  note "Accessibility NOT granted to the terminal host -- grant it in System Settings > Privacy & Security > Accessibility for the app running this shell"
fi

# (d) cliclick (drags/clicks the native layer, .claude/skills/
# drive-installed-app/SKILL.md) and screencapture (evidence) on PATH.
if command -v cliclick >/dev/null 2>&1; then
  pass "cliclick on PATH"
else
  note "cliclick not on PATH -- install it: brew install cliclick"
fi
if command -v screencapture >/dev/null 2>&1; then
  pass "screencapture on PATH"
else
  note "screencapture not on PATH (unexpected on macOS)"
fi

# (e) At most one Mill process -- two data-sharing instances risk
# settings.json/execution.db corruption (project memory: "never run two
# data-sharing instances").
mill_pids="$(pgrep -x mill 2>/dev/null || true)"
# grep -c . counts non-empty lines, so an empty $mill_pids already
# yields 0 here with no separate empty-string guard needed.
mill_count="$(echo "$mill_pids" | grep -c . 2>/dev/null || true)"
if [ "$mill_count" -le 1 ]; then
  pass "$mill_count Mill process(es) running"
else
  note "$mill_count Mill processes running (pids: $(echo "$mill_pids" | tr '\n' ' ')) -- quit the extras before driving; two instances sharing data risks corruption"
fi

# (f) Best-effort, never fails the gate: if something is answering the
# bridge port, confirm it is genuinely Mill's MCP bridge (a `ping` --
# app_info -- round-trip), so a stale unrelated listener on the same
# port is reported rather than silently assumed to be Mill.
if command -v curl >/dev/null 2>&1; then
  body="$(curl -sS -m 2 -X POST "http://127.0.0.1:$mcp_port/mcp" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"app_info","arguments":{}}}' 2>/dev/null || true)"
  if echo "$body" | grep -q '"os"'; then
    echo "INFO  Mill's bridge answered ping on port $mcp_port"
  else
    echo "INFO  no bridge answering on port $mcp_port yet -- expected before launch, or when driving a build without EXTRA_TAGS=mcp"
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "check-drive-setup: all checks passed"
  exit 0
fi
exit 1
