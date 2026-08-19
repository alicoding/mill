package configuresvc

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/openapispec"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// This file owns HTTPRequest CRUD/persistence -- split out of
// configureservice.go once ADR-0015's Auth-catalogue work (an added
// Auth *httprequest.AuthConfig param on Create/UpdateHTTPRequest, plus
// the OAuth1 dual-secret convenience method below) would have pushed
// that file past the 500-line limit (scripts/check-loc.sh). Mirrors
// the configureservice_requesttest.go split
// -- same file, same *ConfigureService receiver, just organized by
// concern rather than piled into one file. Lists/Attributes/restore
// stay in configureservice.go. Renamed from configureservice_
// connectorauth.go by ADR-0016 (Connector -> HTTPRequest).

// joseKeychainID namespaces JOSE's own private-key secret under a
// second, distinct keychain entry per request -- a request can combine
// JOSE with any AuthType (httprequest.JOSEConfig's own doc comment:
// independent, additive layers), so JOSE's private key can't share the
// same c.credentials.Set(id, ...) slot AuthType's own secret already uses
// without one silently overwriting the other.
func joseKeychainID(id string) string {
	return id + ":jose"
}

// resolveHTTPRequest implements composition.go's lookupHTTPRequestFn
// seam: find the HTTPRequest, fetch its secret from the OS keychain
// (skipped entirely for AuthNone -- there's nothing to fetch), return
// both as a composition.ResolvedHTTPRequest. Unexported, so Wails never
// binds it as a callable frontend method -- it's Go-internal wiring
// only, same as CompositionService's SetSyncer.
func (c *ConfigureService) resolveHTTPRequest(id string) (composition.ResolvedHTTPRequest, error) {
	c.mu.Lock()
	var req httprequest.HTTPRequest
	found := false
	for _, r := range c.requests {
		if r.ID == id {
			req = r
			found = true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return composition.ResolvedHTTPRequest{}, fmt.Errorf("no request with id %q", id)
	}

	var secret string
	if req.AuthType != httprequest.AuthNone {
		s, err := c.credentials.Get(id)
		if err != nil {
			// A missing keychain entry is a fix-it-in-Configure state,
			// not a system fault -- say so in the user's vocabulary
			// (secrets never travel with an exported/seeded request, so
			// this is the expected first-run state on a new device).
			if errors.Is(err, credential.ErrNotFound) {
				return composition.ResolvedHTTPRequest{}, fmt.Errorf(
					"the integration %q has no credential saved on this device -- open it in Configure and enter its token or secret", req.Label)
			}
			return composition.ResolvedHTTPRequest{}, fmt.Errorf("request %q: %w", id, err)
		}
		secret = s
	}

	var josePrivateKey string
	if req.JOSE != nil && req.JOSE.DecryptResponse {
		s, err := c.credentials.Get(joseKeychainID(id))
		if err != nil {
			if errors.Is(err, credential.ErrNotFound) {
				return composition.ResolvedHTTPRequest{}, fmt.Errorf(
					"the integration %q has no response-decryption key saved on this device -- open it in Configure and enter its private key", req.Label)
			}
			return composition.ResolvedHTTPRequest{}, fmt.Errorf("request %q: JOSE private key: %w", id, err)
		}
		josePrivateKey = s
	}

	return composition.ResolvedHTTPRequest{
		BaseURL:           req.BaseURL,
		Method:            req.Method,
		Body:              req.Body,
		AuthType:          req.AuthType,
		Headers:           req.Headers,
		Secret:            secret,
		OpenAPISpec:       req.OpenAPISpec,
		Auth:              req.Auth,
		JOSE:              req.JOSE,
		JOSEPrivateKeyPEM: josePrivateKey,
	}, nil
}

// requestExistsLocked reports whether id names a real local HTTPRequest
// -- callers must hold c.mu. ImportHTTPRequest's own create-vs-update
// check (configureservice_export.go).
func (c *ConfigureService) requestExistsLocked(id string) bool {
	for _, r := range c.requests {
		if r.ID == id {
			return true
		}
	}
	return false
}

// --- HTTPRequests ---

func (c *ConfigureService) HTTPRequests() []httprequest.HTTPRequest {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]httprequest.HTTPRequest, len(c.requests))
	copy(out, c.requests)
	return out
}

// CreateHTTPRequest/UpdateHTTPRequest's positional-param list is
// getting long (9 now, after ADR-0016 Phase B's method) -- a real
// ergonomics cost (every call site needs a scripted-regex patch when a
// field like Auth/JOSE is added), worth an
// options-struct pass at some point, but that's a separate, bigger
// refactor than "add a field" -- not done speculatively here.
func (c *ConfigureService) CreateHTTPRequest(label, baseURL, method, body string, authType httprequest.AuthType, headers map[string]string, openAPISpec string, auth *httprequest.AuthConfig, jose *httprequest.JOSEConfig, description string) (httprequest.HTTPRequest, error) {
	return c.createHTTPRequestWithID(seeding.NewSlugID(label, "request"), label, baseURL, method, body, authType, headers, openAPISpec, auth, jose, description)
}

// createHTTPRequestWithID is CreateHTTPRequest's own logic,
// parameterized on the new request's id -- the seam ImportHTTPRequest
// uses to preserve a caller-supplied id (ADR-0036 decision 3).
func (c *ConfigureService) createHTTPRequestWithID(id, label, baseURL, method, body string, authType httprequest.AuthType, headers map[string]string, openAPISpec string, auth *httprequest.AuthConfig, jose *httprequest.JOSEConfig, description string) (httprequest.HTTPRequest, error) {
	now := time.Now()
	req := httprequest.HTTPRequest{
		ID: id, Label: label,
		BaseURL: baseURL, Method: strings.TrimSpace(method), Body: body, AuthType: authType, Headers: headers, OpenAPISpec: openAPISpec, Auth: auth, JOSE: jose,
		Description: description,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := httprequest.Validate(req); err != nil {
		return httprequest.HTTPRequest{}, err
	}
	if err := validateOpenAPISpec(openAPISpec); err != nil {
		return httprequest.HTTPRequest{}, err
	}

	c.mu.Lock()
	c.requests = append(c.requests, req)
	c.mu.Unlock()

	if err := c.persistHTTPRequests(); err != nil {
		c.mu.Lock()
		for i, existing := range c.requests {
			if existing.ID == req.ID {
				c.requests = append(c.requests[:i], c.requests[i+1:]...)
				break
			}
		}
		c.mu.Unlock()
		return httprequest.HTTPRequest{}, fmt.Errorf("save request: %w", err)
	}
	dataevent.Emit("request", req.ID) // goal 0017: live-sync every open surface
	return req, nil
}

func (c *ConfigureService) UpdateHTTPRequest(id, label, baseURL, method, body string, authType httprequest.AuthType, headers map[string]string, openAPISpec string, auth *httprequest.AuthConfig, jose *httprequest.JOSEConfig, description string) (httprequest.HTTPRequest, error) {
	req := httprequest.HTTPRequest{
		ID: id, Label: label, BaseURL: baseURL, Method: strings.TrimSpace(method), Body: body, AuthType: authType, Headers: headers,
		OpenAPISpec: openAPISpec, Auth: auth, JOSE: jose, Description: description,
	}
	if err := httprequest.Validate(req); err != nil {
		return httprequest.HTTPRequest{}, err
	}
	if err := validateOpenAPISpec(openAPISpec); err != nil {
		return httprequest.HTTPRequest{}, err
	}

	c.mu.Lock()
	idx := -1
	for i, r := range c.requests {
		if r.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return httprequest.HTTPRequest{}, fmt.Errorf("no request with id %q", id)
	}
	// Carried forward, not reset to false: BuiltIn is purely
	// informational (httprequest.HTTPRequest's own doc comment) --
	// editing a seeded example doesn't stop it having started as one.
	// Same pattern CompositionService.UpdateWorkflow already
	// established. CreatedAt is preserved from storage, never trusted
	// from the wire; UpdatedAt always advances on a real update.
	req.BuiltIn = c.requests[idx].BuiltIn
	req.CreatedAt = c.requests[idx].CreatedAt
	req.UpdatedAt = time.Now()
	// Modified latch (docs/goals/0037 item 2): a real content edit
	// reaching a built-in-origin request permanently protects it from
	// reconcile's upgrade path.
	req.Seed = c.requests[idx].Seed.Touch()
	previous := c.requests[idx]
	c.requests[idx] = req
	c.mu.Unlock()

	if err := c.persistHTTPRequests(); err != nil {
		c.mu.Lock()
		for i, existing := range c.requests {
			if existing.ID == id {
				c.requests[i] = previous
				break
			}
		}
		c.mu.Unlock()
		return httprequest.HTTPRequest{}, fmt.Errorf("save request: %w", err)
	}
	dataevent.Emit("request", req.ID) // goal 0017: live-sync every open surface
	return req, nil
}

// DeleteHTTPRequest also removes any keychain secret for id --
// best-effort (c.credentials.Delete on an id with no stored secret, e.g.
// an AuthNone request, is a harmless no-op-shaped error, not
// surfaced), so a deleted request never leaves an orphaned secret
// behind in the OS keychain.
func (c *ConfigureService) DeleteHTTPRequest(id string) error {
	if err := c.refIntegrityError("request", "request", id); err != nil {
		return err
	}

	c.mu.Lock()
	idx := -1
	for i, r := range c.requests {
		if r.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return fmt.Errorf("no request with id %q", id)
	}
	removed := c.requests[idx]
	wasBuiltIn := removed.BuiltIn
	c.requests = append(c.requests[:idx], c.requests[idx+1:]...)
	c.mu.Unlock()

	// A deleted built-in gets a tombstone so top-up seeding never
	// resurrects it (configureservice_builtin.go). Removal and tombstone
	// must succeed together (docs/goals/0025 item 2).
	if wasBuiltIn {
		if err := seeding.RecordTombstone(c.store, id); err != nil {
			c.mu.Lock()
			c.requests = insertHTTPRequestAt(c.requests, idx, removed)
			c.mu.Unlock()
			return fmt.Errorf("tombstone deleted request %q: %w", id, err)
		}
	}
	if err := c.persistHTTPRequests(); err != nil {
		c.mu.Lock()
		c.requests = insertHTTPRequestAt(c.requests, idx, removed)
		c.mu.Unlock()
		return fmt.Errorf("save request deletion: %w", err)
	}
	_ = c.credentials.Delete(id)
	_ = c.credentials.Delete(joseKeychainID(id))
	dataevent.Emit("request", id) // goal 0017: live-sync every open surface
	return nil
}

// insertHTTPRequestAt reinserts r at idx (clamped to the current
// length) -- used to undo DeleteHTTPRequest's removal when the
// tombstone or persist step that must accompany it fails.
func insertHTTPRequestAt(requests []httprequest.HTTPRequest, idx int, r httprequest.HTTPRequest) []httprequest.HTTPRequest {
	if idx < 0 || idx > len(requests) {
		idx = len(requests)
	}
	requests = append(requests, httprequest.HTTPRequest{})
	copy(requests[idx+1:], requests[idx:])
	requests[idx] = r
	return requests
}

// ListHTTPRequestOperations parses id's stored OpenAPISpec and returns
// every operation it declares -- the discoverability answer for an
// HTTPRequest's schema, same shape as ListMCPServerTools
// (configuremcpserver.go, §3.6): a user finds the exact path+method to
// reference from a workflow node here, not by guessing. Returns an
// error for a request with no OpenAPISpec set, rather than an empty
// list, so the frontend can distinguish "nothing declared yet" from
// "real spec, zero operations."
func (c *ConfigureService) ListHTTPRequestOperations(id string) ([]openapispec.OperationRef, error) {
	c.mu.Lock()
	var spec string
	found := false
	for _, r := range c.requests {
		if r.ID == id {
			spec, found = r.OpenAPISpec, true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return nil, fmt.Errorf("no request with id %q", id)
	}
	if spec == "" {
		return nil, fmt.Errorf("request %q has no OpenAPI spec configured", id)
	}
	doc, err := openapispec.Parse([]byte(spec))
	if err != nil {
		return nil, err
	}
	return doc.Operations(), nil
}

// HTTPRequestOperationFields resolves one request operation's declared
// input/output fields (ADR-0007 Phase 3) -- the data the canvas
// Inspector's binding editor renders once a user picks an operation
// from ListHTTPRequestOperations above. Mirrors that method's own
// lookup/parse shape.
func (c *ConfigureService) HTTPRequestOperationFields(id, path, method string) (openapispec.Operation, error) {
	c.mu.Lock()
	var spec string
	found := false
	for _, r := range c.requests {
		if r.ID == id {
			spec, found = r.OpenAPISpec, true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return openapispec.Operation{}, fmt.Errorf("no request with id %q", id)
	}
	if spec == "" {
		return openapispec.Operation{}, fmt.Errorf("request %q has no OpenAPI spec configured", id)
	}
	doc, err := openapispec.Parse([]byte(spec))
	if err != nil {
		return openapispec.Operation{}, err
	}
	op, err := doc.Operation(path, method)
	if err != nil {
		return openapispec.Operation{}, err
	}
	return *op, nil
}

// SetHTTPRequestSecret writes id's secret to the OS keychain.
// Write-only by design (docs/SPEC.md §3.5): there is deliberately no
// GetSecret binding anywhere on this service -- the frontend can set a
// secret but can never read one back, matching 1Password's own
// pattern.
func (c *ConfigureService) SetHTTPRequestSecret(id, secret string) error {
	c.mu.Lock()
	exists := false
	for _, r := range c.requests {
		if r.ID == id {
			exists = true
			break
		}
	}
	c.mu.Unlock()
	if !exists {
		return fmt.Errorf("no request with id %q", id)
	}
	return c.credentials.Set(id, secret)
}

// DeleteHTTPRequestSecret clears id's secret without deleting the
// request itself -- e.g. switching a request back to AuthNone.
func (c *ConfigureService) DeleteHTTPRequestSecret(id string) error {
	return c.credentials.Delete(id)
}

// SetHTTPRequestOAuth1Secret writes id's OAuth 1.0a dual secret
// (consumer secret + token secret) to the OS keychain. AuthOAuth1's
// own documented storage shape (ADR-0015 §3, httprequest.OAuth1Config's
// doc comment): both values are JSON-encoded into the request's single
// existing keychain string via composition.EncodeOAuth1Secret rather
// than Mill inventing a multi-secret-per-request storage model. A
// separate method (not a third SetHTTPRequestSecret param) so the
// plain single-secret AuthTypes (APIKey/Bearer/HMAC) keep their
// existing, simpler call shape unchanged -- addon, not a rewrite.
func (c *ConfigureService) SetHTTPRequestOAuth1Secret(id, consumerSecret, tokenSecret string) error {
	c.mu.Lock()
	exists := false
	for _, r := range c.requests {
		if r.ID == id {
			exists = true
			break
		}
	}
	c.mu.Unlock()
	if !exists {
		return fmt.Errorf("no request with id %q", id)
	}
	return c.credentials.Set(id, composition.EncodeOAuth1Secret(consumerSecret, tokenSecret))
}

// SetHTTPRequestJOSEPrivateKey writes id's JOSE private key (Phase 3)
// to its own, separate keychain entry -- write-only, same reasoning as
// SetHTTPRequestSecret, but namespaced (joseKeychainID) so it can
// coexist with whatever AuthType secret the same request also stores.
func (c *ConfigureService) SetHTTPRequestJOSEPrivateKey(id, privateKeyPEM string) error {
	c.mu.Lock()
	exists := false
	for _, r := range c.requests {
		if r.ID == id {
			exists = true
			break
		}
	}
	c.mu.Unlock()
	if !exists {
		return fmt.Errorf("no request with id %q", id)
	}
	return c.credentials.Set(joseKeychainID(id), privateKeyPEM)
}

// DeleteHTTPRequestJOSEPrivateKey clears id's JOSE private key without
// touching its AuthType secret or deleting the request itself.
func (c *ConfigureService) DeleteHTTPRequestJOSEPrivateKey(id string) error {
	return c.credentials.Delete(joseKeychainID(id))
}

func (c *ConfigureService) persistHTTPRequests() error {
	c.mu.Lock()
	requests := make([]httprequest.HTTPRequest, len(c.requests))
	copy(requests, c.requests)
	c.mu.Unlock()

	data, err := json.Marshal(requests)
	if err != nil {
		return fmt.Errorf("marshal requests: %w", err)
	}
	if err := c.store.Set(requestsKey, string(data)); err != nil {
		return fmt.Errorf("persist requests: %w", err)
	}
	return nil
}
