#!/usr/bin/env bash
# Exercises cache trimming and LaunchAgent setup against disposable tool
# stubs. No check resolves the user's real cache or LaunchAgent paths.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

trim="./scripts/dev/gocache-trim.sh"
setup="./scripts/dev/gocache-trim-setup.sh"
fails=0
scratch_root="$(mktemp -d "${TMPDIR:-/tmp}/mill-gocache-trim-selftest.XXXXXX")" || exit 1
fake_pid=""

cleanup() {
  if [ -n "$fake_pid" ]; then
    kill "$fake_pid" 2>/dev/null || true
    wait "$fake_pid" 2>/dev/null || true
  fi
  rm -rf "$scratch_root"
}
trap cleanup EXIT

pass() {
  echo "PASS: $1"
}

fail() {
  echo "FAIL: $1" >&2
  fails=$((fails + 1))
}

spawn_fake() {
  exec -a "$1" sleep 20 &
  fake_pid=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -f "$1" >/dev/null 2>&1 && break
    sleep 0.2
  done
}

kill_fake() {
  [ -n "$fake_pid" ] && kill "$fake_pid" 2>/dev/null || true
  wait "$fake_pid" 2>/dev/null || true
  fake_pid=""
}

make_tool_stubs() {
  tool_dir="$1"
  mkdir -p "$tool_dir"
  cat >"$tool_dir/go" <<'GO_STUB'
#!/usr/bin/env bash
case "${1:-}" in
  env)
    case "${MILL_TEST_GO_ENV_MODE:-ok}" in
      fail) exit "${MILL_TEST_GO_ENV_EXIT:-17}" ;;
      empty) exit 0 ;;
      ok) printf '%s\n' "${MILL_TEST_GOCACHE_DIR:?}" ;;
      *) exit 64 ;;
    esac
    ;;
  install)
    status="${MILL_TEST_GO_INSTALL_EXIT:-0}"
    [ "$status" -eq 0 ] || exit "$status"
    mkdir -p "$GOBIN"
    cat >"$GOBIN/hardcache" <<'HARDCACHE_STUB'
#!/usr/bin/env bash
if [ -n "${MILL_TEST_HARDCACHE_ARGS:-}" ]; then
  printf '%s\n' "$@" >"$MILL_TEST_HARDCACHE_ARGS"
fi
exit "${MILL_TEST_HARDCACHE_EXIT:-0}"
HARDCACHE_STUB
    chmod +x "$GOBIN/hardcache"
    ;;
  *) exit 64 ;;
esac
GO_STUB
  chmod +x "$tool_dir/go"

  cat >"$tool_dir/hardcache" <<'HARDCACHE_STUB'
#!/usr/bin/env bash
if [ -n "${MILL_TEST_HARDCACHE_ARGS:-}" ]; then
  printf '%s\n' "$@" >"$MILL_TEST_HARDCACHE_ARGS"
fi
exit "${MILL_TEST_HARDCACHE_EXIT:-0}"
HARDCACHE_STUB
  chmod +x "$tool_dir/hardcache"

  cat >"$tool_dir/launchctl" <<'LAUNCHCTL_STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$MILL_TEST_LAUNCHCTL_LOG"
if [ "${1:-}" = "load" ]; then
  exit "${MILL_TEST_LAUNCHCTL_LOAD_EXIT:-0}"
fi
exit 0
LAUNCHCTL_STUB
  chmod +x "$tool_dir/launchctl"
}

# Busy-build checks stay ahead of tool discovery. This must skip even
# when both Go and hardcache are absent.
spawn_fake "go build"
busy_out="$scratch_root/busy.out"
if PATH="/usr/bin:/bin" \
   MILL_GOCACHE_GOBIN="$scratch_root/no-gobin" \
   MILL_GOCACHE_GO="$scratch_root/no-go" \
   MILL_GOCACHE_GUARD_NAMED_PROCS="" \
   bash "$trim" >"$busy_out" 2>&1 &&
   grep -q "skipping -- a go build/test/vet/generate/install/run is running" "$busy_out"; then
  pass "busy go build guard runs before Go and hardcache discovery"
else
  fail "busy go build guard did not skip: $(cat "$busy_out")"
fi
kill_fake

regex="$(MILL_GOCACHE_PRINT_REGEX=1 bash "$trim")"
for cmdline in "go build ./..." "go test ./..."; do
  if printf '%s' "$cmdline" | grep -qE "$regex"; then
    pass "go-subcommand regex matches '$cmdline'"
  else
    fail "go-subcommand regex does not match '$cmdline'"
  fi
done
for cmdline in "gopls" "go env GOCACHE" "go version"; do
  if printf '%s' "$cmdline" | grep -qE "$regex"; then
    fail "go-subcommand regex incorrectly matches '$cmdline'"
  else
    pass "go-subcommand regex excludes '$cmdline'"
  fi
done

# The documented no-hardcache path remains an informative successful
# no-op, including when Go is absent from the restricted environment.
no_tools_out="$scratch_root/no-tools.out"
if PATH="/usr/bin:/bin" \
   MILL_GOCACHE_GOBIN="$scratch_root/no-gobin" \
   MILL_GOCACHE_GO="$scratch_root/no-go" \
   MILL_GOCACHE_GUARD_NAMED_PROCS="" \
   MILL_GOCACHE_GUARD_GO_REGEX="" \
   bash "$trim" >"$no_tools_out" 2>&1 &&
   grep -q "hardcache not installed" "$no_tools_out"; then
  pass "missing hardcache remains an informative no-op when Go is also absent"
else
  fail "missing hardcache path failed or lost its message: $(cat "$no_tools_out")"
fi

tool_dir="$scratch_root/nondefault go & tools"
make_tool_stubs "$tool_dir"
cache_dir="$scratch_root/controlled cache"
mkdir -p "$cache_dir"
trim_log="$scratch_root/trim.log"
hardcache_args="$scratch_root/hardcache.args"

# With hardcache available, Go discovery and `go env GOCACHE` are
# required and every failure exits before trim or success logging.
missing_go_out="$scratch_root/missing-go.out"
if PATH="$tool_dir:/usr/bin:/bin" \
   MILL_GOCACHE_GO="$scratch_root/missing-go" \
   MILL_GOCACHE_GOBIN="$scratch_root/no-gobin" \
   MILL_GOCACHE_LOG_FILE="$trim_log" \
   MILL_GOCACHE_GUARD_NAMED_PROCS="" \
   MILL_GOCACHE_GUARD_GO_REGEX="" \
   bash "$trim" >"$missing_go_out" 2>&1; then
  fail "trim succeeded with a missing Go executable"
elif grep -q "go executable not found or not executable" "$missing_go_out" &&
     [ ! -e "$trim_log" ]; then
  pass "trim fails clearly when Go is unavailable"
else
  fail "missing-Go failure was unclear or wrote a success log: $(cat "$missing_go_out")"
fi

go_fail_out="$scratch_root/go-fail.out"
rm -f "$hardcache_args" "$trim_log"
if PATH="$tool_dir:/usr/bin:/bin" \
   MILL_GOCACHE_GO="$tool_dir/go" \
   MILL_TEST_GO_ENV_MODE="fail" \
   MILL_TEST_GO_ENV_EXIT="18" \
   MILL_TEST_HARDCACHE_ARGS="$hardcache_args" \
   MILL_GOCACHE_LOG_FILE="$trim_log" \
   MILL_GOCACHE_GUARD_NAMED_PROCS="" \
   MILL_GOCACHE_GUARD_GO_REGEX="" \
   bash "$trim" >"$go_fail_out" 2>&1; then
  fail "trim succeeded after go env GOCACHE failed"
elif grep -q "go env GOCACHE failed" "$go_fail_out" &&
     [ ! -e "$hardcache_args" ] && [ ! -e "$trim_log" ]; then
  pass "go env failure stops before hardcache and success logging"
else
  fail "go env failure continued or reported unclearly: $(cat "$go_fail_out")"
fi

go_empty_out="$scratch_root/go-empty.out"
rm -f "$hardcache_args" "$trim_log"
if PATH="$tool_dir:/usr/bin:/bin" \
   MILL_GOCACHE_GO="$tool_dir/go" \
   MILL_TEST_GO_ENV_MODE="empty" \
   MILL_TEST_HARDCACHE_ARGS="$hardcache_args" \
   MILL_GOCACHE_LOG_FILE="$trim_log" \
   MILL_GOCACHE_GUARD_NAMED_PROCS="" \
   MILL_GOCACHE_GUARD_GO_REGEX="" \
   bash "$trim" >"$go_empty_out" 2>&1; then
  fail "trim succeeded with an empty GOCACHE"
elif grep -q "returned an empty path" "$go_empty_out" &&
     [ ! -e "$hardcache_args" ] && [ ! -e "$trim_log" ]; then
  pass "empty GOCACHE stops before hardcache and success logging"
else
  fail "empty GOCACHE continued or reported unclearly: $(cat "$go_empty_out")"
fi

hardcache_fail_out="$scratch_root/hardcache-fail.out"
rm -f "$hardcache_args" "$trim_log"
if PATH="$tool_dir:/usr/bin:/bin" \
   MILL_GOCACHE_GO="$tool_dir/go" \
   MILL_TEST_GO_ENV_MODE="ok" \
   MILL_TEST_GOCACHE_DIR="$cache_dir" \
   MILL_TEST_HARDCACHE_EXIT="23" \
   MILL_TEST_HARDCACHE_ARGS="$hardcache_args" \
   MILL_GOCACHE_LOG_FILE="$trim_log" \
   MILL_GOCACHE_GUARD_NAMED_PROCS="" \
   MILL_GOCACHE_GUARD_GO_REGEX="" \
   bash "$trim" >"$hardcache_fail_out" 2>&1; then
  fail "trim succeeded after hardcache failed"
else
  status=$?
  if [ "$status" -eq 23 ] && grep -q "hardcache failed with exit 23" "$hardcache_fail_out" &&
     [ ! -e "$trim_log" ]; then
    pass "hardcache failure preserves its status and writes no success record"
  else
    fail "hardcache failure status/log handling was wrong: status=$status output=$(cat "$hardcache_fail_out")"
  fi
fi

success_out="$scratch_root/success.out"
rm -f "$hardcache_args" "$trim_log"
if PATH="$tool_dir:/usr/bin:/bin" \
   MILL_GOCACHE_GO="$tool_dir/go" \
   MILL_TEST_GO_ENV_MODE="ok" \
   MILL_TEST_GOCACHE_DIR="$cache_dir" \
   MILL_TEST_HARDCACHE_EXIT="0" \
   MILL_TEST_HARDCACHE_ARGS="$hardcache_args" \
   MILL_GOCACHE_LOG_FILE="$trim_log" \
   MILL_GOCACHE_GUARD_NAMED_PROCS="" \
   MILL_GOCACHE_GUARD_GO_REGEX="" \
   bash "$trim" >"$success_out" 2>&1 &&
   grep -Fxq "local" "$hardcache_args" &&
   grep -Fxq "trim" "$hardcache_args" &&
   grep -Fxq -- "--unused-for=24h" "$hardcache_args" &&
   grep -Fxq -- "--max-size=8GB" "$hardcache_args" &&
   grep -Fxq -- "--dir=$cache_dir" "$hardcache_args" &&
   grep -Fq "unused-for=24h max-size=8GB dir=$cache_dir" "$trim_log"; then
  pass "controlled trim keeps the 24h/8GB defaults and records success"
else
  fail "controlled trim did not use the required arguments or success record: $(cat "$success_out")"
fi

serializer_fail_out="$scratch_root/serializer-fail.out"
if MILL_GOCACHE_GO="$tool_dir/go" \
   MILL_GOCACHE_PYTHON="/usr/bin/false" \
   bash "$setup" --print-plist >"$serializer_fail_out" 2>&1; then
  fail "plist preview succeeded after serializer failed"
elif grep -q "failed to serialize LaunchAgent plist" "$serializer_fail_out"; then
  pass "plist preview refuses serializer failure"
else
  fail "plist preview failed without a serializer diagnostic"
fi

python_bin="$(command -v python3 2>/dev/null || true)"
if [ -z "$python_bin" ]; then
  fail "python3 is unavailable for plist validation"
else
  gobin_special="$scratch_root/gobin & <tools>"
  log_dir_special="$scratch_root/logs & <records>"
  plist_out="$scratch_root/printed.plist"
  expected_go_dir="$(cd "$tool_dir" && pwd -P)"
  expected_path="$expected_go_dir:$gobin_special:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  if PATH="/usr/bin:/bin" \
     MILL_GOCACHE_GO="$tool_dir/go" \
     MILL_GOCACHE_GOBIN="$gobin_special" \
     MILL_GOCACHE_LOG_DIR="$log_dir_special" \
     MILL_GOCACHE_PYTHON="$python_bin" \
     bash "$setup" --print-plist >"$plist_out" 2>&1 &&
     "$python_bin" - "$plist_out" "$expected_path" "$gobin_special/mill-gocache-trim.sh" "$log_dir_special/mill-gocache-trim.launchd.log" <<'PYTHON'
import plistlib
import sys

with open(sys.argv[1], "rb") as plist_file:
    document = plistlib.load(plist_file)
assert document["Label"] == "com.alicoding.mill.gocache-trim"
assert document["StartInterval"] == 1800
assert document["EnvironmentVariables"]["PATH"] == sys.argv[2]
assert document["ProgramArguments"] == [sys.argv[3]]
assert document["StandardOutPath"] == sys.argv[4]
assert document["StandardErrorPath"] == sys.argv[4]
PYTHON
  then
    pass "restricted launch PATH includes the selected Go directory and plist special characters round-trip"
  else
    fail "LaunchAgent plist did not preserve its paths or cadence: $(cat "$plist_out")"
  fi

  if [ "$(uname -s)" = "Darwin" ] && command -v plutil >/dev/null 2>&1; then
    if plutil -lint "$plist_out" >/dev/null 2>&1; then
      pass "LaunchAgent plist passes plutil lint"
    else
      fail "LaunchAgent plist failed plutil lint"
    fi
  fi

  setup_missing_out="$scratch_root/setup-missing-go.out"
  if MILL_GOCACHE_GO="$scratch_root/missing-go" \
     MILL_GOCACHE_PYTHON="$python_bin" \
     bash "$setup" --print-plist >"$setup_missing_out" 2>&1; then
    fail "setup printed a plist with missing Go"
  elif grep -q "go executable not found or not executable" "$setup_missing_out"; then
    pass "setup requires Go discovery before plist publication"
  else
    fail "setup missing-Go failure was unclear: $(cat "$setup_missing_out")"
  fi

  failed_gobin="$scratch_root/failed install/bin"
  failed_plist="$scratch_root/failed install/agent.plist"
  failed_launchctl_log="$scratch_root/failed-install.launchctl"
  failed_setup_out="$scratch_root/failed-install.out"
  if MILL_GOCACHE_GO="$tool_dir/go" \
     MILL_GOCACHE_GOBIN="$failed_gobin" \
     MILL_GOCACHE_TRIM_PLIST="$failed_plist" \
     MILL_GOCACHE_LOG_DIR="$scratch_root/failed install/logs" \
     MILL_GOCACHE_LAUNCHCTL="$tool_dir/launchctl" \
     MILL_GOCACHE_PYTHON="$python_bin" \
     MILL_TEST_GO_INSTALL_EXIT="29" \
     MILL_TEST_GOCACHE_DIR="$cache_dir" \
     MILL_TEST_LAUNCHCTL_LOG="$failed_launchctl_log" \
     bash "$setup" >"$failed_setup_out" 2>&1; then
    fail "setup succeeded after hardcache installation failed"
  else
    status=$?
    if [ "$status" -eq 29 ] && grep -q "hardcache installation failed with exit 29" "$failed_setup_out" &&
       [ ! -e "$failed_plist" ] && [ ! -e "$failed_gobin/mill-gocache-trim.sh" ] &&
       [ ! -e "$failed_launchctl_log" ] && ! grep -q "installed .* loaded" "$failed_setup_out"; then
      pass "failed dependency installation publishes and loads nothing"
    else
      fail "setup continued after dependency failure: status=$status output=$(cat "$failed_setup_out")"
    fi
  fi

  installed_gobin="$scratch_root/installed & tools/bin"
  installed_plist="$scratch_root/installed & tools/agent.plist"
  launchctl_log="$scratch_root/launchctl.log"
  installed_out="$scratch_root/installed.out"
  if MILL_GOCACHE_GO="$tool_dir/go" \
     MILL_GOCACHE_GOBIN="$installed_gobin" \
     MILL_GOCACHE_TRIM_PLIST="$installed_plist" \
     MILL_GOCACHE_LOG_DIR="$scratch_root/installed & tools/logs" \
     MILL_GOCACHE_LAUNCHCTL="$tool_dir/launchctl" \
     MILL_GOCACHE_PYTHON="$python_bin" \
     MILL_TEST_GO_INSTALL_EXIT="0" \
     MILL_TEST_GOCACHE_DIR="$cache_dir" \
     MILL_TEST_LAUNCHCTL_LOG="$launchctl_log" \
     bash "$setup" >"$installed_out" 2>&1 &&
     [ -x "$installed_gobin/hardcache" ] &&
     [ -x "$installed_gobin/mill-gocache-trim.sh" ] &&
     [ -f "$installed_plist" ] &&
     grep -Fq "load $installed_plist" "$launchctl_log" &&
     grep -q "gocache-trim-setup: installed .* loaded" "$installed_out"; then
    pass "validated dependency and files publish before the stubbed job loads"
  else
    fail "controlled setup did not publish and load successfully: $(cat "$installed_out")"
  fi

  launch_env_path="$("$python_bin" - "$installed_plist" <<'PYTHON'
import plistlib
import sys

with open(sys.argv[1], "rb") as plist_file:
    print(plistlib.load(plist_file)["EnvironmentVariables"]["PATH"])
PYTHON
)"
  launched_args="$scratch_root/launched-hardcache.args"
  launched_log="$scratch_root/launched-trim.log"
  launched_out="$scratch_root/launched-trim.out"
  if PATH="$launch_env_path" \
     MILL_GOCACHE_GOBIN="$installed_gobin" \
     MILL_GOCACHE_LOG_FILE="$launched_log" \
     MILL_GOCACHE_GUARD_NAMED_PROCS="" \
     MILL_GOCACHE_GUARD_GO_REGEX="" \
     MILL_TEST_GO_ENV_MODE="ok" \
     MILL_TEST_GOCACHE_DIR="$cache_dir" \
     MILL_TEST_HARDCACHE_ARGS="$launched_args" \
     /bin/bash "$installed_gobin/mill-gocache-trim.sh" >"$launched_out" 2>&1 &&
     grep -Fxq -- "--dir=$cache_dir" "$launched_args" && [ -s "$launched_log" ]; then
    pass "emitted restricted launch PATH finds nondefault Go for a controlled trim"
  else
    fail "emitted launch PATH could not run the controlled trim: $(cat "$launched_out")"
  fi
fi

if [ "$fails" -gt 0 ]; then
  echo "gocache-trim-selftest: $fails failure(s)" >&2
  exit 1
fi
echo "gocache-trim-selftest: all checks passed"
