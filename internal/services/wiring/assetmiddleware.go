package wiring

import (
	"net/http"

	"github.com/alicoding/mill/internal/adapters/buildinfo"
	"github.com/alicoding/mill/internal/services/remoteauthsvc"
)

// AssetMiddleware returns the remote-access gate for a server build and
// a pass-through otherwise.
//
// A desktop build serves its assets in-process to its own webview --
// there is no listening socket for anything else to reach, so the gate
// protects nothing there. Wails substitutes a placeholder RemoteAddr
// for such a request, which is correctly not loopback, so arming the
// gate made it challenge the app against itself, with no code able to
// exist to answer (BootstrapPairingCode only mints in server mode).
//
// Decided here, at the wiring site, rather than by recognising that
// placeholder address: it is an internal detail of the toolkit, not a
// contract to depend on. remoteauthsvc.Middleware itself stays
// build-agnostic and fully tested.
func AssetMiddleware(remoteAuth *remoteauthsvc.RemoteAuthService) func(http.Handler) http.Handler {
	if !buildinfo.Read().Server {
		return func(next http.Handler) http.Handler { return next }
	}
	return remoteAuth.Middleware()
}
