package composition

import (
	"github.com/alicoding/mill/internal/domain/guardrail"

	"fmt"
	"net/url"
	"strings"

	"github.com/alicoding/mill/internal/adapters/openapispec"
	"github.com/alicoding/mill/internal/domain/httprequest"
)

// ResolvedHTTPRequest is an HTTPRequest's config plus its decrypted secret,
// assembled by whatever owns HTTPRequest storage at request time.
// composition.go doesn't own request persistence or the OS keychain
// (ConfigureService/internal/adapters/credential do) -- same seam
// TriggerService uses via a Syncer interface for workflow data -- so
// this is injected once via SetHTTPRequestLookup instead of composition
// depending on ConfigureService directly.
type ResolvedHTTPRequest struct {
	BaseURL string
	// Method is the request's own HTTP method (ADR-0016 Phase B) --
	// used when the integration-http node's own method config is blank;
	// empty here too means GET.
	Method string
	// Body is the request's own raw body, sent as-is when neither the
	// schema's bound body fields nor a legacy node-level bodyTemplate
	// produce one -- transport/payload config lives on the request, not
	// the workflow node.
	Body     string
	AuthType httprequest.AuthType
	// Headers is already fully resolved (any "vault:<id>" reference
	// substituted for its real value) by whatever set
	// lookupHTTPRequestFn -- this package never sees or interprets a
	// vault reference itself, same "composition never resolves a
	// secret out of Node.Config" boundary ResolvedMCPServer.Env's own
	// doc comment states (.claude/rules/node-standard.md's credential
	// rule).
	Headers map[string]string
	Secret  string
	// OpenAPISpec is the request's raw spec document, if any (ADR-0007
	// Phase 1). Empty for an HTTPRequest with none -- integration-http falls
	// back to its original literal path/method/bodyTemplate behavior in
	// that case (ADR-0007 Phase 3's own "strict superset, not a breaking
	// change" framing).
	OpenAPISpec string
	// Auth is the non-secret config for AuthOAuth2/AuthHMAC/AuthOAuth1
	// (ADR-0015) -- nil for the three original AuthTypes.
	Auth *httprequest.AuthConfig
	// JOSE is Phase 3's optional request/response encryption layer --
	// nil for a request not using it. Independent of Auth (see
	// httprequest.JOSEConfig's own doc comment).
	JOSE *httprequest.JOSEConfig
	// JOSEPrivateKeyPEM is Mill's own private key, resolved from the OS
	// keychain only when JOSE.DecryptResponse is true -- empty
	// otherwise, same "skip the fetch when there's nothing to fetch"
	// shape AuthNone already has for the Auth secret.
	JOSEPrivateKeyPEM string
}

// AuthStrategy mutates an in-progress request (headers/query, both
// passed by reference) according to one AuthType's scheme -- ADR-0015's
// extension point, replacing the old fixed "return one header" shape.
// method/path/body are given (not mutated) since HMAC/OAuth 1.0a sign
// over them; a strategy with nothing to sign (AuthAPIKey/AuthBearer)
// simply ignores those params.
type AuthStrategy func(rc ResolvedHTTPRequest, method, path string, headers map[string]string, query url.Values, body string) error

var authStrategies = map[httprequest.AuthType]AuthStrategy{}

// RegisterAuthStrategy is ADR-0015's self-registration seam, the same
// shape ADR-0006 already established and verified for NodeTypes/
// Triggers -- each AuthType's strategy lives in its own small file,
// registered via init(), so adding a new AuthType (mTLS included) is a
// pure addition, never a change to an existing strategy's file.
//
// Documented divergence from its two siblings (RegisterNodeType,
// RegisterTrigger): this map assignment silently overwrites on a
// duplicate AuthType instead of panicking -- neither behavior was a
// deliberate choice recorded anywhere before this comment, it's simply
// what a bare map write does. Not a bug fix, since nothing depends on
// either behavior today (every AuthType strategy registers exactly
// once, from this repo's own init() files) -- but a future extension
// point that wants a registry to support intentional substitution
// should decide that on purpose, not inherit whichever of these two
// shapes it happened to copy from.
func RegisterAuthStrategy(t httprequest.AuthType, fn AuthStrategy) {
	authStrategies[t] = fn
}

// ApplyAuth dispatches to rc.AuthType's registered strategy. AuthNone
// (or any AuthType with no registered strategy, which shouldn't happen
// for a Validate-passed HTTPRequest) is a no-op, matching the original
// AuthHeader switch's own default case.
func ApplyAuth(rc ResolvedHTTPRequest, method, path string, headers map[string]string, query url.Values, body string) error {
	fn, ok := authStrategies[rc.AuthType]
	if !ok {
		return nil
	}
	return fn(rc, method, path, headers, query, body)
}

// lookupHTTPRequestFn defaults to erroring so an integration-http node run
// before ConfigureService exists (or before SetHTTPRequestLookup wires it)
// fails loudly instead of silently no-op'ing.
var lookupHTTPRequestFn = func(requestID string) (ResolvedHTTPRequest, error) {
	return ResolvedHTTPRequest{}, fmt.Errorf("no request lookup registered (yet) for id %q", requestID)
}

// SetHTTPRequestLookup wires the function integration-http nodes use to
// resolve a requestId into its base URL/auth/secret. Called once from
// main.go once ConfigureService exists.
func SetHTTPRequestLookup(fn func(requestID string) (ResolvedHTTPRequest, error)) {
	lookupHTTPRequestFn = fn
}

// JoinRequestURL assembles the request URL from the integration's own
// URL field and an operation path. One URL is the mental model (decided
// directly with the user: base-URL-here + endpoint-path-there was
// disorienting): a new-style integration's URL is COMPLETE (path,
// {param} templates and all) and its single operation's path is the
// synthesized "/" placeholder, which appends nothing; a legacy
// integration (base-only URL + a real per-operation path) still joins
// exactly as before. A genuine root-path call is byte-equivalent
// either way.
func JoinRequestURL(base, path string) string {
	if path == "" || path == "/" {
		return base
	}
	return strings.TrimRight(base, "/") + path
}

// singleOperation returns the one operation a request's spec declares,
// when it declares exactly one -- the 1:1 request:operation model
// (ADR-0016's Update 2) makes this the normal case, and it's what lets
// the workflow node stop asking for path/method at all: the endpoint
// is the integration's own declaration. A legacy multi-operation spec
// returns ok=false, falling back to the node's own persisted
// path/method config.
func singleOperation(specDoc string) (path, method string, ok bool) {
	doc, err := openapispec.Parse([]byte(specDoc))
	if err != nil {
		return "", "", false
	}
	ops := doc.Operations()
	if len(ops) != 1 {
		return "", "", false
	}
	return ops[0].Path, ops[0].Method, true
}

func init() {
	RegisterNodeType(NodeType{
		ID: "integration-http", Kind: KindProcess,
		Effect:      guardrail.ClassExternal,
		Complexity:  ComplexityAdvanced, // binding path/query/header/body values needs the integration's own API contract
		Consumes:    []PayloadKind{PayloadAny},
		Produces:    PayloadProduce{Kind: PayloadAny},
		Output:      "HTTP response body",
		Label:       "Call an API",
		Description: "Calls a Configure-authored integration's API and replaces the payload with the response body. The step only picks WHICH integration and binds data -- method, endpoint path, and body all live on the integration itself (Configure > Integration): transport configuration belongs on the integration, not the workflow step. Legacy steps saved with their own path/method/bodyTemplate config keep working (those keys still win when present); they're just no longer authorable here.",
		ConfigFields: []ConfigField{
			{
				Key: "requestId", Label: "Integration",
				Description: "Which Configure-authored integration this step calls.",
				Default:     "", Type: FieldText, RefKind: "request",
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		rc, err := lookupHTTPRequestFn(node.Config["requestId"])
		if err != nil {
			return ctx, fmt.Errorf("integration-http: %w", err)
		}

		// Method/path/body all come from the integration itself now --
		// the node stopped asking for them (its ConfigFields above).
		// Precedence keeps every legacy node working: a persisted node
		// config value wins, then the request's own declaration (its
		// Method/Body fields, and its single declared operation's path),
		// then GET/empty (defaultMethodAndPath, httpsend.go).
		body := node.Config["bodyTemplate"]
		if body == "" {
			body = rc.Body
		}
		if body == "" {
			// No body configured anywhere -- neither the node's own legacy
			// override nor the integration's static Body field -- forward
			// whatever payload flowed into this step verbatim, so a step
			// whose whole job is "send what I was given" (docs/adr/0035's
			// trigger-system-event forward example: the trigger's JSON
			// event becomes this call's body) doesn't need a templating
			// mechanism just to pass its input through. Backward-
			// compatible: every existing seed reaching this node starts
			// from an empty trigger-manual payload, so this produces the
			// same empty body as before for all of them.
			body = ctx.Payload
		}
		method, urlPath := defaultMethodAndPath(rc, node.Config["method"], node.Config["path"])

		headers := make(map[string]string, len(rc.Headers)+1)
		for k, v := range rc.Headers {
			headers[k] = v
		}
		query := url.Values{}

		// ADR-0007 Phase 3 (extended by ADR-0011's output Path support):
		// a request with a spec and a node with authored input or
		// output bindings uses the binding-resolution path
		// (attributebinding.go), against the path/method already
		// resolved above (node override, else the request's own
		// declaration). Triggered by either binding being set (not just
		// inputBindings) so an output-only-bound node still gets
		// outputFields resolved for its Path lookups below.
		var outputFields []openapispec.Field
		var responseExtractPath string
		pathParams := map[string]string{}
		if rc.OpenAPISpec != "" && (node.Config["inputBindings"] != "" || node.Config["outputBindings"] != "") {
			resolvedPath, resolvedBody, resolvedHeaders, resolvedQuery, resolvedPathParams, fields, respExtractPath, err := resolveInputBindings(rc.OpenAPISpec, node.Config, ctx.Attributes, urlPath, method)
			if err != nil {
				return ctx, fmt.Errorf("integration-http: %w", err)
			}
			urlPath = resolvedPath
			pathParams = resolvedPathParams
			for k, v := range resolvedQuery {
				query[k] = v
			}
			if resolvedBody != "" {
				body = resolvedBody
			}
			for k, v := range resolvedHeaders {
				headers[k] = v
			}
			outputFields = fields
			responseExtractPath = respExtractPath
		}

		// The shared transport tail (httpsend.go, docs/adr/0027): JOSE-
		// encrypt, apply auth (ADR-0015, signs the final path/body),
		// assemble the URL (path params + query), call httpconnector,
		// fail-safe on non-2xx (SPEC.md §8), JOSE-decrypt the response.
		// Same sequence this file always ran inline; decision-outcome's
		// webhook call now goes through the identical function.
		respBody, err := sendHTTPRequest(rc, method, urlPath, body, headers, query, pathParams)
		if err != nil {
			return ctx, fmt.Errorf("integration-http: %w", err)
		}
		ctx.Payload = respBody
		if rc.OpenAPISpec != "" && node.Config["outputBindings"] != "" {
			if err := applyOutputBindings(node.Config["outputBindings"], respBody, responseExtractPath, outputFields, &ctx); err != nil {
				return ctx, fmt.Errorf("integration-http: %w", err)
			}
		}
		return ctx, nil
	})
}
