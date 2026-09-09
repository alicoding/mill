package configuresvc

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/domain/secretsource"
)

// Export/import of a secret source's DEFINITION (goal 0408 S3 decision
// 6): kind, label, and path -- never a value, since a source itself
// holds none (ADR-0050's provider port reads the user's own store live,
// it never copies from it). Same wire-shape/ADR-0036-decision-3 pattern
// as every other Configure family in configureservice_export.go; kept
// in its own file rather than added there so that file stays under its
// line budget.

type exportedSecretSource struct {
	Schema string            `json:"schema"`
	ID     string            `json:"id,omitempty"`
	Label  string            `json:"label"`
	Kind   secretsource.Kind `json:"kind"`
	Path   string            `json:"path,omitempty"`
}

func (c *ConfigureService) ExportSecretSource(id string) (string, error) {
	c.mu.Lock()
	var s secretsource.Source
	found := false
	for _, entry := range c.secretSources {
		if entry.ID == id {
			s = entry
			found = true
			break
		}
	}
	c.mu.Unlock()
	if !found {
		return "", fmt.Errorf("no secret source with id %q", id)
	}

	data, err := json.MarshalIndent(exportedSecretSource{
		Schema: contract.SchemaID("secretsource"), ID: s.ID, Label: s.Label, Kind: s.Kind, Path: s.Path,
	}, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export secret source: %w", err)
	}
	return string(data), nil
}

// ImportSecretSource applies ADR-0036 decision 3's uniform import rule
// (configureservice_export.go's own header comment). A path naming a
// file this machine doesn't have is never rejected here -- the source
// still lands, exactly as decision 6 states: "a missing path lands the
// source with its problem text, never an import error." Its row's own
// SourceProblems (secretsvc) reports the problem once the source is
// watched, the same state a source whose file moves or is deleted
// after creation already produces.
func (c *ConfigureService) ImportSecretSource(jsonData string) (secretsource.Source, error) {
	var in exportedSecretSource
	if err := json.Unmarshal([]byte(jsonData), &in); err != nil {
		return secretsource.Source{}, fmt.Errorf("import secret source: invalid JSON: %w", err)
	}
	if err := contract.ValidateImportSchema("secretsource", in.Schema); err != nil {
		return secretsource.Source{}, fmt.Errorf("import secret source: %w", err)
	}

	if in.ID != "" {
		c.mu.Lock()
		found := c.secretSourceExistsLocked(in.ID)
		c.mu.Unlock()
		if found {
			return c.UpdateSecretSource(in.ID, in.Label, in.Kind, in.Path)
		}
		return c.createSecretSourceWithID(in.ID, in.Label, in.Kind, in.Path)
	}
	return c.CreateSecretSource(in.Label, in.Kind, in.Path)
}
