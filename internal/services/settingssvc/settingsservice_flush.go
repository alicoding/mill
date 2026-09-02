package settingssvc

import (
	"time"

	"github.com/alicoding/mill/internal/adapters/windowing"
)

// flushBound is how long quit / restart wait for the page to flush its
// live edits (app/useBeforeQuitFlush.ts answers mill-before-quit with
// mill-flushed). Bounded so a hung page never holds the process.
const flushBound = 2 * time.Second

// flushFrontend is the quit / restart handshake's Go half (goal 0295
// S2): emit the request, wait for the answer or the bound. Callers
// proceed either way -- a page that never answers must not hold the
// process, and one that answered has already saved.
func (s *SettingsService) flushFrontend() {
	// Subscribe before emitting so a fast answer cannot be missed.
	answered := make(chan bool, 1)
	go func() {
		answered <- windowing.WaitForEvent("mill-flushed", flushBound)
	}()
	// Give the subscriber a moment to attach before the request goes out.
	time.Sleep(10 * time.Millisecond)
	windowing.Emit("mill-before-quit", true)
	<-answered
}
