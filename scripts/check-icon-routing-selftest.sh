#!/usr/bin/env bash
# Keeps every Mill-owned identity path on the required modern catalog route.
set -euo pipefail

root_dir="$(git rev-parse --show-toplevel)"
cd "$root_dir"

python3 - .github/workflows/ci.yml <<'PY'
import sys

import yaml

workflow_path = sys.argv[1]
with open(workflow_path, encoding="utf-8") as workflow_file:
    workflow = yaml.safe_load(workflow_file)

filter_step = next(
    step
    for step in workflow["jobs"]["changes"]["steps"]
    if step.get("id") == "filter"
)
filters = yaml.safe_load(filter_step["with"]["filters"])
patterns = filters["icons"]

owned_paths = [
    "Taskfile.yml",
    "auxwindows.go",
    "main.go",
    "build/appicon.png",
    "build/appicon.icon/icon.json",
    "build/appicon.icon/Assets/mill-mark.svg",
    "build/branding/mill-mark.svg",
    "build/tray-template.png",
    "build/Taskfile.yml",
    "build/config.yml",
    "build/darwin/Assets.car",
    "build/darwin/icons.icns",
    "build/darwin/Info.plist",
    "build/darwin/Info.dev.plist",
    "build/darwin/Taskfile.yml",
    "build/darwin/dmg-background.png",
    "build/darwin/dmg-file-icon.icns",
    "build/darwin/dmg-file-icon.png",
    "build/ios/Assets.xcassets",
    "build/ios/icon.png",
    "build/ios/Info.plist",
    "build/ios/Taskfile.yml",
    "build/linux/desktop",
    "build/linux/nfpm/nfpm.yaml",
    "build/linux/Taskfile.yml",
    "build/windows/icon.ico",
    "build/windows/msix/template.xml",
    "build/windows/nsis/project.nsi",
    "build/windows/Taskfile.yml",
    "examples/browser-extension/icons/icon-16.png",
    "examples/browser-extension/manifest.json",
    "frontend/index.html",
    "frontend/public/icons/icon-192.png",
    "frontend/public/manifest.webmanifest",
    "frontend/public/mill.svg",
    "frontend/src/app/millicon.png",
    "internal/iconassets/main.go",
    "scripts/check-icon-routing-selftest.sh",
    "scripts/check-modern-icon-assets.sh",
    "scripts/check-modern-icon-mode-selftest.sh",
    "scripts/detect-modern-apple-icons.sh",
    ".github/workflows/ci.yml",
]
unrelated_paths = [
    "build/docker/Dockerfile.server",
    "examples/browser-extension/background.js",
    "examples/plugins/example/main.js",
    "frontend/public/puppertino/puppertino.css",
    "frontend/src/app/App.tsx",
]


def matches(path, pattern):
    if pattern.endswith("/**"):
        prefix = pattern[:-3]
        return path == prefix or path.startswith(prefix + "/")
    return path == pattern


missing = [path for path in owned_paths if not any(matches(path, pattern) for pattern in patterns)]
unexpected = [path for path in unrelated_paths if any(matches(path, pattern) for pattern in patterns)]
if missing or unexpected:
    if missing:
        print("icon-routing-selftest: missing owned paths: " + ", ".join(missing), file=sys.stderr)
    if unexpected:
        print("icon-routing-selftest: unrelated paths matched: " + ", ".join(unexpected), file=sys.stderr)
    raise SystemExit(1)

required_needs = workflow["jobs"]["ci-gate"]["needs"]
if "modern-icon-assets" not in required_needs or "desktop-launch" in required_needs:
    print("icon-routing-selftest: modern catalog must be required while desktop launch stays optional", file=sys.stderr)
    raise SystemExit(1)

print("icon-routing-selftest: OK")
PY
