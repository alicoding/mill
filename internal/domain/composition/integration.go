package composition

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/alicoding/mill/internal/adapters/httpconnector"
	"github.com/alicoding/mill/internal/adapters/openapispec"
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
	// Auth is the non-secret config for AuthOAuth2/AuthHMAC/AuthOAuth1
	// (ADR-0015) -- nil for the three original AuthTypes.
	Auth *connector.AuthConfig
}

// AuthStrategy mutates an in-progress request (headers/query, both
// passed by reference) according to one AuthType's scheme -- ADR-0015's
// extension point, replacing the old fixed "return one header" shape.
// method/path/body are given (not mutated) since HMAC/OAuth 1.0a sign
// over them; a strategy with nothing to sign (AuthAPIKey/AuthBearer)
// simply ignores those params.
type AuthStrategy func(rc ResolvedConnector, method, path string, headers map[string]string, query url.Values, body string) error

var authStrategies = map[connector.AuthType]AuthStrategy{}

// RegisterAuthStrategy is ADR-0015's self-registration seam, the same
// shape ADR-0006 already established and verified for NodeTypes/
// Triggers -- each AuthType's strategy lives in its own small file,
// registered via init(), so adding a new AuthType (mTLS included) is a
// pure addition, never a change to an existing strategy's file.
func RegisterAuthStrategy(t connector.AuthType, fn AuthStrategy) {
	authStrategies[t] = fn
}

// ApplyAuth dispatches to rc.AuthType's registered strategy. AuthNone
// (or any AuthType with no registered strategy, which shouldn't happen
// for a Validate-passed Connector) is a no-op, matching the original
// AuthHeader switch's own default case.
func ApplyAuth(rc ResolvedConnector, method, path string, headers map[string]string, query url.Values, body string) error {
	fn, ok := authStrategies[rc.AuthType]
	if !ok {
		return nil
	}
	return fn(rc, method, path, headers, query, body)
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
		query := url.Values{}

		// ADR-0007 Phase 3 (extended by ADR-0011's output Path support):
		// a connector with a spec and a node with authored input or
		// output bindings uses the binding-resolution path
		// (attributebinding.go); everything else keeps the original
		// literal path/method/bodyTemplate behavior unchanged -- a
		// strict superset, not a breaking change. Triggered by either
		// binding being set (not just inputBindings) so an
		// output-only-bound node still gets outputFields resolved for
		// its Path lookups below.
		urlPath, body := node.Config["path"], node.Config["bodyTemplate"]
		var outputFields []openapispec.Field
		var responseExtractPath string
		if rc.OpenAPISpec != "" && (node.Config["inputBindings"] != "" || node.Config["outputBindings"] != "") {
			resolvedPath, resolvedBody, resolvedHeaders, resolvedQuery, fields, respExtractPath, err := resolveInputBindings(rc.OpenAPISpec, node.Config, ctx.Attributes)
			if err != nil {
				return ctx, fmt.Errorf("integration-http: %w", err)
			}
			urlPath = resolvedPath
			for k, v := range resolvedQuery {
				query[k] = v
			}
			body = resolvedBody
			for k, v := range resolvedHeaders {
				headers[k] = v
			}
			outputFields = fields
			responseExtractPath = respExtractPath
		}

		// ADR-0015: auth applied last, after bindings, so a scheme that
		// signs the request (HMAC/OAuth 1.0a) signs the final
		// path/body -- and so AuthQueryParam's own query addition can't
		// be silently dropped by a bindings-resolved query already
		// having been encoded into urlPath (query stays unencoded until
		// the URL is assembled below, for exactly this reason).
		if err := ApplyAuth(rc, node.Config["method"], urlPath, headers, query, body); err != nil {
			return ctx, fmt.Errorf("integration-http: %w", err)
		}

		fullURL := strings.TrimRight(rc.BaseURL, "/") + urlPath
		if len(query) > 0 {
			fullURL += "?" + query.Encode()
		}

		resp, err := httpconnector.Execute(httpconnector.Request{
			Method:  node.Config["method"],
			URL:     fullURL,
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
			if err := applyOutputBindings(node.Config["outputBindings"], resp.Body, responseExtractPath, outputFields, &ctx); err != nil {
				return ctx, fmt.Errorf("integration-http: %w", err)
			}
		}
		return ctx, nil
	})
}
