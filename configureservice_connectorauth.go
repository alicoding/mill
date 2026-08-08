package main

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/openapispec"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/connector"
)

// This file owns Connector CRUD/persistence -- split out of
// configureservice.go once ADR-0015's Auth-catalogue work (an added
// Auth *connector.AuthConfig param on Create/UpdateConnector, plus the
// OAuth1 dual-secret convenience method below) would have pushed that
// file past the 500-line limit (scripts/check-loc.sh). Mirrors the
// configureservice_connectortest.go split already done this session --
// same file, same *ConfigureService receiver, just organized by
// concern rather than piled into one file. Lists/Attributes/restore
// stay in configureservice.go.

// joseKeychainID namespaces JOSE's own private-key secret under a
// second, distinct keychain entry per connector -- a connector can
// combine JOSE with any AuthType (connector.JOSEConfig's own doc
// comment: independent, additive layers), so JOSE's private key can't
// share the same credential.Set(id, ...) slot AuthType's own secret
// already uses without one silently overwriting the other.
func joseKeychainID(id string) string {
	return id + ":jose"
}

// resolveConnector implements composition.go's lookupConnectorFn seam:
// find the Connector, fetch its secret from the OS keychain (skipped
// entirely for AuthNone -- there's nothing to fetch), return both as a
// composition.ResolvedConnector. Unexported, so Wails never binds it as
// a callable frontend method -- it's Go-internal wiring only, same as
// CompositionService's SetSyncer.
func (c *ConfigureService) resolveConnector(id string) (composition.ResolvedConnector, error) {
	c.mu.Lock()
	var conn connector.Connector
	found := false
	for _, cn := range c.connectors {
		if cn.ID == id {
			conn = cn
			found = true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return composition.ResolvedConnector{}, fmt.Errorf("no connector with id %q", id)
	}

	var secret string
	if conn.AuthType != connector.AuthNone {
		s, err := credential.Get(id)
		if err != nil {
			return composition.ResolvedConnector{}, fmt.Errorf("connector %q: %w", id, err)
		}
		secret = s
	}

	var josePrivateKey string
	if conn.JOSE != nil && conn.JOSE.DecryptResponse {
		s, err := credential.Get(joseKeychainID(id))
		if err != nil {
			return composition.ResolvedConnector{}, fmt.Errorf("connector %q: JOSE private key: %w", id, err)
		}
		josePrivateKey = s
	}

	return composition.ResolvedConnector{
		BaseURL:           conn.BaseURL,
		AuthType:          conn.AuthType,
		Headers:           conn.Headers,
		Secret:            secret,
		OpenAPISpec:       conn.OpenAPISpec,
		Auth:              conn.Auth,
		JOSE:              conn.JOSE,
		JOSEPrivateKeyPEM: josePrivateKey,
	}, nil
}

// --- Connectors ---

func (c *ConfigureService) Connectors() []connector.Connector {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]connector.Connector, len(c.connectors))
	copy(out, c.connectors)
	return out
}

func (c *ConfigureService) CreateConnector(label, connType, baseURL string, authType connector.AuthType, headers map[string]string, openAPISpec string, auth *connector.AuthConfig, jose *connector.JOSEConfig) (connector.Connector, error) {
	conn := connector.Connector{
		ID: newSlugID(label, "connector"), Label: label, Type: connType,
		BaseURL: baseURL, AuthType: authType, Headers: headers, OpenAPISpec: openAPISpec, Auth: auth, JOSE: jose,
	}
	if err := connector.Validate(conn); err != nil {
		return connector.Connector{}, err
	}
	if err := validateOpenAPISpec(openAPISpec); err != nil {
		return connector.Connector{}, err
	}

	c.mu.Lock()
	c.connectors = append(c.connectors, conn)
	c.mu.Unlock()

	c.persistConnectors()
	return conn, nil
}

func (c *ConfigureService) UpdateConnector(id, label, connType, baseURL string, authType connector.AuthType, headers map[string]string, openAPISpec string, auth *connector.AuthConfig, jose *connector.JOSEConfig) (connector.Connector, error) {
	conn := connector.Connector{ID: id, Label: label, Type: connType, BaseURL: baseURL, AuthType: authType, Headers: headers, OpenAPISpec: openAPISpec, Auth: auth, JOSE: jose}
	if err := connector.Validate(conn); err != nil {
		return connector.Connector{}, err
	}
	if err := validateOpenAPISpec(openAPISpec); err != nil {
		return connector.Connector{}, err
	}

	c.mu.Lock()
	idx := -1
	for i, cn := range c.connectors {
		if cn.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return connector.Connector{}, fmt.Errorf("no connector with id %q", id)
	}
	c.connectors[idx] = conn
	c.mu.Unlock()

	c.persistConnectors()
	return conn, nil
}

// DeleteConnector also removes any keychain secret for id -- best-effort
// (credential.Delete on an id with no stored secret, e.g. an AuthNone
// connector, is a harmless no-op-shaped error, not surfaced), so a
// deleted connector never leaves an orphaned secret behind in the OS
// keychain.
func (c *ConfigureService) DeleteConnector(id string) error {
	c.mu.Lock()
	idx := -1
	for i, cn := range c.connectors {
		if cn.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return fmt.Errorf("no connector with id %q", id)
	}
	c.connectors = append(c.connectors[:idx], c.connectors[idx+1:]...)
	c.mu.Unlock()

	c.persistConnectors()
	_ = credential.Delete(id)
	_ = credential.Delete(joseKeychainID(id))
	return nil
}

// ListConnectorOperations parses id's stored OpenAPISpec and returns
// every operation it declares -- the discoverability answer for a
// Connector's schema, same shape as ListMCPServerTools
// (configuremcpserver.go, §3.6): a user finds the exact path+method to
// reference from a workflow node here, not by guessing. Returns an
// error for a Connector with no OpenAPISpec set, rather than an empty
// list, so the frontend can distinguish "nothing declared yet" from
// "real spec, zero operations."
func (c *ConfigureService) ListConnectorOperations(id string) ([]openapispec.OperationRef, error) {
	c.mu.Lock()
	var spec string
	found := false
	for _, cn := range c.connectors {
		if cn.ID == id {
			spec, found = cn.OpenAPISpec, true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return nil, fmt.Errorf("no connector with id %q", id)
	}
	if spec == "" {
		return nil, fmt.Errorf("connector %q has no OpenAPI spec configured", id)
	}
	doc, err := openapispec.Parse([]byte(spec))
	if err != nil {
		return nil, err
	}
	return doc.Operations(), nil
}

// ConnectorOperationFields resolves one connector operation's declared
// input/output fields (ADR-0007 Phase 3) -- the data the canvas
// Inspector's binding editor renders once a user picks an operation
// from ListConnectorOperations above. Mirrors that method's own
// lookup/parse shape.
func (c *ConfigureService) ConnectorOperationFields(id, path, method string) (openapispec.Operation, error) {
	c.mu.Lock()
	var spec string
	found := false
	for _, cn := range c.connectors {
		if cn.ID == id {
			spec, found = cn.OpenAPISpec, true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return openapispec.Operation{}, fmt.Errorf("no connector with id %q", id)
	}
	if spec == "" {
		return openapispec.Operation{}, fmt.Errorf("connector %q has no OpenAPI spec configured", id)
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

// SetConnectorSecret writes id's secret to the OS keychain. Write-only
// by design (docs/SPEC.md §3.5): there is deliberately no GetSecret
// binding anywhere on this service -- the frontend can set a secret but
// can never read one back, matching 1Password's own pattern.
func (c *ConfigureService) SetConnectorSecret(id, secret string) error {
	c.mu.Lock()
	exists := false
	for _, cn := range c.connectors {
		if cn.ID == id {
			exists = true
			break
		}
	}
	c.mu.Unlock()
	if !exists {
		return fmt.Errorf("no connector with id %q", id)
	}
	return credential.Set(id, secret)
}

// DeleteConnectorSecret clears id's secret without deleting the
// connector itself -- e.g. switching a connector back to AuthNone.
func (c *ConfigureService) DeleteConnectorSecret(id string) error {
	return credential.Delete(id)
}

// SetConnectorOAuth1Secret writes id's OAuth 1.0a dual secret (consumer
// secret + token secret) to the OS keychain. AuthOAuth1's own
// documented storage shape (ADR-0015 §3, connector.OAuth1Config's doc
// comment): both values are JSON-encoded into the connector's single
// existing keychain string via composition.EncodeOAuth1Secret rather
// than Mill inventing a multi-secret-per-connector storage model. A
// separate method (not a third SetConnectorSecret param) so the plain
// single-secret AuthTypes (APIKey/Bearer/HMAC) keep their existing,
// simpler call shape unchanged -- addon, not a rewrite.
func (c *ConfigureService) SetConnectorOAuth1Secret(id, consumerSecret, tokenSecret string) error {
	c.mu.Lock()
	exists := false
	for _, cn := range c.connectors {
		if cn.ID == id {
			exists = true
			break
		}
	}
	c.mu.Unlock()
	if !exists {
		return fmt.Errorf("no connector with id %q", id)
	}
	return credential.Set(id, composition.EncodeOAuth1Secret(consumerSecret, tokenSecret))
}

// SetConnectorJOSEPrivateKey writes id's JOSE private key (Phase 3) to
// its own, separate keychain entry -- write-only, same reasoning as
// SetConnectorSecret, but namespaced (joseKeychainID) so it can coexist
// with whatever AuthType secret the same connector also stores.
func (c *ConfigureService) SetConnectorJOSEPrivateKey(id, privateKeyPEM string) error {
	c.mu.Lock()
	exists := false
	for _, cn := range c.connectors {
		if cn.ID == id {
			exists = true
			break
		}
	}
	c.mu.Unlock()
	if !exists {
		return fmt.Errorf("no connector with id %q", id)
	}
	return credential.Set(joseKeychainID(id), privateKeyPEM)
}

// DeleteConnectorJOSEPrivateKey clears id's JOSE private key without
// touching its AuthType secret or deleting the connector itself.
func (c *ConfigureService) DeleteConnectorJOSEPrivateKey(id string) error {
	return credential.Delete(joseKeychainID(id))
}

func (c *ConfigureService) persistConnectors() {
	c.mu.Lock()
	connectors := make([]connector.Connector, len(c.connectors))
	copy(connectors, c.connectors)
	c.mu.Unlock()

	data, err := json.Marshal(connectors)
	if err != nil {
		return
	}
	_ = c.store.Set(connectorsKey, string(data))
}
