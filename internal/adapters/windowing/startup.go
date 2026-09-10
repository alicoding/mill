package windowing

import (
	"net/http"
	"sync"
)

// StartupCoordinates owns the callbacks application.New needs before services
// and the main window are ready.
type StartupCoordinates struct {
	mu              sync.RWMutex
	shouldQuit      func() bool
	assetMiddleware func(http.Handler) http.Handler
	activate        func()
	pendingActivate bool
}

// NewStartupCoordinates returns a fail-closed startup coordinator.
func NewStartupCoordinates() *StartupCoordinates { return &StartupCoordinates{} }

// ShouldQuit permits shutdown before Settings is ready, then delegates every
// later quit to the Settings leave handshake.
func (s *StartupCoordinates) ShouldQuit() bool {
	s.mu.RLock()
	fn := s.shouldQuit
	s.mu.RUnlock()
	if fn == nil {
		return true
	}
	return fn()
}

// SetShouldQuit attaches the Settings quit gate.
func (s *StartupCoordinates) SetShouldQuit(fn func() bool) {
	s.mu.Lock()
	s.shouldQuit = fn
	s.mu.Unlock()
}

// AssetMiddleware returns 503 until the service-dependent middleware is ready.
func (s *StartupCoordinates) AssetMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
		s.mu.RLock()
		middleware := s.assetMiddleware
		s.mu.RUnlock()
		if middleware == nil {
			http.Error(rw, "Service Unavailable", http.StatusServiceUnavailable)
			return
		}
		middleware(next).ServeHTTP(rw, req)
	})
}

// SetAssetMiddleware makes the fully wired asset path available.
func (s *StartupCoordinates) SetAssetMiddleware(fn func(http.Handler) http.Handler) {
	s.mu.Lock()
	s.assetMiddleware = fn
	s.mu.Unlock()
}

// RequestActivation restores the ready main window, or coalesces startup
// requests into one activation when AttachActivation runs.
func (s *StartupCoordinates) RequestActivation() {
	s.mu.Lock()
	fn := s.activate
	if fn == nil {
		s.pendingActivate = true
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()
	fn()
}

// AttachActivation installs the window callback and flushes one coalesced
// startup activation after releasing the state lock.
func (s *StartupCoordinates) AttachActivation(fn func()) {
	s.mu.Lock()
	s.activate = fn
	pending := s.pendingActivate
	s.pendingActivate = false
	s.mu.Unlock()
	if pending {
		fn()
	}
}
