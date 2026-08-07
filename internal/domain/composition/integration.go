package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/connector"
)

// ResolvedConnector is a Connector's config plus its decrypted secret,
// assembled by whatever owns Connector storage at request time.
// composition.go doesn't own connector persistence or the OS keychain
// (ConfigureService/internal/adapters/credential do) -- same seam
// TriggerService uses via a Syncer interface for workflow data -- so
// this is injected once via SetConnectorLookup instead of composition
// depending on ConfigureService directly.
type ResolvedConnector struct {
	BaseURL  string
	AuthType connector.AuthType
	Headers  map[string]string
	Secret   string
}

// lookupConnectorFn defaults to erroring so an integration-http node run
// before ConfigureService exists (or before SetConnectorLookup wires it)
// fails loudly instead of silently no-op'ing.
var lookupConnectorFn = func(connectorID string) (ResolvedConnector, error) {
	return ResolvedConnector{}, fmt.Errorf("no connector lookup registered (yet) for id %q", connectorID)
}

// SetConnectorLookup wires the function integration-http nodes use to
// resolve a connectorId into its base URL/auth/secret. Called once from
// main.go once ConfigureService exists.
func SetConnectorLookup(fn func(connectorID string) (ResolvedConnector, error)) {
	lookupConnectorFn = fn
}

// authHeader turns a ResolvedConnector's AuthType + Secret into the one
// header its scheme implies -- AuthAPIKey and AuthBearer are the two
// docs/SPEC.md §3.5 auth types with a real request-time effect, AuthNone
// adds nothing. The header names chosen (X-Api-Key, Authorization:
// Bearer) are the common default for each scheme; a vendor needing a
// different header name is real future work (§3.2's incremental-
// extensibility principle), not solved speculatively here.
func authHeader(rc ResolvedConnector) (key, value string) {
	switch rc.AuthType {
	case connector.AuthAPIKey:
		return "X-Api-Key", rc.Secret
	case connector.AuthBearer:
		return "Authorization", "Bearer " + rc.Secret
	default:
		return "", ""
	}
}
