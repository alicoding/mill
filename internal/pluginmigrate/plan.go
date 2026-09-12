// Package pluginmigrate plans and applies source-plugin manifest migrations.
package pluginmigrate

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/services/pluginsvc"
	"github.com/tailscale/hujson"
)

const MigrationID = "configuration-key"

var noPatch = json.RawMessage("[]")

// ManualDecision names an ambiguity the author must resolve.
type ManualDecision struct {
	ID      string `json:"id"`
	Path    string `json:"path"`
	Summary string `json:"summary"`
}

// Plan is the inspectable migration result. Patch is an RFC 6902 document
// consumed directly by HuJSON.
type Plan struct {
	PluginID    string           `json:"pluginId"`
	MigrationID string           `json:"migrationId,omitempty"`
	Patch       json.RawMessage  `json:"patch"`
	Manual      []ManualDecision `json:"manual"`
	Applied     bool             `json:"applied"`
}

// HasPatch reports whether the plan carries the migration's test and move.
func (p Plan) HasPatch() bool { return !bytes.Equal(p.Patch, noPatch) }

// Prepared holds the checked prospective bytes until the caller explicitly
// applies them.
type Prepared struct {
	Plan      Plan
	root      string
	original  []byte
	candidate []byte
}

// Prepare validates the source boundary and builds the one supported patch.
func Prepare(sourceDir, installedDir string) (*Prepared, error) {
	id, root, raw, value, err := loadSource(sourceDir, installedDir)
	if err != nil {
		return nil, err
	}
	plan := Plan{PluginID: id, Patch: append(json.RawMessage(nil), noPatch...), Manual: []ManualDecision{}}
	settings, hasSettings, hasConfiguration := configurationMembers(value)
	if hasSettings && hasConfiguration {
		plan.MigrationID = MigrationID
		plan.Manual = append(plan.Manual, ManualDecision{
			ID: MigrationID, Path: "manifest.json",
			Summary: "Both contributes.settings and contributes.configuration exist; choose the canonical value.",
		})
		return &Prepared{Plan: plan, root: root, original: raw}, nil
	}
	if !hasSettings {
		if problems := pluginsvc.ConformDirWithManifest(root, raw, ""); len(problems) > 0 {
			return nil, fmt.Errorf("plugin does not conform: %s", strings.Join(problems, "; "))
		}
		return &Prepared{Plan: plan, root: root, original: raw}, nil
	}

	patch := configurationPatch(settings)
	candidate, err := patched(value, patch)
	if err != nil {
		return nil, err
	}
	if problems := pluginsvc.ConformDirWithManifest(root, candidate, ""); len(problems) > 0 {
		return nil, fmt.Errorf("migrated plugin does not conform: %s", strings.Join(problems, "; "))
	}
	plan.MigrationID = MigrationID
	plan.Patch = patch
	return &Prepared{Plan: plan, root: root, original: raw, candidate: candidate}, nil
}

func loadSource(sourceDir, installedDir string) (string, string, []byte, hujson.Value, error) {
	source, err := canonicalExistingDir(sourceDir)
	if err != nil {
		return "", "", nil, hujson.Value{}, err
	}
	installed, err := canonicalPath(installedDir)
	if err != nil {
		return "", "", nil, hujson.Value{}, fmt.Errorf("resolve installed plugin directory: %w", err)
	}
	if within(installed, source) {
		return "", "", nil, hujson.Value{}, fmt.Errorf("refusing installed plugin directory %q", sourceDir)
	}
	id, root, err := pluginsvc.ManifestIDIn(source)
	if err != nil {
		return "", "", nil, hujson.Value{}, fmt.Errorf("read source plugin: %w", err)
	}
	root, err = canonicalExistingDir(root)
	if err != nil {
		return "", "", nil, hujson.Value{}, err
	}
	if within(installed, root) {
		return "", "", nil, hujson.Value{}, fmt.Errorf("refusing installed plugin directory %q", sourceDir)
	}
	if err := refuseReceipts(source, root); err != nil {
		return "", "", nil, hujson.Value{}, err
	}
	raw, err := os.ReadFile(filepath.Join(root, "manifest.json")) // #nosec G304 -- root came from the explicit source directory
	if err != nil {
		return "", "", nil, hujson.Value{}, fmt.Errorf("read manifest.json: %w", err)
	}
	value, err := hujson.Parse(raw)
	if err != nil {
		return "", "", nil, hujson.Value{}, fmt.Errorf("parse manifest.json: %w", err)
	}
	return id, root, raw, value, nil
}

func refuseReceipts(dirs ...string) error {
	for _, dir := range dirs {
		_, err := os.Stat(filepath.Join(dir, pluginsvc.InstallRecordFile))
		switch {
		case err == nil:
			return fmt.Errorf("refusing installed plugin receipt in %q", dir)
		case !os.IsNotExist(err):
			return fmt.Errorf("inspect plugin receipt in %q: %w", dir, err)
		}
	}
	return nil
}

func configurationMembers(value hujson.Value) (hujson.Value, bool, bool) {
	root, ok := value.Value.(*hujson.Object)
	if !ok {
		return hujson.Value{}, false, false
	}
	contributes, ok := objectMember(root, "contributes")
	if !ok {
		return hujson.Value{}, false, false
	}
	object, ok := contributes.Value.(*hujson.Object)
	if !ok {
		return hujson.Value{}, false, false
	}
	settings, hasSettings := objectMember(object, "settings")
	_, hasConfiguration := objectMember(object, "configuration")
	return settings, hasSettings, hasConfiguration
}

func objectMember(object *hujson.Object, name string) (hujson.Value, bool) {
	for _, member := range object.Members {
		literal, ok := member.Name.Value.(hujson.Literal)
		if ok && literal.String() == name {
			return member.Value, true
		}
	}
	return hujson.Value{}, false
}

func configurationPatch(settings hujson.Value) json.RawMessage {
	return json.RawMessage(bytes.Join([][]byte{
		[]byte(`[{"op":"test","path":"/contributes/settings","value":`),
		settings.Pack(),
		[]byte(`},{"op":"move","from":"/contributes/settings","path":"/contributes/configuration"}]`),
	}, nil))
}

func patched(value hujson.Value, patch []byte) ([]byte, error) {
	candidate := value.Clone()
	if err := candidate.Patch(patch); err != nil {
		return nil, fmt.Errorf("apply %s patch: %w", MigrationID, err)
	}
	return candidate.Pack(), nil
}
