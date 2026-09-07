package configuresvc

import (
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/adapters/openapispec"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/entitystore"
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

// resolveHTTPRequest implements composition.go's lookupHTTPRequestFn
// seam: find the HTTPRequest, resolve every secret, key and header
// reference it names through the secret store (goal 0306 -- one door,
// one audit trail, one unlock requirement, whatever the field's shape),
// and return the lot as a composition.ResolvedHTTPRequest.
// Unexported, so Wails never binds it as a callable frontend method --
// it's Go-internal wiring only, same as CompositionService's SetSyncer.
func (c *ConfigureService) resolveHTTPRequest(id string, run composition.SecretAccessRun) (composition.ResolvedHTTPRequest, error) {
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

	authCtx := secretaudit.AccessContext{Context: secretaudit.ContextIntegrationAuth, RunID: run.RunID, WorkflowID: run.WorkflowID}
	secret, err := c.resolveHTTPRequestSecret(req, authCtx)
	if err != nil {
		return composition.ResolvedHTTPRequest{}, err
	}
	josePublicKey, josePrivateKey, err := c.resolveHTTPRequestJOSEKeys(req, authCtx)
	if err != nil {
		return composition.ResolvedHTTPRequest{}, err
	}
	actx := secretaudit.AccessContext{Context: secretaudit.ContextHTTPHeader, RunID: run.RunID, WorkflowID: run.WorkflowID}
	headers, err := c.resolveVaultRefHeaders(req.Label, req.Headers, actx)
	if err != nil {
		return composition.ResolvedHTTPRequest{}, err
	}

	return composition.ResolvedHTTPRequest{
		BaseURL:                   req.BaseURL,
		Method:                    req.Method,
		Body:                      req.Body,
		AuthType:                  req.AuthType,
		Headers:                   headers,
		Secret:                    secret,
		OpenAPISpec:               req.OpenAPISpec,
		Auth:                      req.Auth,
		JOSE:                      req.JOSE,
		JOSEPrivateKeyPEM:         josePrivateKey,
		JOSERecipientPublicKeyPEM: josePublicKey,
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
func (c *ConfigureService) CreateHTTPRequest(label, baseURL, method, body string, authType httprequest.AuthType, secretRef string, headers map[string]string, openAPISpec string, auth *httprequest.AuthConfig, jose *httprequest.JOSEConfig, description string) (httprequest.HTTPRequest, error) {
	return c.createHTTPRequestWithID(seeding.NewSlugID(label, "request"), label, baseURL, method, body, authType, secretRef, headers, openAPISpec, auth, jose, description)
}

// createHTTPRequestWithID is CreateHTTPRequest's own logic,
// parameterized on the new request's id -- the seam ImportHTTPRequest
// uses to preserve a caller-supplied id (ADR-0036 decision 3).
func (c *ConfigureService) createHTTPRequestWithID(id, label, baseURL, method, body string, authType httprequest.AuthType, secretRef string, headers map[string]string, openAPISpec string, auth *httprequest.AuthConfig, jose *httprequest.JOSEConfig, description string) (httprequest.HTTPRequest, error) {
	now := time.Now()
	req := httprequest.HTTPRequest{
		ID: id, Label: label,
		BaseURL: baseURL, Method: strings.TrimSpace(method), Body: body, AuthType: authType, SecretRef: secretRef, Headers: headers, OpenAPISpec: openAPISpec, Auth: auth, JOSE: jose,
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

func (c *ConfigureService) UpdateHTTPRequest(id, label, baseURL, method, body string, authType httprequest.AuthType, secretRef string, headers map[string]string, openAPISpec string, auth *httprequest.AuthConfig, jose *httprequest.JOSEConfig, description string) (httprequest.HTTPRequest, error) {
	req := httprequest.HTTPRequest{
		ID: id, Label: label, BaseURL: baseURL, Method: strings.TrimSpace(method), Body: body, AuthType: authType, SecretRef: secretRef, Headers: headers,
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

// DeleteHTTPRequest leaves the secret store untouched: a request only
// ever NAMED its secrets (goal 0306), and the same entry may be named
// by other requests or wanted again -- deleting the last thing that
// pointed at a credential is not consent to destroy it.
func (c *ConfigureService) DeleteHTTPRequest(id string) error {
	restore, label, err := c.deleteHTTPRequest(id)
	if err != nil {
		return err
	}
	announce := func(id string) { dataevent.Emit("request", id) }
	c.registerEntityDelete("request", id, label, restore,
		func() error {
			if _, _, err := c.deleteHTTPRequest(id); err != nil {
				return err
			}
			announce(id)
			return nil
		}, announce)
	announce(id) // goal 0017: live-sync every open surface
	return nil
}

// deleteHTTPRequest is DeleteHTTPRequest's unrecorded core (ADR-0044's
// configure-entity entry family): removal + tombstone + persist, with
// no journal entry. Returns the restorer the recorded undo closure runs
// and the removed request's label for the journal label. The delete is
// HTTP-request-shaped (not entitystore.DeleteRecoverable) because
// c.requests predates the descriptor recipe.
func (c *ConfigureService) deleteHTTPRequest(id string) (func() error, string, error) {
	if err := c.refIntegrityError("request", "request", id); err != nil {
		return nil, "", err
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
		return nil, "", fmt.Errorf("no request with id %q", id)
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
			return nil, "", fmt.Errorf("tombstone deleted request %q: %w", id, err)
		}
	}
	if err := c.persistHTTPRequests(); err != nil {
		c.mu.Lock()
		c.requests = insertHTTPRequestAt(c.requests, idx, removed)
		c.mu.Unlock()
		return nil, "", fmt.Errorf("save request deletion: %w", err)
	}
	return c.httpRequestRestorer(id, idx, removed, wasBuiltIn), removed.Label, nil
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

func (c *ConfigureService) persistHTTPRequests() error {
	return entitystore.Persist(&c.mu, &c.requests, c.store, requestsKey, httpRequestDescriptor)
}

// IntegrationHost is one configured HTTPRequest's host identity -- the
// Configure-side half of Atlas source recognition (goal 0126,
// atlassvc/atlasrecognition.go). Host is the lowercase hostname parsed
// from BaseURL; "" (unparseable/host-less) never matches anything.
type IntegrationHost struct {
	ID    string
	Label string
	Host  string
}

// IntegrationHosts lists every request's host identity. Exported for
// main.go wiring only, never a frontend RPC.
//
//wails:ignore
func (c *ConfigureService) IntegrationHosts() []IntegrationHost {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]IntegrationHost, 0, len(c.requests))
	for _, r := range c.requests {
		host := ""
		if u, err := url.Parse(r.BaseURL); err == nil {
			host = strings.ToLower(u.Hostname())
		}
		out = append(out, IntegrationHost{ID: r.ID, Label: r.Label, Host: host})
	}
	return out
}
