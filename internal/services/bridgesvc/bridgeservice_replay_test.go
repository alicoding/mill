package bridgesvc_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/bridgesvc"
)

// What a workflow step needs from a replay, beyond "did it finish":
// every step's own result, and a budget the caller sets. Split from
// bridgeservice_test.go along that seam (the 500-line convention); the
// shared harness (newService, openStream, readCommand, postResult)
// stays there, in the same test package.

// TestReplay_CarriesEveryStepResultInOrder pins the half a workflow
// step depends on: results arrive on their own POSTs, in whatever order
// the browser sends them, and the outcome must still report each step
// once, in the flow's own order, with what it extracted.
func TestReplay_CarriesEveryStepResultInOrder(t *testing.T) {
	svc, srv := newService(t, &stubAuth{token: "good"})
	stream, stop := openStream(t, srv)
	defer stop()
	waitForBrowsers(t, svc)

	type outcome struct {
		out bridgesvc.Outcome
		err error
	}
	results := make(chan outcome, 1)
	go func() {
		out, err := svc.Replay(context.Background(), browserbridge.TestFlow(srv.URL+bridgesvc.TestPagePath), bridgesvc.ReplayOptions{})
		results <- outcome{out, err}
	}()

	command := readCommand(t, stream)
	// Deliberately out of order, and with a download attached to the
	// last step.
	second, first, third := 1, 0, 2
	postResult(t, srv, "good", browserbridge.Result{ID: command.ID, StepIndex: &second, Status: browserbridge.StatusOK, Extracted: "Connected"})
	postResult(t, srv, "good", browserbridge.Result{ID: command.ID, StepIndex: &first, Status: browserbridge.StatusOK})
	postResult(t, srv, "good", browserbridge.Result{ID: command.ID, StepIndex: &third, Status: browserbridge.StatusSkipped,
		Download: &browserbridge.Download{Path: "/tmp/export.csv", Filename: "export.csv", Bytes: 9}})
	postResult(t, srv, "good", browserbridge.Result{ID: command.ID, Status: browserbridge.StatusDone})

	select {
	case got := <-results:
		if got.err != nil {
			t.Fatalf("Replay() = %v, want nil error", got.err)
		}
		if len(got.out.Results) != 3 {
			t.Fatalf("Replay() results = %+v, want one row per reported step", got.out.Results)
		}
		for i, r := range got.out.Results {
			if r.Index != i {
				t.Fatalf("results[%d].Index = %d, want the flow's own order", i, r.Index)
			}
		}
		if got.out.Results[1].Extracted != "Connected" {
			t.Errorf("results[1].Extracted = %q, want the text the step read back", got.out.Results[1].Extracted)
		}
		if got.out.Results[2].Status != browserbridge.StatusSkipped {
			t.Errorf("results[2].Status = %q, want the skipped status reported", got.out.Results[2].Status)
		}
		if len(got.out.Downloads) != 1 || got.out.Downloads[0].Filename != "export.csv" {
			t.Errorf("Replay() downloads = %+v, want the file the browser saved", got.out.Downloads)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("Replay() never returned after the final result")
	}
}

// TestReplay_HonoursTheCallersTimeout pins that a step's own budget
// bounds the run, and that the sentence names it -- the default is two
// minutes, far longer than this test would wait.
func TestReplay_HonoursTheCallersTimeout(t *testing.T) {
	svc, srv := newService(t, &stubAuth{token: "good"})
	stream, stop := openStream(t, srv)
	defer stop()
	waitForBrowsers(t, svc)

	errs := make(chan error, 1)
	go func() {
		// A browser that takes the command and never answers.
		_, err := svc.Replay(context.Background(), browserbridge.TestFlow(srv.URL+bridgesvc.TestPagePath),
			bridgesvc.ReplayOptions{Timeout: 300 * time.Millisecond})
		errs <- err
	}()
	readCommand(t, stream)

	select {
	case err := <-errs:
		var declared *usererror.Error
		if !errors.As(err, &declared) || declared.Code != browserbridge.CodeReplayTimedOut {
			t.Fatalf("Replay() error = %v, want code %q", err, browserbridge.CodeReplayTimedOut)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("Replay() ignored the caller's timeout")
	}
}

// TestReplay_CancelledRunStopsWaiting pins that a stopped workflow run
// releases the replay rather than holding it for the whole budget.
func TestReplay_CancelledRunStopsWaiting(t *testing.T) {
	svc, srv := newService(t, &stubAuth{token: "good"})
	stream, stop := openStream(t, srv)
	defer stop()
	waitForBrowsers(t, svc)

	ctx, cancel := context.WithCancel(context.Background())
	errs := make(chan error, 1)
	go func() {
		_, err := svc.Replay(ctx, browserbridge.TestFlow(srv.URL+bridgesvc.TestPagePath), bridgesvc.ReplayOptions{Timeout: time.Minute})
		errs <- err
	}()
	readCommand(t, stream)
	cancel()

	select {
	case err := <-errs:
		var declared *usererror.Error
		if !errors.As(err, &declared) || declared.Code != browserbridge.CodeReplayTimedOut {
			t.Fatalf("Replay() error = %v, want code %q", err, browserbridge.CodeReplayTimedOut)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("Replay() kept waiting after its context was cancelled")
	}
}
