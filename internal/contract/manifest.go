package contract

// Manifest is Mill's machine-readable state (ADR-0036 decision 4):
// enough for an external agent to know which build it's talking to and
// which schema majors it supports, without guessing from an export's
// absence of a version field. Deliberately NOT embedded in entity
// exports -- see Document's own doc comment on why it stays a sibling
// of the static contract instead.
type Manifest struct {
	Version  string `json:"version"`
	Commit   string `json:"commit,omitempty"`
	Modified bool   `json:"modified"`
	// Mode is "desktop" or "server" -- mirrors settingssvc.BuildInfo.Server,
	// read from the same underlying build tag (internal/adapters/buildinfo).
	Mode    string       `json:"mode"`
	Schemas []SchemaInfo `json:"schemas"`
}

// SchemaInfo names one registered family's current schema id and major
// -- the manifest's answer to "which contract versions does this
// instance support," independent of any one export.
type SchemaInfo struct {
	Family string `json:"family"`
	Major  int    `json:"major"`
	ID     string `json:"id"`
}

// BuildManifest assembles a Manifest from the version string every
// caller already carries (main.go's millVersion, threaded through
// mcpsvc.NewMillMCPService) and a raw build-info reading (revision/
// modified/server) -- callers own reading internal/adapters/buildinfo
// themselves so this package stays free of any adapter dependency.
func BuildManifest(version, revision string, modified, server bool) Manifest {
	mode := "desktop"
	if server {
		mode = "server"
	}
	families := Families()
	schemas := make([]SchemaInfo, 0, len(families))
	for _, f := range families {
		schemas = append(schemas, SchemaInfo{Family: f, Major: SchemaMajor, ID: SchemaID(f)})
	}
	return Manifest{
		Version:  version,
		Commit:   revision,
		Modified: modified,
		Mode:     mode,
		Schemas:  schemas,
	}
}
