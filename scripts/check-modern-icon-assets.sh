#!/usr/bin/env bash
# Builds the modern Apple catalog only when a full Xcode 26 toolchain is active.
set -euo pipefail

evidence_dir="${1:-}"
if [ -z "$evidence_dir" ]; then
  echo "usage: $0 <evidence-directory>" >&2
  exit 2
fi
if [ -z "${DEVELOPER_DIR:-}" ] || [ ! -d "$DEVELOPER_DIR" ]; then
  echo "modern-icon-assets: DEVELOPER_DIR must name a full Xcode 26 developer directory" >&2
  exit 1
fi

root_dir="$(git rev-parse --show-toplevel)"
cd "$root_dir"
mkdir -p "$evidence_dir"

xcode_version="$(xcodebuild -version)"
case "$xcode_version" in
  "Xcode 26"*) ;;
  *)
    echo "modern-icon-assets: expected Xcode 26, got $xcode_version" >&2
    exit 1
    ;;
esac
actool_path="$(xcrun --find actool)"
if [ ! -x "$actool_path" ]; then
  echo "modern-icon-assets: actool is unavailable under $DEVELOPER_DIR" >&2
  exit 1
fi
if ! command -v wails3 >/dev/null 2>&1; then
  echo "modern-icon-assets: wails3 is unavailable" >&2
  exit 1
fi
if ! command -v task >/dev/null 2>&1; then
  echo "modern-icon-assets: task is unavailable" >&2
  exit 1
fi

{
  printf '%s\n' "$xcode_version"
  printf 'actool: %s\n' "$actool_path"
  wails3 version
} > "$evidence_dir/toolchain.txt"
xcrun actool --version > "$evidence_dir/actool-version.plist"

shasum -a 256 \
  build/appicon.png \
  build/appicon.icon/icon.json \
  build/appicon.icon/Assets/mill-mark.svg \
  build/branding/mill-mark.svg \
  > "$evidence_dir/input-hashes.txt"

task common:generate:icons MODERN_APPLE_ICONS=true

if [ ! -s build/darwin/Assets.car ]; then
  echo "modern-icon-assets: Wails returned without a newly generated Assets.car" >&2
  exit 1
fi
first_catalog_hash="$(shasum -a 256 build/darwin/Assets.car | awk '{print $1}')"
rm -f build/darwin/Assets.car
task common:generate:icons MODERN_APPLE_ICONS=true
if [ ! -s build/darwin/Assets.car ]; then
  echo "modern-icon-assets: deleting Assets.car did not force Task regeneration" >&2
  exit 1
fi
second_catalog_hash="$(shasum -a 256 build/darwin/Assets.car | awk '{print $1}')"
{
  printf 'before-delete: %s\n' "$first_catalog_hash"
  printf 'after-regeneration: %s\n' "$second_catalog_hash"
} > "$evidence_dir/catalog-freshness.txt"
assetutil --validate-file build/darwin/Assets.car
assetutil --info build/darwin/Assets.car > "$evidence_dir/assets-metadata.json"
go run ./internal/iconassets -check-packaged

cp build/darwin/Assets.car "$evidence_dir/Assets.car"
cp build/darwin/icons.icns "$evidence_dir/icons.icns"
cp build/windows/icon.ico "$evidence_dir/icon.ico"
mkdir -p "$evidence_dir/icon-renditions.iconset"
iconutil -c iconset build/darwin/icons.icns -o "$evidence_dir/icon-renditions.iconset"
shasum -a 256 build/darwin/Assets.car build/darwin/icons.icns build/windows/icon.ico \
  > "$evidence_dir/output-hashes.txt"

echo "modern-icon-assets: ok"
