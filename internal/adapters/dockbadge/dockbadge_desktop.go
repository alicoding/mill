//go:build !server

package dockbadge

import (
	"context"
	"strconv"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/dock"
)

var (
	svc     = dock.New()
	startup sync.Once
)

// ensureStarted runs dock.New()'s own Startup exactly once, lazily on
// first real Set call rather than at package-import time (an unused
// import shouldn't have side effects) -- every platform's Startup is a
// genuine no-op or best-effort setup, never a network call or anything
// that can meaningfully fail in a way worth surfacing, so the error is
// intentionally discarded (unlike notify.Start, which gates a real
// bundle-ID/delegate handshake callers must observe the error of).
func ensureStarted() {
	startup.Do(func() {
		_ = svc.ServiceStartup(context.Background(), application.ServiceOptions{})
	})
}

// Set applies count as the dock badge, clearing it (RemoveBadge) at
// zero -- SetBadge's own doc comment notes an empty string renders as
// the indeterminate "●" dot, so a real digit string is always passed
// here instead.
func Set(count int) error {
	ensureStarted()
	if count <= 0 {
		return svc.RemoveBadge()
	}
	return svc.SetBadge(strconv.Itoa(count))
}
