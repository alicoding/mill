package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

// driveRunCommandResult mirrors frontend/src/shared/driveBridge.ts's
// DriveRunCommandResult -- the {ok, error?} shape window.__millRunCommand
// returns.
type driveRunCommandResult struct {
	Ok    bool   `json:"ok"`
	Error string `json:"error"`
}

// runCommand invokes the frontend's registry command by id through
// window.__millRunCommand (shared/driveBridge.ts, present only when
// the app was built with MILL_DRIVE_BRIDGE=1 -- buildApp() sets it) --
// the highest-abstraction driving door: every real click/keystroke
// already dispatches through shared/commands.ts's own findCommand +
// run, so a check drives the SAME path instead of a hand-rolled DOM
// query. ctx is JSON-marshaled as-is (a CommandContext object, or nil
// for a global command that needs none).
func runCommand(c mcpCaller, id string, ctx map[string]any) (driveRunCommandResult, error) {
	ctxJSON := "undefined"
	if ctx != nil {
		b, err := json.Marshal(ctx)
		if err != nil {
			return driveRunCommandResult{}, fmt.Errorf("marshal ctx: %w", err)
		}
		ctxJSON = string(b)
	}
	var result driveRunCommandResult
	err := c.callJSON("js_eval", withWindow(map[string]any{
		"js": fmt.Sprintf(`if (typeof window.__millRunCommand !== 'function') {
				throw new Error('window.__millRunCommand is not installed -- was this build made with MILL_DRIVE_BRIDGE=1?');
			}
			return await window.__millRunCommand(%s, %s);`, strconv.Quote(id), ctxJSON),
	}), &result)
	if err != nil {
		return driveRunCommandResult{}, err
	}
	return result, nil
}

// quitApp terminates the app through the mcp-tagged DevBridgeQuit door
// (settingsservice_devbridge.go) instead of an AppleEvent quit: a
// synchronous `quit app` against Mill's own leave handshake can report
// "User canceled" even on a genuinely clean quit -- that method's own
// doc comment has the full reasoning. The HTTP response may never
// arrive if the process exits before writing it, so a call error here
// is expected on a normal quit, not itself a failure to report.
func quitApp(c mcpCaller) {
	_, _ = c.call("call_bound_method", map[string]any{
		"name": "github.com/alicoding/mill/internal/services/settingssvc.SettingsService.DevBridgeQuit",
		"args": []any{},
	})
}

// checkRunCommandOpensSettings proves the runCommand door end to end:
// drives the registry command a real ⌘, press or the palette's
// "Settings" row would run, and asserts the SAME DOM effect a real
// click produces (goal 0381's Acceptance).
func checkRunCommandOpensSettings(c mcpCaller) (string, error) {
	result, err := runCommand(c, "settings.open", nil)
	if err != nil {
		return "", err
	}
	if !result.Ok {
		return "", fmt.Errorf("runCommand(settings.open) reported ok=false: %s", result.Error)
	}
	if err := pollJSEval(c, `return !!document.querySelector('[data-testid="settings-view"]');`, 10*time.Second); err != nil {
		return "", fmt.Errorf("settings.open ran but the settings view never rendered: %w", err)
	}
	result, err = runCommand(c, "view.atlas", nil)
	if err != nil {
		return "", fmt.Errorf("runCommand(view.atlas): %w", err)
	}
	if !result.Ok {
		return "", fmt.Errorf("runCommand(view.atlas) reported ok=false: %s", result.Error)
	}
	if err := pollJSEval(c, `return !!document.querySelector('[data-testid="atlas-board"]');`, 10*time.Second); err != nil {
		return "", fmt.Errorf("view.atlas ran but the Atlas board never rendered: %w", err)
	}
	return "runCommand(settings.open) opened the settings view; view.atlas restored the Atlas board", nil
}
