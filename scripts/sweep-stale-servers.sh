#!/usr/bin/env bash
# Sweeps mill-server processes that outlived the session that launched
# them (goal 0293): a dev server backgrounded by the run-mill skill, or
# an e2e worker's server orphaned by a killed Playwright run. Both were
# found days old, the dev one sharing the desktop app's data files.
#
# Rules:
#   - launchd-managed jobs are never touched -- every PID launchctl lists
#     is excluded (the Tailscale LaunchAgent server, the installed app).
#   - kills by exact PID only, never by pattern (hook-command-guard.sh's
#     pkill -f / killall rule exists because a broad kill once took down
#     the LaunchAgent server).
#   - a process is stale only past a TTL: dev servers 4h, e2e servers
#     1h (MILL_DEV_SERVER_TTL / MILL_E2E_SERVER_TTL, seconds).
#
# Runs from the SessionStart hook (.claude/settings.json) and the e2e
# global setup; `--dry-run` reports without killing. Always exits 0.
set -uo pipefail

TTL_DEV=${MILL_DEV_SERVER_TTL:-14400}
TTL_E2E=${MILL_E2E_SERVER_TTL:-3600}
dry=0
[ "${1:-}" = "--dry-run" ] && dry=1

# ps etime is [[dd-]hh:]mm:ss on both BSD and GNU ps.
etime_to_seconds() {
  local s=$1 d=0 h=0 m=0 sec=0 a b c
  if [[ $s == *-* ]]; then d=${s%%-*}; s=${s#*-}; fi
  IFS=: read -r a b c <<<"$s"
  if [ -n "${c:-}" ]; then h=$a; m=$b; sec=$c; else m=$a; sec=$b; fi
  echo $(( 10#$d * 86400 + 10#$h * 3600 + 10#$m * 60 + 10#$sec ))
}

managed=""
if command -v launchctl >/dev/null 2>&1; then
  managed=$(launchctl list 2>/dev/null | awk '$1 ~ /^[0-9]+$/ {print $1}' | tr '\n' ' ')
fi

while read -r pid etime cmd; do
  [ -z "${pid:-}" ] && continue
  case " $managed " in *" $pid "*) continue ;; esac
  age=$(etime_to_seconds "$etime")
  ttl=$TTL_DEV
  case "$cmd" in *e2e/.build/mill-server) ttl=$TTL_E2E ;; esac
  [ "$age" -lt "$ttl" ] && continue
  if [ $dry -eq 1 ]; then
    echo "stale mill-server (would kill): pid=$pid age=$etime $cmd"
  else
    kill "$pid" 2>/dev/null && echo "swept stale mill-server: pid=$pid age=$etime $cmd"
  fi
done < <(ps -axo pid=,etime=,command= | awk '$3 ~ /mill-server$/ {print $1, $2, $3}')
exit 0
