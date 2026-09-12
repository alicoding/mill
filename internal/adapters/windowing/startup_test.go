package windowing

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
)

func TestStartupCoordinatesAssetMiddlewareFailsClosedUntilReady(t *testing.T) {
	startup := NewStartupCoordinates()
	next := http.HandlerFunc(func(rw http.ResponseWriter, _ *http.Request) {
		rw.WriteHeader(http.StatusNoContent)
	})
	handler := startup.AssetMiddleware(next)

	early := httptest.NewRecorder()
	handler.ServeHTTP(early, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil))
	if early.Code != http.StatusServiceUnavailable {
		t.Fatalf("early status = %d, want 503", early.Code)
	}

	startup.SetAssetMiddleware(func(next http.Handler) http.Handler { return next })
	ready := httptest.NewRecorder()
	handler.ServeHTTP(ready, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil))
	if ready.Code != http.StatusNoContent {
		t.Fatalf("ready status = %d, want 204", ready.Code)
	}
}

func TestStartupCoordinatesQuitDelegate(t *testing.T) {
	startup := NewStartupCoordinates()
	if !startup.ShouldQuit() {
		t.Fatal("ShouldQuit() before Settings is ready = false, want true")
	}
	startup.SetShouldQuit(func() bool { return false })
	if startup.ShouldQuit() {
		t.Fatal("ShouldQuit() after attachment = true, want delegated false")
	}
}

func TestStartupCoordinatesCoalescesActivationUntilAttached(t *testing.T) {
	startup := NewStartupCoordinates()
	const callers = 20
	var wg sync.WaitGroup
	for range callers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			startup.RequestActivation()
		}()
	}
	wg.Wait()

	var calls atomic.Int32
	startup.AttachActivation(func() { calls.Add(1) })
	if got := calls.Load(); got != 1 {
		t.Fatalf("startup activation calls = %d, want 1", got)
	}
	startup.RequestActivation()
	if got := calls.Load(); got != 2 {
		t.Fatalf("ready activation calls = %d, want 2", got)
	}
}
