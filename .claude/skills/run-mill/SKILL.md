---
name: run-mill
description: Launch and drive Mill (the Wails3 app in this repo) headlessly to verify a UI or backend change, instead of asking the user to manually relaunch the native app and eyeball it. Use when a change to frontend/ or a *service.go file needs to be verified working, not just compiling.
---

# Running Mill headlessly

Mill is a Wails3 desktop app, but Wails3 ships an official **server mode**
(`-tags server`) that runs the exact same `main.go` / services as a plain
HTTP server instead of a native window. Service bindings (`RunbookService`,
`HotkeyService.List`/`Assign`/`Unassign`, `SpecService`, `GreetService`) work
identically to desktop mode — same Go code, no mocking, no stubs. This is
the fastest way to confirm a change actually works, not just that it builds.

## Steps

1. Build the frontend if you touched anything under `frontend/`:
   ```
   cd frontend && npm run build:dev
   ```

2. Build the server binary from the repo root:
   ```
   go build -tags server -o bin/mill-server .
   ```
   (This is what `task build:server DEV=true` wraps — use the Taskfile
   target directly if `task`/`wails3` happen to be on `PATH`; the raw `go
   build` above always works and needs neither.)

3. Launch it in the background and confirm it's up:
   ```
   ./bin/mill-server &
   curl -sS http://localhost:8080/health   # {"status":"ok"}
   ```

4. Drive it with the Playwright MCP tools (`browser_navigate` to
   `http://localhost:8080`, `browser_snapshot` for an accessibility tree with
   stable `ref`s to click against, `browser_click`, `browser_take_screenshot`
   for a visual check). This is a real browser tab hitting real Go bindings
   over HTTP/WebSocket — clicking "Run" on a Runbook action actually shells
   out to `pbcopy` on the host, actually converts HTML to Markdown, etc.

5. Kill the background server when done (`pkill -f bin/mill-server` or stop
   the backgrounded Bash task) — nothing about this leaves state behind
   except whatever the action itself did (e.g. real clipboard writes).

## What this does NOT cover

`HotkeyService.Assign` registers a real OS-level global hotkey via
`golang.design/x/hotkey`, which needs a live Cocoa/AppKit run loop on macOS
to deliver keypresses. Server mode has no native run loop at all (window
APIs are safely no-op'd, per Wails3's own docs), so hotkey
registration/triggering can't be exercised this way. That's not a gap this
skill introduces — no headless automation could fire a real system-wide
keypress + Accessibility-permission grant anyway. Verifying an actual hotkey
press still requires the real desktop app, launched via `task dev`/`task
run`, checked by hand.

## Why not `wails3 dev`'s browser mode instead

`wails3 dev` also lets you open `http://localhost:9245` (the Vite dev
server) in a plain browser for fast CSS/layout iteration with normal
DevTools. But that only serves the frontend — **Go bindings do not work**
there, so clicking "Run" on anything would fail. Server mode is the one that
exercises the real backend.
