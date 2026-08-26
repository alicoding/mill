package triggersvc

import (
	"time"

	"github.com/alicoding/mill/internal/adapters/clipboard"
)

// clipboardHistoryPollInterval is faster than trigger-clipboard-watch's
// own 2s (triggerclipboardwatch.go): Maccy's own convergent interval is
// 500ms (goal 0234's research), and a history surface reads as live
// only if new copies show up promptly.
const clipboardHistoryPollInterval = time.Second

// shouldCaptureClipboardChange decides whether one poll cycle's changed
// text should become a trigger fire -- pulled out of the RegisterTrigger
// closure below so it's testable against a fake pasteboard source
// (consumeSelfWrite/isConcealed) instead of the real macOS pasteboard
// (goal 0234's own e2e-divergence note: "prefer testing the trigger/
// store logic against a fake pasteboard source at the Go layer").
//
// Self-echo: a poll cycle immediately following Mill's own
// clipboard.WriteText (a workflow's apply-clipboard-write-* step, or
// this same feature's own copy-back action) must not re-capture that
// write as a new history entry.
//
// Confidential content: content marked via the nspasteboard.org
// convention (password managers, transient generators) never reaches a
// run at all -- skipped here, before the trigger even fires, so it
// leaves no trace in Runs either. A check that itself fails to evaluate
// (isConcealed's error return) counts as concealed, never as "assume
// it's safe" -- node-standard.md item 6's fail-safe rule: an
// unevaluable condition is the RESTRICTIVE outcome.
func shouldCaptureClipboardChange(text string, consumeSelfWrite func(string) bool, isConcealed func() (bool, error)) bool {
	if consumeSelfWrite(text) {
		return false
	}
	concealed, err := isConcealed()
	if err != nil || concealed {
		return false
	}
	return true
}

// Schema registers from internal/domain/composition/triggers.go, not
// here -- see that file's doc comment.
func init() {
	RegisterTrigger("trigger-clipboard-change", func(s *TriggerService, workflowID string, _ map[string]string) (*activeListener, error) {
		stop := clipboard.WatchChanges(clipboardHistoryPollInterval, func(text string) {
			if !shouldCaptureClipboardChange(text, clipboard.ConsumeSelfWrite, clipboard.IsConcealed) {
				return
			}
			s.fire(workflowID, "", text)
		})
		return &activeListener{clipStop: stop}, nil
	})
}
