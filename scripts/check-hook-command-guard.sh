#!/usr/bin/env bash
# Probes hook-command-guard.sh (the PreToolUse Bash guard) with sample tool
# inputs and asserts each verdict, so a guard edit cannot silently stop
# denying what it must deny or start denying ordinary commands.
set -euo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/hook-command-guard.sh"
fails=0

# probe <expected-exit> <run_in_background: true|false|absent> <command>
probe() {
  local want="$1" bg="$2" cmd="$3" got input
  if [ "$bg" = "absent" ]; then
    input=$(jq -cn --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}')
  else
    input=$(jq -cn --arg c "$cmd" --argjson b "$bg" '{tool_name:"Bash",tool_input:{command:$c,run_in_background:$b}}')
  fi
  set +e
  echo "$input" | bash "$guard" >/dev/null 2>&1
  got=$?
  set -e
  if [ "$got" != "$want" ]; then
    echo "FAIL: want exit $want, got $got (bg=$bg): $cmd" >&2
    fails=$((fails + 1))
  fi
}

# Never-list: denied regardless of mode.
probe 2 absent "pkill -f mill-server"
probe 2 absent "killall node"
probe 2 absent "git push --force origin main"
probe 2 absent "git push origin main -f"
probe 2 absent "git filter-branch --all"
probe 0 absent "git push origin main"
probe 0 absent "kill 12345"

# Gate commands are foreground-only; the same command in the foreground passes.
probe 2 true  "git commit -m x"
probe 0 false "git commit -m x"
probe 0 absent "git commit -m x"
probe 2 true  "cd /x/frontend && npx playwright test e2e/foo.spec.ts"
probe 2 true  "go test -race ./..."
probe 2 true  "npm ci"
probe 2 true  "cd /x && vitest run"
probe 2 true  "task build"
probe 0 false "go test ./..."

# Ordinary long-running work may still be backgrounded.
probe 0 true "sleep 30; tail -20 /x/log"
probe 0 true "git log -1"
probe 0 true "gh pr checks 1 --watch"

if [ "$fails" -ne 0 ]; then
  echo "hook-command-guard: $fails probe(s) failed" >&2
  exit 1
fi
echo "hook-command-guard probes OK"
