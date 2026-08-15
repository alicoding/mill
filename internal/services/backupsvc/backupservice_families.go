package backupsvc

// FamilyBundle wires one ADR-0036 per-id entity family (workflow,
// request, list, mcpserver, decision, aiprovider) into the
// export-everything/import-everything archive -- backupsvc never
// touches that family's storage itself, only its already-public
// Export*/Import*/list-accessor methods (compositionsvc.ExportWorkflow/
// ImportWorkflow/Workflows, configuresvc's equivalents), wired once
// from main.go once every owning service exists.
type FamilyBundle struct {
	// Name is the archive's own subdirectory ("workflows", "requests",
	// "lists", "mcpservers", "decisions", "aiproviders") and the label
	// shown in the export/import summary.
	Name string
	// IDs lists every entity this family currently holds locally --
	// used to classify an archive entry as a create or an update
	// without mutating anything (the preview pass).
	IDs func() []string
	// Export returns id's portable JSON, the same shape ExportWorkflow/
	// ExportHTTPRequest/etc. already produce.
	Export func(id string) (string, error)
	// Import applies one archive entry's JSON through the family's
	// normal uniform import rule (ADR-0036 decision 3) and returns the
	// id it landed at.
	Import func(jsonData string) (id string, err error)
}

// atlasBundle wires Atlas's own single-envelope export/import
// (atlasservice_export.go's own doc comment: Atlas's four entity
// families are one cohesive graph, not four independent
// FamilyBundle-shaped families) -- late-bound the same way as
// families, via SetAtlasBundle.
type atlasBundle struct {
	export func() (string, error)
	// apply mirrors AtlasService.ImportAtlas's own return shape
	// (created/updated counts per Atlas sub-family) -- summarized into
	// one archive-level row (backupservice_import.go) rather than
	// exposing atlassvc's own AtlasImportSummary type here, keeping
	// this package's own summary shape uniform across every family.
	apply func(jsonData string) (created, updated int, err error)
}

// SetFamilies wires the per-entity-family export/import bundle --
// called once from main.go, after every owning service exists.
//
//wails:ignore
func (b *BackupService) SetFamilies(families []FamilyBundle) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.families = families
}

// SetAtlasBundle wires Atlas's own export/import, called once from
// main.go alongside SetFamilies.
//
//wails:ignore
func (b *BackupService) SetAtlasBundle(export func() (string, error), apply func(jsonData string) (created, updated int, err error)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.atlas = atlasBundle{export: export, apply: apply}
}
