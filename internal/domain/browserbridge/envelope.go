package browserbridge

import "github.com/alicoding/mill/internal/domain/usererror"

// The command kinds Mill sends down an open browser stream. KindPing is
// the keepalive: a browser extension's service worker is shut down
// after a short idle period, and a chunk arriving on the open stream is
// what resets that timer -- so the keepalive is a liveness requirement
// of the transport, not decoration.
const (
	KindReplay = "replay"
	KindPing   = "ping"
)

// KeepaliveSeconds is how often a connected stream receives a ping.
const KeepaliveSeconds = 25

// Target narrows where a flow runs. An empty URL means the flow's own
// first navigate step decides.
type Target struct {
	URL string `json:"url,omitempty"`
}

// Command is one envelope written to a connected browser's stream. ID
// correlates every result the browser posts back; a ping carries none.
type Command struct {
	ID     string    `json:"id,omitempty"`
	Kind   string    `json:"kind"`
	Flow   *UserFlow `json:"flow,omitempty"`
	Target *Target   `json:"target,omitempty"`
}

// The status values a result may carry. StatusOK/StatusFailed/
// StatusSkipped describe one step; StatusDone/StatusFailed close a run.
const (
	StatusOK      = "ok"
	StatusFailed  = "failed"
	StatusSkipped = "skipped"
	StatusDone    = "done"
)

// Download is a file the browser saved while a run was in flight,
// reported with where it landed so a later step can read it.
type Download struct {
	Path     string `json:"path"`
	Filename string `json:"filename"`
	Bytes    int64  `json:"bytes"`
}

// Result is one POST back from the browser. StepIndex present means it
// reports a single step; absent means it closes the whole run, and
// Status is then StatusDone or StatusFailed.
type Result struct {
	ID        string    `json:"id"`
	StepIndex *int      `json:"stepIndex,omitempty"`
	Status    string    `json:"status"`
	Error     string    `json:"error,omitempty"`
	Extracted string    `json:"extracted,omitempty"`
	Download  *Download `json:"download,omitempty"`
}

// Final reports whether this result closes the run rather than
// describing one step.
func (r Result) Final() bool { return r.StepIndex == nil }

// CodeNoBrowser is the stable handle a caller branches on when nothing
// is listening -- the one failure a user can actually fix, by pairing.
const CodeNoBrowser = "browser-not-connected"

// ErrNoBrowser is returned the moment a replay is asked for with no
// browser stream open, rather than waiting out a timeout that would
// tell the reader nothing.
func ErrNoBrowser() error {
	return usererror.New(CodeNoBrowser, "No browser is connected. Pair the Mill extension first.")
}

// CodeReplayFailed is the handle for a run the browser started and
// could not finish.
const CodeReplayFailed = "browser-replay-failed"

// ErrReplayFailed carries the browser's own reason for stopping. The
// reason is composed by the runner from the failing step, so it is
// already one user-facing sentence.
func ErrReplayFailed(sentence string) error {
	if !usererror.ValidMessage(sentence) {
		return usererror.New(CodeReplayFailed, "The browser couldn't finish the steps.")
	}
	return usererror.New(CodeReplayFailed, sentence)
}

// CodeReplayTimedOut is the handle for a browser that took the command
// and never reported back.
const CodeReplayTimedOut = "browser-replay-timed-out"

// ErrReplayTimedOut is the outcome when a connected browser accepts a
// run and stops answering -- distinct from ErrNoBrowser, because the
// fix is different: the tab, not the pairing.
func ErrReplayTimedOut() error {
	return usererror.New(CodeReplayTimedOut, "The browser stopped responding before the steps finished.")
}
