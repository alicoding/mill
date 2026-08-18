#!/usr/bin/env bash
# Runs the real-webview parity smoke (docs/goals/0097, re-scoped): builds
# a -tags mcp desktop binary, launches the real app, drives the named
# check registry in internal/webviewbridgesmoke over Wails3's own MCP
# control bridge, quits it cleanly. macOS-only (Wails3's `mcp` build tag
# excludes ios/android; the desktop build itself is Mill's macOS target).
# Local pre-release gate until CI feasibility lands as a wired job --
# see .claude/rules/testing.md's engine-parity entry for the verdict.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

go run ./internal/webviewbridgesmoke
