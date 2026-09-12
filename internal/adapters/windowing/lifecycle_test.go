package windowing

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

type lifecycleApp struct {
	onShutdown func()
	run        func(*lifecycleApp) error
}

func (a *lifecycleApp) OnShutdown(shutdown func()) { a.onShutdown = shutdown }

func (a *lifecycleApp) Run() error { return a.run(a) }

func TestRunWithShutdownRegistersBeforeRunAndRunsOnce(t *testing.T) {
	var calls atomic.Int32
	app := &lifecycleApp{run: func(app *lifecycleApp) error {
		if app.onShutdown == nil {
			t.Fatal("Run started before shutdown was registered")
		}
		app.onShutdown()
		return nil
	}}

	if err := RunWithShutdown(app, func() { calls.Add(1) }); err != nil {
		t.Fatal(err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("shutdown calls = %d, want 1", got)
	}
}

func TestRunWithShutdownUsesReturnAndErrorFallback(t *testing.T) {
	wantErr := errors.New("startup failed")
	for _, tc := range []struct {
		name string
		err  error
	}{
		{name: "clean return"},
		{name: "run error", err: wantErr},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			app := &lifecycleApp{run: func(*lifecycleApp) error { return tc.err }}
			gotErr := RunWithShutdown(app, func() { calls++ })
			if !errors.Is(gotErr, tc.err) {
				t.Fatalf("RunWithShutdown() error = %v, want %v", gotErr, tc.err)
			}
			if calls != 1 {
				t.Fatalf("shutdown calls = %d, want 1", calls)
			}
		})
	}
}

func TestRunWithShutdownCoalescesConcurrentNativeRequests(t *testing.T) {
	var calls atomic.Int32
	app := &lifecycleApp{run: func(app *lifecycleApp) error {
		const requestCount = 16
		var requests sync.WaitGroup
		requests.Add(requestCount)
		for range requestCount {
			go func() {
				defer requests.Done()
				app.onShutdown()
			}()
		}
		requests.Wait()
		app.onShutdown()
		return nil
	}}

	if err := RunWithShutdown(app, func() { calls.Add(1) }); err != nil {
		t.Fatal(err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("shutdown calls = %d, want 1", got)
	}
}
