<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/banner-light.svg">
  <img alt="Mill — guardrailed agentic workflows, on your desktop" src="docs/assets/banner-light.svg" width="720">
</picture>

[![CI](https://github.com/alicoding/mill/actions/workflows/ci.yml/badge.svg)](https://github.com/alicoding/mill/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/alicoding/mill/badge)](https://scorecard.dev/viewer/?uri=github.com/alicoding/mill)
[![License](https://img.shields.io/github/license/alicoding/mill)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.25%2B-00ADD8?logo=go&logoColor=white)](go.mod)
[![Platform](https://img.shields.io/badge/platform-macOS-111111?logo=apple)](#install)

</div>

Mill is a guardrailed, agentic-workflow desktop app: it lets an AI agent (or
a human) compose and run automations — capturing data, processing it,
applying an action — while keeping every step reviewable and reversible.
The core idea is *what-you-see-is-what-I-see*: an AI acting on a system it
can't verify has to guess at the real state (what's actually on the
clipboard, what a command will really do, what a setting is really set to),
and that gap between the guess and reality is exactly where hallucination
and silent failure live. Mill closes that gap by giving both the human and
the AI the same verified, structured view of state — and a guardrail that
previews an action before it happens, instead of trusting a text
description of it. Mill isn't a novel category: it composes existing
primitives (a workflow authoring layer with guardrails) the way a generic
credential manager or a generic workflow-automation tool would, applied to
agent-guarded local actions instead.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshot-canvas-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/screenshot-canvas-light.png">
  <img alt="A seeded example workflow open in Mill's read-only canvas view: a manual trigger captures a typed amount, a Branch node routes on amount > 100, and each path ends at a typed Decision terminal" src="docs/assets/screenshot-canvas-light.png">
</picture>

*One of Mill's built-in seeded examples on the canvas: capture a typed
value, branch on it, land at a typed Decision outcome — every example
ships runnable and fully editable.*

## Status

Mill is under active development, pre-1.0. Several UX surfaces are
explicitly prototype-quality while the underlying capability is real and
exercised end-to-end. Expect rough edges in presentation before you expect
them in behavior — and expect both to keep changing release to release.

## Install

Mill ships as a single Go binary with the frontend compiled in (no
separate CLI/backend, no hosted-service dependency) — `git clone` plus a
local build is the whole install story. You'll need Go 1.25+, Node 22+,
the [Task](https://taskfile.dev) CLI, and the Wails3 CLI first:

```sh
brew install go node go-task lefthook golangci-lint
go install github.com/loeffel-io/ls-lint/v2/cmd/ls_lint@v2.3.1
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.4
# make sure $(go env GOPATH)/bin (usually ~/go/bin) is on your PATH

git clone https://github.com/alicoding/mill.git
cd mill
task setup:hooks   # installs Lefthook's pre-commit hooks (mirrors CI)

# Run it
task dev           # starts Mill with hot reload — leave it running
```

`task dev` is the way to iterate: frontend edits hot-reload instantly, and
only a Go change triggers a restart. See `CLAUDE.md` for the full set of
build/dev commands (`task install:app`, `task build`, `task package`, ...).

## Documentation

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to propose a change.
- [`SECURITY.md`](SECURITY.md) — how to report a vulnerability and what's
  in scope.

## License

[Apache-2.0](LICENSE).
