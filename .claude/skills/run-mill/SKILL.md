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

**Spiked once (docs/SPEC.md §3.7, task #14): Wails3's own built-in
`-tags mcp` server does NOT close this gap either — confirmed
empirically, not assumed.** A `go build -tags mcp .` desktop binary
(the tag compiles the MCP server into a normal desktop build, not a
server-mode one -- confirmed by its own build constraint,
`//go:build mcp && !ios && !android`) exposes 16 tools over HTTP
(`127.0.0.1:9099` by default) for driving the real desktop window:
`window_control`, `js_eval`, `dom_query`, `mouse_*`, `keyboard_type`/
`keyboard_press`, `call_bound_method` (call any Wails-bound Go method
directly), `screenshot_dom`. Real test performed: connected a genuine
MCP client, called `call_bound_method` to bind a real summon hotkey
(`main.SettingsService.AssignSummonHotkey`, ⌥⇧M — succeeded, no
error), minimised the window, then called `keyboard_press` with the
identical combo (`key: "m", modifiers: ["alt","shift"]`). The press
reached the DOM (its own response returned the real rendered page
text), but the window's `minimised`/`visible` state in a follow-up
`app_info` call never changed — proving `keyboard_press` dispatches a
**DOM-scoped `KeyboardEvent` only**, not a genuine OS-level keypress
`golang.design/x/hotkey`'s global listener can see. **Verdict: this
tool closes part of the desktop-only verification gap (tray icon/
window-state/Accessibility-gated UI flows are now agent-drivable via
`window_control`/`dom_query`/`call_bound_method`) but not hotkey
delivery specifically** — that still needs the real desktop app,
checked by hand, exactly as stated above. Worth revisiting as a
standing verification tool for the window/tray-state class of check,
not adopted as part of this skill's standard workflow in this pass
(a one-off spike, not yet wired into CI/Lefthook or a habit).

## Why not `wails3 dev`'s browser mode instead

`wails3 dev` also lets you open `http://localhost:9245` (the Vite dev
server) in a plain browser for fast CSS/layout iteration with normal
DevTools. But that only serves the frontend — **Go bindings do not work**
there, so clicking "Run" on anything would fail. Server mode is the one that
exercises the real backend.
