package wiring

import (
	"net/http"
	"os"
	"strings"
)

// The document Content-Security-Policy (docs/platform/PLUGIN-THREAT-
// MODEL.md, T9): a plugin's JS already runs in Mill's document, so no
// header can wall it off from the DOM -- what this one does is stop
// the escalation from "a div of its own" to "any script in Mill's
// origin": no remote script, no eval, no inline handlers injected
// through markup, no plugin embeds. Styles stay inline-capable (the
// canvas and the engines set style attributes from JS). The iframed
// vendored viewers under /vendor/ are their own documents with their
// own policy (pdf.js ships one; draw.io's editor needs eval and is
// recorded, not covered) and are left out. The dev loop is left out
// too: Vite's React refresh preamble is an inline script.
const contentSecurityPolicy = "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; " +
	"style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; " +
	"connect-src 'self' ws: wss:; worker-src 'self' blob:; frame-src 'self'"

// ContentSecurityPolicy returns the policy the middleware sets ("" when
// the dev loop is running).
func ContentSecurityPolicy() string {
	if os.Getenv("FRONTEND_DEVSERVER_URL") != "" {
		return ""
	}
	return contentSecurityPolicy
}

// CSPMiddleware sets the document policy on every response except the
// vendored viewers' own documents.
func CSPMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if policy := ContentSecurityPolicy(); policy != "" && !strings.HasPrefix(r.URL.Path, "/vendor/") {
				w.Header().Set("Content-Security-Policy", policy)
			}
			next.ServeHTTP(w, r)
		})
	}
}
