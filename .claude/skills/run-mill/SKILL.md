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

## Testing from another device (phone, tablet) without remote desktop

Server mode's real HTTP server (above) can be made reachable from a phone
on the same network as the Mac, without Chrome Remote Desktop/VNC/screen
sharing — you're hitting the real app in a real browser tab, not remote-
controlling the whole Mac's screen.

1. **Bind wider than localhost.** Wails3's own SDK already reads a
   `WAILS_SERVER_HOST` env var (confirmed directly against
   `application_server.go`, not assumed — "useful for Docker/containers"
   per its own comment), overriding the `localhost`-only default. No Mill
   code needed for this part.
2. **Scope reachability to your own devices only, not the whole WiFi** —
   install [Tailscale](https://tailscale.com) (or ZeroTier) on the Mac and
   the other device, sign into the same account. Bind to the Mac's own
   Tailscale IP (`100.x.x.x`, shown in the Tailscale app) specifically,
   not `0.0.0.0` — this means the port never opens on the regular WiFi
   interface at all, not "open to the LAN and hope nobody else notices":
   ```
   WAILS_SERVER_HOST=<mac's-tailscale-ip> ./bin/mill-server &
   ```
   Then open `http://<mac's-tailscale-ip>:8080` in the other device's
   browser. (Tailscale itself depends on a coordination server for device
   discovery/NAT traversal — actual app traffic is direct WireGuard P2P,
   not relayed through them; Headscale is the self-hosted alternative if
   that dependency matters.)
3. **Keep it running without a live terminal session** — a macOS
   `launchd` LaunchAgent (`~/Library/LaunchAgents/com.alicoding.mill-server.plist`,
   `RunAtLoad`+`KeepAlive` true) starts `bin/mill-server` on login and
   restarts it if it crashes. `launchctl load`/`unload` that plist to
   start/stop it; `~/Library/Logs/mill-server.log` has its output.
4. **Never point a standing background instance at your real desktop-app
   data.** Set `MILL_SETTINGS_PATH`/`MILL_EXECUTION_DB_PATH` (both already
   supported, main.go) to a separate directory in the LaunchAgent's own
   `EnvironmentVariables` — two live processes (this one + the desktop
   app) writing the same settings.json/execution.db risks corruption, and
   both independently running the same schedule/clipboard-watch/
   filesystem-watch triggers risks a scheduled workflow double-firing.
   `App.tsx` shows a "TEST DATA" badge whenever `MILL_SETTINGS_PATH` is
   set (`SettingsService.IsIsolatedData()`, docs/SPEC.md §3.7), so it's
   never ambiguous which instance — real data or isolated — you're
   looking at.

This does not change what "What this does NOT cover" says below — real
OS-level global hotkeys still can't be tested this way, or any other
remote-into-the-webpage way, regardless of network topology (see the
`-tags mcp` finding right below: a keypress sent into the page only ever
becomes a DOM `KeyboardEvent`, never a genuine OS-level one).

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
