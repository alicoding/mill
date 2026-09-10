#!/usr/bin/env bash
# Proves Task derives modern icon freshness from the selected Apple toolchain.
set -euo pipefail

root_dir="$(git rev-parse --show-toplevel)"
task_bin="$(command -v task)"
fixture_dir="$(mktemp -d "${TMPDIR:-/tmp}/mill-icon-mode.XXXXXX")"
trap 'rm -rf "$fixture_dir"' EXIT

cat > "$fixture_dir/uname" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${MILL_TEST_UNAME:-Darwin}"
EOF
cat > "$fixture_dir/xcodebuild" <<'EOF'
#!/usr/bin/env bash
if [ "${MILL_TEST_XCODE:-clt}" = "full" ]; then
  if [ "${DEVELOPER_DIR:-}" != "/Applications/TestXcode.app/Contents/Developer" ]; then
    echo "fixture did not receive DEVELOPER_DIR" >&2
    exit 1
  fi
  printf 'Xcode 26.3\nBuild version 17C38\n'
  exit 0
fi
echo "xcode-select: error: tool 'xcodebuild' requires Xcode" >&2
exit 1
EOF
chmod +x "$fixture_dir/uname" "$fixture_dir/xcodebuild"

cd "$root_dir"
if [ -e build/darwin/Assets.car ]; then
  echo "modern-icon-mode-selftest: fixture requires a missing catalog" >&2
  exit 1
fi
full_output="$(
  PATH="$fixture_dir:$PATH" \
  MILL_TEST_XCODE=full \
  DEVELOPER_DIR=/Applications/TestXcode.app/Contents/Developer \
  "$task_bin" --dry common:generate:icons 2>&1
)"
if ! grep -Fq 'if [ "true" = "true" ]' <<< "$full_output"; then
  echo "modern-icon-mode-selftest: full Xcode did not require Assets.car" >&2
  exit 1
fi

legacy_output="$(PATH="$fixture_dir:$PATH" MILL_TEST_XCODE=clt "$task_bin" --force --dry common:generate:icons 2>&1)"
if ! grep -Fq 'if [ "false" = "true" ]' <<< "$legacy_output"; then
  echo "modern-icon-mode-selftest: CLT-only selection did not preserve legacy generation" >&2
  exit 1
fi

nonmac_output="$(PATH="$fixture_dir:$PATH" MILL_TEST_UNAME=Linux "$task_bin" --force --dry common:generate:icons 2>&1)"
if ! grep -Fq 'if [ "false" = "true" ]' <<< "$nonmac_output"; then
  echo "modern-icon-mode-selftest: non-macOS selection did not preserve legacy generation" >&2
  exit 1
fi

if PATH="$fixture_dir:$PATH" MILL_TEST_XCODE=clt \
  "$task_bin" --force --dry common:generate:icons MODERN_APPLE_ICONS=true \
  > "$fixture_dir/required.out" 2>&1; then
  echo "modern-icon-mode-selftest: explicit modern mode accepted CLT-only selection" >&2
  exit 1
fi
if ! grep -Fq 'modern icons require full Xcode 26' "$fixture_dir/required.out"; then
  cat "$fixture_dir/required.out" >&2
  exit 1
fi

echo "modern-icon-mode-selftest: OK"
