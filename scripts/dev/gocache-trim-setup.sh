#!/usr/bin/env bash
# Installs (or removes, --remove) the LaunchAgent that runs
# gocache-trim.sh on an idle cadence. --print-plist emits the plist to
# stdout without touching the real LaunchAgents directory or launchctl,
# so the selftest can validate its shape without installing anything.
#
# The plist's ProgramArguments points at a COPY under ~/go/bin, never
# at this checkout's own repo-relative path: a worktree is routinely
# removed once its goal's PR merges, and launchd gives no visible
# signal when ProgramArguments names a path that no longer exists --
# the job just silently stops firing. Rerun this script after any
# repo/worktree change to refresh the copy.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

label="com.alicoding.mill.gocache-trim"
plist_path="${MILL_GOCACHE_TRIM_PLIST:-$HOME/Library/LaunchAgents/$label.plist}"
gobin="${MILL_GOCACHE_GOBIN:-$HOME/go/bin}"
log_dir="${MILL_GOCACHE_LOG_DIR:-$HOME/Library/Logs}"
installed_script="$gobin/mill-gocache-trim.sh"
launch_log="$log_dir/mill-gocache-trim.launchd.log"
launchctl_bin="${MILL_GOCACHE_LAUNCHCTL:-launchctl}"
python_bin="${MILL_GOCACHE_PYTHON:-$(command -v python3 2>/dev/null || true)}"

if [ "${1:-}" = "--remove" ]; then
  "$launchctl_bin" unload "$plist_path" 2>/dev/null || true
  rm -f "$plist_path" "$installed_script"
  echo "gocache-trim-setup: removed $plist_path and $installed_script"
  exit 0
fi

go_bin="${MILL_GOCACHE_GO:-}"
if [ -n "$go_bin" ]; then
  if [ ! -x "$go_bin" ]; then
    echo "gocache-trim-setup: go executable not found or not executable: $go_bin" >&2
    exit 1
  fi
else
  go_bin="$(command -v go 2>/dev/null || true)"
  if [ -z "$go_bin" ]; then
    echo "gocache-trim-setup: go executable not found on PATH" >&2
    exit 1
  fi
fi
go_dir="$(cd "$(dirname "$go_bin")" && pwd -P)" || {
  echo "gocache-trim-setup: cannot resolve Go executable directory: $go_bin" >&2
  exit 1
}
launch_path="$go_dir:$gobin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [ -z "$python_bin" ] || [ ! -x "$python_bin" ]; then
  echo "gocache-trim-setup: python3 is required to serialize and validate the LaunchAgent plist" >&2
  exit 1
fi

print_plist() {
  "$python_bin" - "$label" "$installed_script" "$launch_path" "$launch_log" <<'PYTHON'
import plistlib
import sys

label, installed_script, launch_path, launch_log = sys.argv[1:]
document = {
    "Label": label,
    "ProgramArguments": [installed_script],
    "EnvironmentVariables": {"PATH": launch_path},
    "StartInterval": 1800,
    "StandardOutPath": launch_log,
    "StandardErrorPath": launch_log,
}
sys.stdout.buffer.write(plistlib.dumps(document, sort_keys=False))
PYTHON
}

if [ "${1:-}" = "--print-plist" ]; then
  if ! print_plist; then
    echo "gocache-trim-setup: failed to serialize LaunchAgent plist" >&2
    exit 1
  fi
  exit 0
fi

mkdir -p "$gobin"
GOBIN="$gobin" "$go_bin" install github.com/AlekSi/hardcache@v0.2.0
status=$?
if [ "$status" -ne 0 ]; then
  echo "gocache-trim-setup: hardcache installation failed with exit $status" >&2
  exit "$status"
fi
if [ ! -x "$gobin/hardcache" ]; then
  echo "gocache-trim-setup: hardcache installation did not produce $gobin/hardcache" >&2
  exit 1
fi

mkdir -p "$(dirname "$plist_path")"
plist_tmp="${TMPDIR:-/tmp}/mill-gocache-trim-plist.$$.XXXXXX"
plist_tmp="$(mktemp "$plist_tmp")" || exit 1
installed_tmp="$installed_script.tmp.$$"
published_plist_tmp="$plist_path.tmp.$$"
cleanup() {
  rm -f "$plist_tmp" "$installed_tmp" "$published_plist_tmp"
}
trap cleanup EXIT

if ! print_plist >"$plist_tmp"; then
  echo "gocache-trim-setup: failed to serialize LaunchAgent plist" >&2
  exit 1
fi
if ! "$python_bin" - "$plist_tmp" <<'PYTHON'
import plistlib
import sys

with open(sys.argv[1], "rb") as plist_file:
    plistlib.load(plist_file)
PYTHON
then
  echo "gocache-trim-setup: generated LaunchAgent plist is invalid" >&2
  exit 1
fi

if ! cp scripts/dev/gocache-trim.sh "$installed_tmp" ||
   ! chmod +x "$installed_tmp" ||
   ! cp "$plist_tmp" "$published_plist_tmp"; then
  echo "gocache-trim-setup: failed to stage installed files" >&2
  exit 1
fi
if ! mv "$installed_tmp" "$installed_script" ||
   ! mv "$published_plist_tmp" "$plist_path"; then
  echo "gocache-trim-setup: failed to publish installed files" >&2
  exit 1
fi

"$launchctl_bin" unload "$plist_path" 2>/dev/null || true
"$launchctl_bin" load "$plist_path"
status=$?
if [ "$status" -ne 0 ]; then
  echo "gocache-trim-setup: launchctl load failed with exit $status" >&2
  exit "$status"
fi
echo "gocache-trim-setup: installed $installed_script, loaded $plist_path"
