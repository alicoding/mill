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
gobin="$HOME/go/bin"
installed_script="$gobin/mill-gocache-trim.sh"

print_plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$label</string>
	<key>ProgramArguments</key>
	<array>
		<string>$installed_script</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>$gobin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
	</dict>
	<key>StartInterval</key>
	<integer>1800</integer>
	<key>StandardOutPath</key>
	<string>$HOME/Library/Logs/mill-gocache-trim.launchd.log</string>
	<key>StandardErrorPath</key>
	<string>$HOME/Library/Logs/mill-gocache-trim.launchd.log</string>
</dict>
</plist>
PLIST
}

if [ "${1:-}" = "--print-plist" ]; then
  print_plist
  exit 0
fi

if [ "${1:-}" = "--remove" ]; then
  launchctl unload "$plist_path" 2>/dev/null || true
  rm -f "$plist_path" "$installed_script"
  echo "gocache-trim-setup: removed $plist_path and $installed_script"
  exit 0
fi

go install github.com/AlekSi/hardcache@v0.2.0

mkdir -p "$gobin"
cp scripts/dev/gocache-trim.sh "$installed_script"
chmod +x "$installed_script"

mkdir -p "$(dirname "$plist_path")"
print_plist >"$plist_path"
launchctl unload "$plist_path" 2>/dev/null || true
launchctl load "$plist_path"
echo "gocache-trim-setup: installed $installed_script, loaded $plist_path"
