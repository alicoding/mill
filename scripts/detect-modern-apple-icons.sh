#!/usr/bin/env bash
# Resolves whether the selected Apple developer toolchain supports Icon Composer.
set -euo pipefail

requested="${1:-auto}"
if [ "$requested" != "auto" ] && [ "$requested" != "true" ]; then
  echo "detect-modern-apple-icons: mode must be auto or true" >&2
  exit 2
fi

if [ "$(uname -s)" != "Darwin" ]; then
  if [ "$requested" = "true" ]; then
    echo "detect-modern-apple-icons: modern icons require macOS with full Xcode 26" >&2
    exit 1
  fi
  echo false
  exit 0
fi

if ! xcode_version="$(xcodebuild -version 2>/dev/null)"; then
  if [ "$requested" = "true" ]; then
    echo "detect-modern-apple-icons: modern icons require full Xcode 26" >&2
    exit 1
  fi
  echo false
  exit 0
fi

case "$xcode_version" in
  "Xcode 26"*) echo true ;;
  *)
    if [ "$requested" = "true" ]; then
      echo "detect-modern-apple-icons: modern icons require full Xcode 26; selected $xcode_version" >&2
      exit 1
    fi
    echo false
    ;;
esac
