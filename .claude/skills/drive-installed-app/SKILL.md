---
name: drive-installed-app
description: Drive the REAL installed /Applications/Mill.app for verification -- the real global hotkey, real window/tray behavior, real Accessibility-gated interactions -- instead of falling back to the command palette or struggling with a dropped Accessibility grant. Use whenever a change needs verifying on the installed app, not run-mill's server mode.
---

# Driving the installed app

`run-mill`'s server mode (`.claude/skills/run-mill/SKILL.md`) covers Go
bindings and DOM state fast, but it has no native run loop: no real
global hotkey delivery, no real window floating/Space behavior, no
Accessibility-gated interaction. This skill is what closes that gap on
the REAL `/Applications/Mill.app` -- the setup and procedure that goal
0381 exists to make routine, after an agent burned ~25 minutes and 30+
screenshots on exactly the two failures below.

## Why this exists (read once)

1. **`task install:app`'s ad-hoc signature drops Mill's own
   Accessibility grant on every reinstall.** Ad-hoc (`codesign --sign
   -`) has no Team Identifier, so TCC keys the grant to the binary's
   own code digest -- different every rebuild (confirmed live: an
   ad-hoc binary's own designated requirement is `cdhash H"..."`,
   content-hash-based; a "Mill Dev Signing"-signed one is `certificate
   leaf = H"<cert-hash>"`, stable regardless of content). The fix is a
   stable local signing identity (below) -- not a driving-tool problem.
2. **A scripted `osascript -e 'quit app "Mill"'` can report "User
   canceled" even on a genuinely clean quit.** Mill's own leave
   handshake (goal 0295 S2b) answers the synchronous AppleEvent `false`
   while a background goroutine finishes the real quit -- the bridge's
   `quit` door (below) sidesteps this by calling the quit method
   directly over HTTP, no AppleEvent involved.

## One-time machine setup

1. the repo root's `scripts/setup-dev-signing.sh` -- creates and imports "Mill Dev
   Signing", a local self-signed code-signing certificate, then tries
   to trust it for code signing. If that needs an interactive
   confirmation it can't give non-interactively, it prints the exact
   `security add-trusted-cert` command to run once and exits 2; re-run
   the script afterward to confirm (idempotent).
2. The FIRST time `codesign` actually uses the new key, macOS may show
   a one-time "codesign wants to access key ... enter the login
   keychain password" dialog -- choose **Always Allow**; it does not
   ask again for this key.
3. `MILL_DRIVE_BRIDGE=1 EXTRA_TAGS=mcp task install:app` once, then
   **grant Accessibility to the newly-signed Mill.app** in System
   Settings > Privacy & Security > Accessibility (the OS still needs a
   human to click Allow the FIRST time a given identity asks -- what
   changes is that this grant now SURVIVES every later reinstall,
   confirmed by the stable designated requirement above). Also confirm
   the driving terminal/host itself has Accessibility there (a
   different grant -- `scripts/check-drive-setup.sh`'s own probe).
4. `cliclick` on PATH (`brew install cliclick`) for native drags/clicks.

Steps 1-2 run once per machine. Step 3's grant survives every future
reinstall from here on; re-run it only if the identity itself is ever
regenerated (a new machine, or the keychain item was deleted).

## Per-run procedure

1. **Preflight**: the repo root's `scripts/check-drive-setup.sh` (<10s). Fix whatever
   it names before continuing -- never guess past a failing line.
2. **Quit the running Mill through the bridge door**, not an AppleEvent
   (see "Why this exists" #2). If a bridge is already listening on the
   port you intend to reuse:
   ```
   curl -sS -m 3 -X POST http://127.0.0.1:9099/mcp -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"call_bound_method","arguments":{"name":"github.com/alicoding/mill/internal/services/settingssvc.SettingsService.DevBridgeQuit","args":[]}}}'
   ```
   The response may itself report an error ("application shutting
   down") or never arrive -- both are the expected shape of a clean
   quit racing its own HTTP response, not a failure to react to.
   **Fallback** (no bridge running, e.g. the last install predates
   this goal): `pgrep -x mill` then `kill -TERM <pid>` -- never a
   broader `pkill`/`killall`. A `kill -TERM` skips the leave handshake
   entirely; any unsaved state the durable execution engine tracks
   reconciles on the next start, same as an OS-forced quit today.
3. **Reinstall with the bridge**, from this goal's own worktree or
   whichever checkout you're verifying:
   ```
   MILL_DRIVE_BRIDGE=1 EXTRA_TAGS=mcp task install:app
   ```
   Omit both vars for a plain, bridge-free reinstall (the everyday
   owner-driver rebuild) -- this skill only needs them when actually
   driving the app afterward.
4. **Launch by full path**, never `open -a` (a stray dev bundle can
   hijack that -- project memory), with the bridge env:
   ```
   MILL_SMOKE_MCP_PORT=9199 WAILS_MCP_PORT=9199 /Applications/Mill.app/Contents/MacOS/mill &
   ```
   `WAILS_MCP_PORT` is what the bridge itself reads (Wails' own
   `mcp_enabled.go`); `MILL_SMOKE_MCP_PORT` only matters to
   `internal/webviewbridgesmoke`'s own harness, not a plain launch --
   set both so either reading applies. Pick a port other than 9099 if
   a separate Mill instance already holds it.
   **Launching the binary directly vs `open -a`, tested live**: on
   this machine, `MILL_SMOKE_MCP_PORT=9198 WAILS_MCP_PORT=9198 open -a
   /Applications/Mill.app` reached the bridge on port 9198 exactly like
   the direct binary above -- `open` DOES forward the invoking shell's
   env vars into the launched app here, contrary to the commonly
   assumed rule. Either form is a genuine, full-run-loop launch (same
   AppKit lifecycle, no stripped-down context); the direct binary above
   is still preferred as the simpler, one-fewer-moving-part form and
   the one this skill's own examples use throughout.
   **Never `TaskStop`/kill the shell that launched Mill for you** -- a
   plain trailing `&` still ties the process to that shell, and ending
   or recycling it takes Mill down too. Prefix with `nohup` (e.g.
   `nohup /Applications/Mill.app/Contents/MacOS/mill … &` or `nohup
   open /Applications/Mill.app &`) so Mill fully detaches, and quit it
   only through step 2's `DevBridgeQuit` door, never by stopping the
   launching shell.
5. **Wait for the bridge**, then drive command-first. A bounded loop,
   never `until ... ; do sleep; done` (the session rule against
   unbounded loops):
   ```
   for i in $(seq 1 20); do
     curl -sS -m 2 -X POST http://127.0.0.1:9199/mcp -H 'Content-Type: application/json' \
       -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"app_info","arguments":{}}}' | grep -q '"os"' && break
     sleep 0.3
   done
   ```
   - **`runCommand` first** (`window.__millRunCommand`, present only in
     a `MILL_DRIVE_BRIDGE=1` build) -- the same `findCommand` + `run`
     path a real click/keystroke/palette row already goes through:
     ```
     curl -sS -X POST http://127.0.0.1:9199/mcp -H 'Content-Type: application/json' \
       -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"js_eval","arguments":{"window":"main","js":"return await window.__millRunCommand(\"settings.open\", undefined);"}}}'
     ```
     Returns `{"ok":true}` or `{"ok":false,"error":"..."}` -- an
     `isError` JSON-RPC envelope means the command itself threw.
   - **Native gestures second**, only for what `runCommand` genuinely
     can't reach (a real global hotkey, a real window drag): `cliclick`
     for drags/clicks (`cliclick dd:x,y` ... `du:x,y`); for a global
     hotkey, `osascript`'s **`key code`, never `keystroke`** -- tested
     live: `tell application "System Events" to keystroke "0" using
     {command down, shift down}` delivered to whatever app was
     frontmost as literal text instead of firing Mill's registered
     global hotkey, while the raw-keycode form actually triggered it:
     `tell application "System Events" to key code 29 using {command
     down, shift down}` (key code 29 is `0`; needs the driving
     terminal's own Accessibility grant, step 3 of setup).
   - **Window resize**: the bound `SetSize` Go method errors when
     called through the bridge (`js_eval`/`runCommand`), confirmed
     live -- resize via System Events instead:
     ```
     osascript -e 'tell application "System Events" to tell process "Mill" to set size of window "Mill" to {W,H}'
     ```
   - **`screencapture -x`** for evidence, into the session scratchpad.
6. **Relaunch** (step 2's quit door, then steps 3-5 again) to confirm a
   second pass needs no re-grant -- the Acceptance this goal is proving.
7. Finish with `scripts/check-drive-setup.sh` again and leave Mill
   running (a plain relaunch, real data, no throwaway env vars) --
   verification traffic is allowed to leave the app open per project
   convention; quitting a running Mill is not itself destructive.

## What stays manual-only

Real focus/Space/full-screen window ordering, `HideOnFocusLost`, native
notification banners, and the real Trust/SMAppService/
LocalAuthentication system sheets are unaffected by this skill --
`.claude/skills/manual-checks/SKILL.md` is still the registry for those.
This skill only replaces the SETUP/PROCEDURE cost of reaching the
installed app in the first place; it adds no new capability to what a
human still has to eyeball.
