package procexec

import (
	"io"
	"sync"
	"sync/atomic"
	"time"
)

// fanWriter is the single io.Writer both cmd.Stdout and cmd.Stderr are
// set to -- interleaving the two streams incrementally as they arrive,
// per Spec.Output's own contract. Using cmd.Stdout/cmd.Stderr writers
// (not StdoutPipe+a manual read loop) is deliberate: os/exec's own docs
// name the exact deadlock a manual StdoutPipe/Wait combination risks
// (Wait closes the pipe only after the reader has drained it, so a
// reader that blocks trying to also drain stderr through a second pipe
// can deadlock against a full stdout pipe buffer) -- setting Stdout/
// Stderr directly instead makes exec.Cmd itself run the copy goroutines
// and makes Wait correctly block until both are drained, sidestepping
// the whole class of bug.
//
// Every write also stamps lastOutputAt and pings notify -- the two
// pieces of state kill.go's watchIdle and Handle.LastOutputAt need, so
// idle-timeout tracking works even when Spec.Output is nil (out is
// then just a discard sink) and even under stdout+stderr writing
// concurrently (mu below serializes the two copy goroutines against
// each other so interleaved bytes never tear inside one Write call).
type fanWriter struct {
	mu  sync.Mutex
	out io.Writer // nil means discard -- output still tracked, just not sunk anywhere

	lastOutputAtNano atomic.Int64
	notify           chan struct{} // buffered 1, coalesced non-blocking signal for watchIdle
}

func newFanWriter(out io.Writer) *fanWriter {
	return &fanWriter{out: out, notify: make(chan struct{}, 1)}
}

func (w *fanWriter) Write(p []byte) (int, error) {
	w.lastOutputAtNano.Store(time.Now().UnixNano())
	select {
	case w.notify <- struct{}{}:
	default:
		// a pending signal watchIdle hasn't consumed yet already
		// covers this write -- coalescing, not dropping information
		// watchIdle cares about (it only cares "did output happen
		// since I last checked", not how many times).
	}

	if w.out == nil {
		return len(p), nil
	}

	w.mu.Lock()
	defer w.mu.Unlock()
	return w.out.Write(p)
}

// LastOutputAt returns the timestamp of the most recent Write, or the
// zero time if none has happened yet.
func (w *fanWriter) LastOutputAt() time.Time {
	n := w.lastOutputAtNano.Load()
	if n == 0 {
		return time.Time{}
	}
	return time.Unix(0, n)
}
