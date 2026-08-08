// Package connector holds the core-domain shape of an Integration/
// Connector (docs/SPEC.md §3.5): a reusable (1:many), Configure-authored
// definition of how to reach an external HTTP API. Per CLAUDE.md's
// core-domain rule, the shape and its validation stay hand-written --
// no library has an opinion on Mill's own connector model. The actual
// HTTP call is internal/adapters/httpconnector's job; the secret itself
// never lives on a Connector value at all, only in
// internal/adapters/credential (the OS keychain), keyed by Connector.ID.
package connector

import (
	"fmt"
	"strings"
)

// AuthType is how a request authenticates against the connector's
// BaseURL. Starts with the three docs/SPEC.md §3.5 names as in scope
// today; OAuth2/mTLS are real, named future work (§3.2's "incremental
// extensibility" principle -- add protocol/auth support when a real
// connector needs it, not speculatively), not stubbed here ahead of need.
type AuthType string

const (
	AuthNone   AuthType = "none"
	AuthAPIKey AuthType = "apikey"
	AuthBearer AuthType = "bearer"
)

// TypeHTTP is the one connector Type built today (§3.2: "build the
// generic HTTP connector first"). A DB/SOAP connector would add its own
// Type value here when a real need surfaces, not before.
const TypeHTTP = "http"

// Connector is one reusable, named way to reach an external API.
// Headers are static, always-sent headers (e.g. "Accept": "application/
// json") -- distinct from the AuthType-driven Authorization header,
// which internal/adapters/httpconnector adds itself from the resolved
// secret, never stored here.
type Connector struct {
	ID       string
	Label    string
	Type     string
	BaseURL  string
	AuthType AuthType
	Headers  map[string]string
	// OpenAPISpec is the raw OpenAPI 3.x document (JSON or YAML) this
	// connector's operations are declared against -- optional (ADR-0007).
	// Parsed via internal/adapters/openapispec. A Connector with no spec
	// behaves exactly as before this field existed.
	OpenAPISpec string
}

// Validate checks a Connector is well-formed before it's persisted --
// the same "never store an unconfigured/invalid value" discipline
// internal/domain/composition's ResolveNodeDefaults already applies to
// Nodes, applied here to Connectors.
func Validate(c Connector) error {
	if strings.TrimSpace(c.Label) == "" {
		return fmt.Errorf("a connector needs a label")
	}
	if c.Type != TypeHTTP {
		return fmt.Errorf("unsupported connector type: %q (only %q is supported today)", c.Type, TypeHTTP)
	}
	if strings.TrimSpace(c.BaseURL) == "" {
		return fmt.Errorf("a connector needs a base URL")
	}
	switch c.AuthType {
	case AuthNone, AuthAPIKey, AuthBearer:
	default:
		return fmt.Errorf("unsupported auth type: %q", c.AuthType)
	}
	return nil
}
