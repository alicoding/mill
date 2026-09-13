package configuresvc

import (
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/entitystore"
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
func (c *ConfigureService) resolveAIProvider(id string, run composition.SecretAccessRun) (composition.ResolvedAIProvider, error) {
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

	// A key is optional (a local endpoint needs none), so an unset
	// reference resolves to an empty key with no error and no audit
	// line -- this entity has no AuthType field to gate on the way
	// resolveHTTPRequest does.
	actx := secretaudit.AccessContext{Context: secretaudit.ContextAIProvider, RunID: run.RunID, WorkflowID: run.WorkflowID, StepID: run.StepID}
	apiKey, err := c.resolveOptionalSecretRef(p.Label, fieldAIProviderKey, p.KeyRef, actx)
	if err != nil {
		return composition.ResolvedAIProvider{}, err
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

func (c *ConfigureService) CreateAIProvider(label string, kind aiprovider.Kind, baseURL, model, keyRef string) (aiprovider.AIProvider, error) {
	return c.createAIProviderCoordinated(label, kind, baseURL, model, keyRef)
}

func (c *ConfigureService) UpdateAIProvider(id, label string, kind aiprovider.Kind, baseURL, model, keyRef string) (aiprovider.AIProvider, error) {
	return c.updateAIProviderCoordinated(id, label, kind, baseURL, model, keyRef)
}

// DeleteAIProvider removes a provider after authored-reference and active-run
// safety checks. Its key reference names separately managed secret material.
func (c *ConfigureService) DeleteAIProvider(id string) error {
	return c.deleteAIProviderCoordinated(id)
}

// --- persistence ---

func (c *ConfigureService) persistAIProviders() error {
	return entitystore.Persist(&c.mu, &c.aiProviders, c.store, aiProvidersKey, aiProviderDescriptor)
}

func (c *ConfigureService) restoreAIProviders() {
	entitystore.Load(&c.mu, &c.aiProviders, c.store, aiProvidersKey)
}
