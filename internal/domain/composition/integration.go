package composition

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/alicoding/mill/internal/adapters/httpconnector"
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
	// OpenAPISpec is the connector's raw spec document, if any (ADR-0007
	// Phase 1). Empty for a Connector with none -- integration-http falls
	// back to its original literal path/method/bodyTemplate behavior in
	// that case (ADR-0007 Phase 3's own "strict superset, not a breaking
	// change" framing).
	OpenAPISpec string
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

func init() {
	RegisterNodeType(NodeType{
		ID: "integration-http", Kind: KindProcess,
		Label:       "Integration: HTTP call",
		Description: "Calls a Configure-authored connector's API and replaces the payload with the response body. connectorId isn't a closed FieldOptions set (unlike method below) because connectors are runtime, Configure-authored data composition.go has no compile-time knowledge of -- the frontend Inspector renders a live picker for it (RefKind, docs/adr/0009), not a closed option list composition.go could declare here.",
		ConfigFields: []ConfigField{
			{
				Key: "connectorId", Label: "Connector ID",
				Description: "The ID of a connector configured on the Configure page.",
				Default:     "", Type: FieldText, RefKind: "connector",
			},
			{
				Key: "path", Label: "Path",
				Description: "Appended to the connector's base URL, e.g. \"/v1/records\".",
				Default:     "", Type: FieldText,
			},
			{
				Key: "method", Label: "Method",
				Description: "HTTP method for this call.",
				Default:     http.MethodGet, Type: FieldOptions,
				Options: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch},
			},
			{
				Key: "bodyTemplate", Label: "Body",
				Description: "Optional request body (e.g. JSON), sent as-is.",
				Default:     "", Type: FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		rc, err := lookupConnectorFn(node.Config["connectorId"])
		if err != nil {
			return ctx, fmt.Errorf("integration-http: %w", err)
		}

		headers := make(map[string]string, len(rc.Headers)+1)
		for k, v := range rc.Headers {
			headers[k] = v
		}
		if k, v := authHeader(rc); k != "" {
			headers[k] = v
		}

		// ADR-0007 Phase 3: a connector with a spec and a node with
		// authored inputBindings uses the binding-resolution path
		// (bindingsRequest, attributebinding.go); everything else keeps
		// the original literal path/method/bodyTemplate behavior
		// unchanged -- a strict superset, not a breaking change.
		urlPath, body := node.Config["path"], node.Config["bodyTemplate"]
		if rc.OpenAPISpec != "" && node.Config["inputBindings"] != "" {
			resolvedPath, resolvedBody, resolvedHeaders, resolvedQuery, err := resolveInputBindings(rc.OpenAPISpec, node.Config, ctx.Attributes)
			if err != nil {
				return ctx, fmt.Errorf("integration-http: %w", err)
			}
			urlPath = resolvedPath
			if len(resolvedQuery) > 0 {
				urlPath += "?" + resolvedQuery.Encode()
			}
			body = resolvedBody
			for k, v := range resolvedHeaders {
				headers[k] = v
			}
		}

		resp, err := httpconnector.Execute(httpconnector.Request{
			Method:  node.Config["method"],
			URL:     strings.TrimRight(rc.BaseURL, "/") + urlPath,
			Headers: headers,
			Body:    body,
		})
		if err != nil {
			return ctx, fmt.Errorf("integration-http: %w", err)
		}
		// httpconnector deliberately treats every HTTP-level response
		// (4xx/5xx included) as a non-error return, same as net/http's own
		// client.Do -- the judgment call of what a status code means for
		// *this* workflow belongs here, at the domain layer, not in the
		// commodity adapter. Fail-safe by default (SPEC.md §8's guardrail
		// philosophy, already the reasoning httpconnector's own timeout
		// uses): a non-2xx response fails the node instead of silently
		// flowing an error body through as if it were a successful
		// result -- matches n8n's own HTTP Request node default (checked
		// directly, not assumed), which throws on 4xx/5xx unless the
		// author explicitly opts into "Continue on Fail". Mill has no
		// per-node continue-on-fail option yet; add one if a real
		// workflow needs to treat an error response as data, not before.
		if resp.StatusCode >= 400 {
			return ctx, fmt.Errorf("integration-http: request failed with status %d: %s", resp.StatusCode, resp.Body)
		}
		ctx.Payload = resp.Body
		if rc.OpenAPISpec != "" && node.Config["outputBindings"] != "" {
			if err := applyOutputBindings(node.Config["outputBindings"], resp.Body, &ctx); err != nil {
				return ctx, fmt.Errorf("integration-http: %w", err)
			}
		}
		return ctx, nil
	})
}
