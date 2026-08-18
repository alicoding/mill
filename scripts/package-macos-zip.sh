#!/usr/bin/env bash
# Pinned macOS release-asset naming contract (goal 0100's addendum: one
# definition, shared by release.yml's real-release build and ci.yml's
# beta-release job, so the two can never drift in asset naming). ditto
# (not plain zip) preserves the .app bundle's resource forks/metadata --
# same reasoning release.yml's own original inline step already
# documented before this script existed.
set -euo pipefail

version="${1:?usage: package-macos-zip.sh <version> <app-bundle-path> <output-dir>}"
bundle="${2:?usage: package-macos-zip.sh <version> <app-bundle-path> <output-dir>}"
outdir="${3:?usage: package-macos-zip.sh <version> <app-bundle-path> <output-dir>}"

mkdir -p "$outdir"
ditto -c -k --keepParent "$bundle" "$outdir/mill-${version}-macos-$(uname -m).zip"
