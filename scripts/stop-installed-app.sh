#!/usr/bin/env bash
# Stops only processes whose executable text is the installed Mill binary.
# lsof's -a combines the PID, descriptor, and file selections; -Fp keeps the
# result machine-readable without -t's implicit warning suppression.
set -euo pipefail

target="${1:-/Applications/Mill.app/Contents/MacOS/mill}"
if [ "$#" -gt 1 ]; then
  echo "stop-installed-app: expected at most one executable path" >&2
  exit 2
fi
case "$target" in
  /*) ;;
  *)
    echo "stop-installed-app: executable path must be absolute: $target" >&2
    exit 2
    ;;
esac

if [ ! -e "$target" ] && [ ! -L "$target" ]; then
  exit 0
fi
if [ ! -f "$target" ]; then
  echo "stop-installed-app: refusing non-regular executable target: $target" >&2
  exit 1
fi

# These seams exist only so the selftest can force an inspection failure and
# shorten its TERM-refusal case. Production callers use the fixed system lsof
# and the 15-second wait.
lsof_bin="${MILL_STOP_INSTALLED_APP_TEST_LSOF:-/usr/sbin/lsof}"
wait_seconds="${MILL_STOP_INSTALLED_APP_TEST_WAIT_SECONDS:-15}"
case "$wait_seconds" in
  ''|*[!0-9]*)
    echo "stop-installed-app: wait must be a non-negative integer" >&2
    exit 2
    ;;
esac
if [ ! -x "$lsof_bin" ]; then
  echo "stop-installed-app: lsof is unavailable or not executable: $lsof_bin" >&2
  exit 1
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/mill-stop-installed.XXXXXX")"
trap 'rm -rf "$work"' EXIT

inspect_seq=0

# inspect [pid] prints positive PIDs whose executable text matches $target.
# Clean lsof exit 1 with no output is its documented no-match result. Any
# diagnostic, malformed field stream, or other exit shape refuses the install.
inspect() {
  local selected_pid="${1:-}" rc line value saw_pid=false
  local stdout_file stderr_file
  inspect_seq=$((inspect_seq + 1))
  stdout_file="$work/lsof-${inspect_seq}.out"
  stderr_file="$work/lsof-${inspect_seq}.err"

  set +e
  if [ -n "$selected_pid" ]; then
    "$lsof_bin" -p "$selected_pid" -a -d txt -Fp -- "$target" >"$stdout_file" 2>"$stderr_file"
  else
    "$lsof_bin" -a -d txt -Fp -- "$target" >"$stdout_file" 2>"$stderr_file"
  fi
  rc=$?
  set -e

  if [ -s "$stderr_file" ]; then
    cat "$stderr_file" >&2
    echo "stop-installed-app: lsof emitted diagnostics while inspecting $target" >&2
    return 1
  fi
  if [ "$rc" -eq 1 ] && [ ! -s "$stdout_file" ]; then
    return 0
  fi
  if [ "$rc" -ne 0 ]; then
    echo "stop-installed-app: lsof exited $rc while inspecting $target" >&2
    return 1
  fi
  if [ ! -s "$stdout_file" ]; then
    echo "stop-installed-app: lsof exited successfully without a field stream for $target" >&2
    return 1
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      p*)
        value="${line#p}"
        case "$value" in
          ''|0*|*[!0-9]*)
            echo "stop-installed-app: unexpected lsof PID field: $line" >&2
            return 1
            ;;
        esac
        saw_pid=true
        printf '%s\n' "$value"
        ;;
      f?*)
        # Descriptor fields are requested by -Fp and establish no identity
        # beyond the command's already-combined -d txt file selection.
        ;;
      *)
        echo "stop-installed-app: unexpected lsof field: ${line:-<empty>}" >&2
        return 1
        ;;
    esac
  done < "$stdout_file"

  if [ "$saw_pid" != true ]; then
    echo "stop-installed-app: lsof field stream contained no PID for $target" >&2
    return 1
  fi
}

contains_pid() {
  local wanted="$1" line
  while IFS= read -r line; do
    if [ "$line" = "$wanted" ]; then
      return 0
    fi
  done
  return 1
}

initial_file="$work/initial.pids"
if ! inspect >"$initial_file"; then
  exit 1
fi

signalled_file="$work/signalled.pids"
: >"$signalled_file"
while IFS= read -r pid; do
  [ -n "$pid" ] || continue
  current_file="$work/pre-term-${pid}.pids"
  if ! inspect "$pid" >"$current_file"; then
    exit 1
  fi
  if ! contains_pid "$pid" <"$current_file"; then
    continue
  fi
  if /bin/kill -TERM "$pid"; then
    printf '%s\n' "$pid" >>"$signalled_file"
    continue
  fi

  # Exiting between the identity check and TERM is benign. A process that
  # still has the selected executable after a failed signal is a refusal.
  if ! inspect "$pid" >"$current_file"; then
    exit 1
  fi
  if contains_pid "$pid" <"$current_file"; then
    echo "stop-installed-app: failed to signal matching process $pid" >&2
    exit 1
  fi
done <"$initial_file"

elapsed=0
while [ "$elapsed" -lt "$wait_seconds" ]; do
  still_matching=false
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    current_file="$work/wait-${pid}.pids"
    if ! inspect "$pid" >"$current_file"; then
      exit 1
    fi
    if contains_pid "$pid" <"$current_file"; then
      still_matching=true
    fi
  done <"$signalled_file"
  [ "$still_matching" = true ] || break
  sleep 1
  elapsed=$((elapsed + 1))
done

# A fresh matching process may have appeared after initial discovery. Never
# replace the bundle while any process still executes the selected file.
final_file="$work/final.pids"
if ! inspect >"$final_file"; then
  exit 1
fi
if [ -s "$final_file" ]; then
  remaining="$(tr '\n' ' ' <"$final_file" | sed 's/[[:space:]]*$//')"
  echo "stop-installed-app: matching process did not exit within ${wait_seconds}s (pid ${remaining})" >&2
  exit 1
fi

exit 0
