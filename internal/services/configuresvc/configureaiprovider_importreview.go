package configuresvc

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/reference"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/seeding"
)

var errAIProviderImportPreviewStale = usererror.New(
	"provider-import-preview-stale",
	"This provider changed after the import preview. Review it again before applying.",
)

// PreviewAIProviderImport validates an import and returns passive, credential-
// free review data. It neither resolves the key reference nor contacts the
// configured endpoint.
func (c *ConfigureService) PreviewAIProviderImport(jsonData string) (aiprovider.ImportPreview, error) {
	in, proposed, err := decodeAIProviderImport(jsonData)
	if err != nil {
		return aiprovider.ImportPreview{}, err
	}
	preview := aiprovider.ImportPreview{
		ProviderID:       in.ID,
		Mode:             aiprovider.ImportModeCreate,
		ExpectedRevision: aiprovider.RevisionAbsent,
		Proposed:         projectAIProviderImport(proposed),
		References:       reference.Refs{},
		Impact: aiprovider.ChangeImpact{
			ProviderID: in.ID, ConfigRevision: aiprovider.RevisionAbsent,
			MutationAllowed: true,
		},
	}
	if in.ID == "" {
		return preview, nil
	}

	current, exists, impact := c.aiProviderImpactSnapshot(in.ID)
	preview.ExpectedRevision = impact.ConfigRevision
	preview.Impact = impact
	preview.References = c.References("aiprovider", in.ID)
	if exists {
		projection := projectAIProviderImport(current)
		preview.Current = &projection
		preview.Mode = aiprovider.ImportModeReplace
	}
	return preview, nil
}

// ApplyAIProviderImport compares the preview revision and performs the import
// within the ordinary mutation coordinator. The preview's impact is never
// reused as authorization.
func (c *ConfigureService) ApplyAIProviderImport(jsonData, expectedRevision string) (aiprovider.AIProvider, error) {
	in, proposed, err := decodeAIProviderImport(jsonData)
	if err != nil {
		return aiprovider.AIProvider{}, err
	}
	if expectedRevision == "" {
		return aiprovider.AIProvider{}, errAIProviderImportPreviewStale
	}
	return c.applyDecodedAIProviderImport(in, proposed, &expectedRevision)
}

func (c *ConfigureService) importAIProviderCoordinated(jsonData string) (aiprovider.AIProvider, error) {
	in, proposed, err := decodeAIProviderImport(jsonData)
	if err != nil {
		return aiprovider.AIProvider{}, err
	}
	return c.applyDecodedAIProviderImport(in, proposed, nil)
}

func (c *ConfigureService) applyDecodedAIProviderImport(
	in exportedAIProvider,
	proposed aiprovider.AIProvider,
	expectedRevision *string,
) (aiprovider.AIProvider, error) {
	targetID := in.ID
	var imported aiprovider.AIProvider
	err := c.withAIProviderMutation(targetID, func(assertUnused func() error) error {
		var mutationErr error
		imported, mutationErr = c.applyAIProviderImportMutation(in, proposed, expectedRevision, assertUnused)
		return mutationErr
	})
	if err != nil {
		return aiprovider.AIProvider{}, err
	}
	c.announceAIProviderMutation(imported.ID)
	return imported, nil
}

func (c *ConfigureService) applyAIProviderImportMutation(
	in exportedAIProvider,
	proposed aiprovider.AIProvider,
	expectedRevision *string,
	assertUnused func() error,
) (aiprovider.AIProvider, error) {
	current, exists := c.currentAIProviderSnapshot(in.ID)
	if expectedRevision != nil && currentAIProviderRevision(c, current, exists) != *expectedRevision {
		return aiprovider.AIProvider{}, errAIProviderImportPreviewStale
	}
	if in.ID == "" {
		return c.createAIProviderUncoordinated(
			seeding.NewSlugID(in.Label, "aiprovider"), in.Label, in.Kind, in.BaseURL, in.Model, in.KeyRef,
		)
	}
	if !exists {
		if err := assertUnused(); err != nil {
			return aiprovider.AIProvider{}, err
		}
		return c.createAIProviderUncoordinated(in.ID, in.Label, in.Kind, in.BaseURL, in.Model, in.KeyRef)
	}
	proposed.ID = in.ID
	if !aiProviderRuntimeEqual(current, proposed) {
		if err := assertUnused(); err != nil {
			return aiprovider.AIProvider{}, err
		}
	}
	return c.updateAIProviderUncoordinated(in.ID, in.Label, in.Kind, in.BaseURL, in.Model, in.KeyRef)
}

func currentAIProviderRevision(c *ConfigureService, current aiprovider.AIProvider, exists bool) string {
	if !exists {
		return aiprovider.RevisionAbsent
	}
	return c.aiProviderConfigRevision(current)
}

func decodeAIProviderImport(jsonData string) (exportedAIProvider, aiprovider.AIProvider, error) {
	var in exportedAIProvider
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return exportedAIProvider{}, aiprovider.AIProvider{}, fmt.Errorf("import aiprovider: invalid JSON: %w", err)
	}
	if err := contract.ValidateImportSchema("aiprovider", in.Schema); err != nil {
		return exportedAIProvider{}, aiprovider.AIProvider{}, fmt.Errorf("import aiprovider: %w", err)
	}
	proposed := aiprovider.AIProvider{
		ID: in.ID, Label: in.Label, Kind: in.Kind, BaseURL: in.BaseURL,
		Model: in.Model, KeyRef: in.KeyRef,
	}
	if err := aiprovider.Validate(proposed); err != nil {
		return exportedAIProvider{}, aiprovider.AIProvider{}, err
	}
	return in, proposed, nil
}

func projectAIProviderImport(provider aiprovider.AIProvider) aiprovider.ImportProjection {
	return aiprovider.ImportProjection{
		Label: provider.Label, Kind: provider.Kind,
		Endpoint: safeEffectiveAIProviderEndpoint(provider),
		Model:    provider.Model, KeyRef: provider.KeyRef,
	}
}

func safeEffectiveAIProviderEndpoint(provider aiprovider.AIProvider) string {
	raw := provider.BaseURL
	if provider.Kind == aiprovider.KindAnthropic && strings.TrimSpace(raw) == "" {
		raw = aiprovider.DefaultAnthropicBaseURL
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	parsed.Fragment = ""
	parsed.RawFragment = ""
	return strings.TrimRight(parsed.String(), "/")
}
