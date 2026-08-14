package configuresvc

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
	"github.com/zalando/go-keyring"
)

// aiProvidersKey mirrors mcpServersKey's shape (configuremcpserver.go):
// one atomic JSON blob, the same settings.json file. In its own file
// (not appended to configureservice.go) to keep that file under
// CLAUDE.md's 500-line convention, same reasoning configuremcpserver.go
// itself already documents.
const aiProvidersKey = "configure-aiproviders"

// resolveAIProvider implements composition.go's lookupAIProviderFn seam.
// Unexported, so Wails never binds it as a callable frontend method --
// Go-internal wiring only, same as resolveHTTPRequest/resolveMCPServer.
// A blank BaseURL on an Anthropic provider resolves to
// aiprovider.DefaultAnthropicBaseURL here (aiprovider.Validate itself
// allows that combination) -- the domain-layer default, independent of
// internal/adapters/aiclient's own identical fallback, so either layer
// alone already does the right thing (aiclient.go's own doc comment).
func (c *ConfigureService) resolveAIProvider(id string) (composition.ResolvedAIProvider, error) {
	c.mu.Lock()
	var p aiprovider.AIProvider
	found := false
	for _, entry := range c.aiProviders {
		if entry.ID == id {
			p = entry
			found = true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return composition.ResolvedAIProvider{}, fmt.Errorf("no AI provider with id %q", id)
	}

	// A secret is optional (local Ollama needs none) -- credentials.Get
	// returning keyring.ErrNotFound just means "no secret configured,"
	// not a resolution failure; any other error (a locked/unavailable
	// keychain) still surfaces, same distinction resolveHTTPRequest's
	// own AuthType-gated c.credentials.Get call doesn't need to make
	// (AuthNone skips the call entirely there) but this entity does,
	// since it has no AuthType field to gate on.
	var apiKey string
	secret, err := c.credentials.Get(id)
	switch {
	case err == nil:
		apiKey = secret
	case errors.Is(err, keyring.ErrNotFound):
		// no secret configured -- fine, e.g. local Ollama
	default:
		return composition.ResolvedAIProvider{}, fmt.Errorf("AI provider %q: %w", id, err)
	}

	baseURL := p.BaseURL
	if p.Kind == aiprovider.KindAnthropic && baseURL == "" {
		baseURL = aiprovider.DefaultAnthropicBaseURL
	}

	return composition.ResolvedAIProvider{Kind: p.Kind, BaseURL: baseURL, Model: p.Model, APIKey: apiKey}, nil
}

// --- AI Providers ---

func (c *ConfigureService) AIProviders() []aiprovider.AIProvider {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]aiprovider.AIProvider, len(c.aiProviders))
	copy(out, c.aiProviders)
	return out
}

// aiProviderExistsLocked reports whether id names a real local
// AIProvider -- callers must hold c.mu. ImportAIProvider's own
// create-vs-update check (configureservice_export.go).
func (c *ConfigureService) aiProviderExistsLocked(id string) bool {
	for _, p := range c.aiProviders {
		if p.ID == id {
			return true
		}
	}
	return false
}

func (c *ConfigureService) CreateAIProvider(label string, kind aiprovider.Kind, baseURL, model string) (aiprovider.AIProvider, error) {
	return c.createAIProviderWithID(seeding.NewSlugID(label, "aiprovider"), label, kind, baseURL, model)
}

// createAIProviderWithID is CreateAIProvider's own logic, parameterized
// on the new provider's id -- the seam ImportAIProvider uses to
// preserve a caller-supplied id (ADR-0036 decision 3).
func (c *ConfigureService) createAIProviderWithID(id, label string, kind aiprovider.Kind, baseURL, model string) (aiprovider.AIProvider, error) {
	now := time.Now()
	p := aiprovider.AIProvider{
		ID: id, Label: label, Kind: kind, BaseURL: baseURL, Model: model,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := aiprovider.Validate(p); err != nil {
		return aiprovider.AIProvider{}, err
	}

	c.mu.Lock()
	c.aiProviders = append(c.aiProviders, p)
	c.mu.Unlock()

	if err := c.persistAIProviders(); err != nil {
		c.mu.Lock()
		for i, existing := range c.aiProviders {
			if existing.ID == p.ID {
				c.aiProviders = append(c.aiProviders[:i], c.aiProviders[i+1:]...)
				break
			}
		}
		c.mu.Unlock()
		return aiprovider.AIProvider{}, fmt.Errorf("save AI provider: %w", err)
	}
	dataevent.Emit("aiprovider", p.ID) // goal 0017: live-sync every open surface
	return p, nil
}

func (c *ConfigureService) UpdateAIProvider(id, label string, kind aiprovider.Kind, baseURL, model string) (aiprovider.AIProvider, error) {
	p := aiprovider.AIProvider{ID: id, Label: label, Kind: kind, BaseURL: baseURL, Model: model}
	if err := aiprovider.Validate(p); err != nil {
		return aiprovider.AIProvider{}, err
	}

	c.mu.Lock()
	idx := -1
	for i, existing := range c.aiProviders {
		if existing.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return aiprovider.AIProvider{}, fmt.Errorf("no AI provider with id %q", id)
	}
	p.BuiltIn = c.aiProviders[idx].BuiltIn
	p.CreatedAt = c.aiProviders[idx].CreatedAt
	p.UpdatedAt = time.Now()
	p.Seed = c.aiProviders[idx].Seed.Touch() // docs/goals/0037 item 2
	previous := c.aiProviders[idx]
	c.aiProviders[idx] = p
	c.mu.Unlock()

	if err := c.persistAIProviders(); err != nil {
		c.mu.Lock()
		for i, existing := range c.aiProviders {
			if existing.ID == id {
				c.aiProviders[i] = previous
				break
			}
		}
		c.mu.Unlock()
		return aiprovider.AIProvider{}, fmt.Errorf("save AI provider: %w", err)
	}
	dataevent.Emit("aiprovider", p.ID) // goal 0017: live-sync every open surface
	return p, nil
}

// DeleteAIProvider also removes any keychain secret for id -- best-
// effort (a delete on an id with no stored secret is a harmless no-op-
// shaped error, not surfaced), same reasoning DeleteHTTPRequest's own
// c.credentials.Delete call already documents.
func (c *ConfigureService) DeleteAIProvider(id string) error {
	c.mu.Lock()
	idx := -1
	for i, p := range c.aiProviders {
		if p.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return fmt.Errorf("no AI provider with id %q", id)
	}
	removed := c.aiProviders[idx]
	wasBuiltIn := removed.BuiltIn
	c.aiProviders = append(c.aiProviders[:idx], c.aiProviders[idx+1:]...)
	c.mu.Unlock()

	if wasBuiltIn {
		if err := seeding.RecordTombstone(c.store, id); err != nil {
			c.mu.Lock()
			c.aiProviders = insertAIProviderAt(c.aiProviders, idx, removed)
			c.mu.Unlock()
			return fmt.Errorf("tombstone deleted AI provider %q: %w", id, err)
		}
	}
	if err := c.persistAIProviders(); err != nil {
		c.mu.Lock()
		c.aiProviders = insertAIProviderAt(c.aiProviders, idx, removed)
		c.mu.Unlock()
		return fmt.Errorf("save AI provider deletion: %w", err)
	}
	_ = c.credentials.Delete(id)
	dataevent.Emit("aiprovider", id) // goal 0017: live-sync every open surface
	return nil
}

// insertAIProviderAt reinserts p at idx (clamped to the current length)
// -- used to undo DeleteAIProvider's removal when the tombstone or
// persist step that must accompany it fails.
func insertAIProviderAt(providers []aiprovider.AIProvider, idx int, p aiprovider.AIProvider) []aiprovider.AIProvider {
	if idx < 0 || idx > len(providers) {
		idx = len(providers)
	}
	providers = append(providers, aiprovider.AIProvider{})
	copy(providers[idx+1:], providers[idx:])
	providers[idx] = p
	return providers
}

// SetAIProviderSecret writes id's secret (an API key, or Anthropic's
// x-api-key) to the OS keychain. Write-only by design (docs/SPEC.md
// §3.5): no GetSecret binding exists on this service -- the frontend
// can set a secret but never read one back.
func (c *ConfigureService) SetAIProviderSecret(id, secret string) error {
	c.mu.Lock()
	exists := false
	for _, p := range c.aiProviders {
		if p.ID == id {
			exists = true
			break
		}
	}
	c.mu.Unlock()
	if !exists {
		return fmt.Errorf("no AI provider with id %q", id)
	}
	return c.credentials.Set(id, secret)
}

// DeleteAIProviderSecret clears id's secret without deleting the
// provider itself -- e.g. switching a BYO endpoint back to no
// credential.
func (c *ConfigureService) DeleteAIProviderSecret(id string) error {
	return c.credentials.Delete(id)
}

// --- persistence ---

func (c *ConfigureService) persistAIProviders() error {
	c.mu.Lock()
	providers := make([]aiprovider.AIProvider, len(c.aiProviders))
	copy(providers, c.aiProviders)
	c.mu.Unlock()

	data, err := json.Marshal(providers)
	if err != nil {
		return fmt.Errorf("marshal AI providers: %w", err)
	}
	if err := c.store.Set(aiProvidersKey, string(data)); err != nil {
		return fmt.Errorf("persist AI providers: %w", err)
	}
	return nil
}

func (c *ConfigureService) restoreAIProviders() {
	raw, ok := c.store.Get(aiProvidersKey).(string)
	if !ok || raw == "" {
		return
	}
	var providers []aiprovider.AIProvider
	if err := json.Unmarshal([]byte(raw), &providers); err != nil {
		return
	}
	c.mu.Lock()
	c.aiProviders = providers
	c.mu.Unlock()
}
