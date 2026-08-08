// Package oauth2client wraps golang.org/x/oauth2/clientcredentials
// behind Mill's own name (ADR-0015), matching the ports/adapters
// pattern internal/adapters/httpconnector already establishes for a
// commodity HTTP client that needs its own package-level state (a
// shared *http.Client there, a token-source cache here) -- that state
// belongs in an adapter, not in internal/domain/composition directly
// (.claude/rules/backend.md: domain packages stay pure, no state).
package oauth2client

import (
	"context"
	"fmt"
	"sync"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"
)

// tokenSources caches one oauth2.TokenSource per (clientID, tokenURL)
// pair, across calls -- oauth2.TokenSource already handles fetch +
// in-memory caching + refresh-on-expiry internally (golang.org/x/oauth2's
// own documented behavior), but only if the *same* TokenSource instance
// is reused; a fresh clientcredentials.Config per call would fetch a
// brand-new token every single request, defeating the point of a cache
// Mill didn't have to hand-roll itself.
var (
	tokenSourcesMu sync.Mutex
	tokenSources   = map[string]oauth2.TokenSource{}
)

// Token fetches (or reuses a cached, still-valid) client_credentials
// token for the given client/token-URL/scope, returning its type
// ("Bearer") and access token value ready to place in an Authorization
// header.
func Token(clientID, clientSecret, tokenURL, scope string) (tokenType, accessToken string, err error) {
	key := clientID + "|" + tokenURL

	tokenSourcesMu.Lock()
	ts, ok := tokenSources[key]
	if !ok {
		cfg := &clientcredentials.Config{ClientID: clientID, ClientSecret: clientSecret, TokenURL: tokenURL}
		if scope != "" {
			cfg.Scopes = []string{scope}
		}
		ts = cfg.TokenSource(context.Background())
		tokenSources[key] = ts
	}
	tokenSourcesMu.Unlock()

	token, err := ts.Token()
	if err != nil {
		return "", "", fmt.Errorf("oauth2client: fetch token: %w", err)
	}
	return token.Type(), token.AccessToken, nil
}
