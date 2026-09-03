package configuresvc

import (
	"errors"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
	"github.com/zalando/go-keyring"
)

// aiProviderDescriptor is AIProvider's entitystore.Descriptor (goal
// 0165): the small per-kind shape Create/Update/Delete/reconcile/
// Reset/Restorable/Restore all key off, replacing what used to be
// ~10 hand-copied methods.
var aiProviderDescriptor = entitystore.Descriptor[aiprovider.AIProvider]{
	Label:     "AI provider",
	GetID:     func(p aiprovider.AIProvider) string { return p.ID },
	IsBuiltIn: func(p aiprovider.AIProvider) bool { return p.BuiltIn },
	GetSeed:   func(p aiprovider.AIProvider) seedorigin.Origin { return p.Seed },
	SetSeed:   func(p aiprovider.AIProvider, o seedorigin.Origin) aiprovider.AIProvider { p.Seed = o; return p },
	StampNew: func(p aiprovider.AIProvider, now time.Time) aiprovider.AIProvider {
		p.CreatedAt, p.UpdatedAt = now, now
		return p
	},
	Upgrade: upgradeAIProviderToGolden,
	BuiltIn: aiprovider.BuiltIn,
}

// upgradeAIProviderToGolden replaces existing's content with golden's,
// preserving existing's identity (ID/CreatedAt) -- shared by
// reconcileBuiltInAIProviders' upgrade branch and ResetAIProviderToSeed
// via aiProviderDescriptor.Upgrade.
func upgradeAIProviderToGolden(existing, golden aiprovider.AIProvider, now time.Time) aiprovider.AIProvider {
	golden.CreatedAt = existing.CreatedAt
	golden.UpdatedAt = now
	golden.Seed = seedorigin.Stamp(golden.Seed.SeedRevision)
	return golden
}

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

// AIProviderFields exposes AIProvider's declared shape (docs/adr/0029)
// to the frontend's generic entity-field renderer
// (frontend/src/configure/EntityConfigFields.tsx) -- a static
// descriptor, not per-instance data, mirroring how ListNodeTypes
// already exposes each NodeType's own ConfigFields.
func (c *ConfigureService) AIProviderFields() []typedfield.Field {
	return aiprovider.Fields
}

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

	if err := entitystore.Insert(&c.mu, &c.aiProviders, c.persistAIProviders, aiProviderDescriptor, p); err != nil {
		return aiprovider.AIProvider{}, err
	}
	dataevent.Emit("aiprovider", p.ID) // goal 0017: live-sync every open surface
	return p, nil
}

func (c *ConfigureService) UpdateAIProvider(id, label string, kind aiprovider.Kind, baseURL, model string) (aiprovider.AIProvider, error) {
	p := aiprovider.AIProvider{ID: id, Label: label, Kind: kind, BaseURL: baseURL, Model: model}
	if err := aiprovider.Validate(p); err != nil {
		return aiprovider.AIProvider{}, err
	}

	updated, err := entitystore.Update(&c.mu, &c.aiProviders, c.persistAIProviders, aiProviderDescriptor, id, func(existing aiprovider.AIProvider) (aiprovider.AIProvider, error) {
		p.BuiltIn = existing.BuiltIn
		p.CreatedAt = existing.CreatedAt
		p.UpdatedAt = time.Now()
		p.Seed = existing.Seed.Touch() // docs/goals/0037 item 2
		return p, nil
	})
	if err != nil {
		return aiprovider.AIProvider{}, err
	}
	dataevent.Emit("aiprovider", updated.ID) // goal 0017: live-sync every open surface
	return updated, nil
}

// DeleteAIProvider also removes any keychain secret for id -- best-
// effort (a delete on an id with no stored secret is a harmless no-op-
// shaped error, not surfaced), same reasoning DeleteHTTPRequest's own
// c.credentials.Delete call already documents.
func (c *ConfigureService) DeleteAIProvider(id string) error {
	if err := c.refIntegrityError("aiprovider", "AI provider", id); err != nil {
		return err
	}
	recordTombstone := func(id string) error { return seeding.RecordTombstone(c.store, id) }
	clearTombstone := func(id string) error { return seeding.ClearTombstone(c.store, id) }
	restore, err := entitystore.DeleteRecoverable(&c.mu, &c.aiProviders, c.persistAIProviders, recordTombstone, clearTombstone, aiProviderDescriptor, id)
	if err != nil {
		return err
	}
	c.undo.remember("aiprovider", id, restore)
	_ = c.credentials.Delete(id)
	dataevent.Emit("aiprovider", id) // goal 0017: live-sync every open surface
	return nil
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
	return entitystore.Persist(&c.mu, &c.aiProviders, c.store, aiProvidersKey, aiProviderDescriptor)
}

func (c *ConfigureService) restoreAIProviders() {
	entitystore.Load(&c.mu, &c.aiProviders, c.store, aiProvidersKey)
}
