//go:build mcp

package settingssvc

import "github.com/alicoding/mill/internal/adapters/windowing"

// DevBridgeQuit terminates the app immediately, bypassing the leave
// handshake's confirmation sheet (settingsservice_flush.go, goal 0295
// S2b) -- compiled ONLY into a -tags mcp build (internal/
// webviewbridgesmoke's own buildApp(), install:app's EXTRA_TAGS=mcp
// path), so this method does not exist at all in a build a real user
// runs; a call through Wails' own runtime.Call.ByName is the ONLY way
// to reach it.
//
// A scripted AppleEvent `quit app "Mill"` against the normal quit path
// can report "User canceled" even on a genuinely clean quit: ShouldQuit
// answers the FIRST AppleEvent false while a background goroutine
// finishes the real quit asynchronously, so the synchronous AppleEvent
// caller sees a cancelled reply regardless of the eventual outcome.
// This sidesteps that failure mode entirely by pre-approving the leave
// (no handshake, no sheet) and asking the toolkit to quit directly over
// the bridge's own HTTP channel -- no AppleEvent involved.
//
//wails:ignore
func (s *SettingsService) DevBridgeQuit() {
	s.leave.mu.Lock()
	s.leave.approved = true
	s.leave.mu.Unlock()
	windowing.Quit()
}
