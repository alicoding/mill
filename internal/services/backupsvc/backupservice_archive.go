package backupsvc

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"time"
)

// manifestSchema names the export-everything archive's own top-level
// shape -- deliberately NOT registered with internal/contract
// (ADR-0036's per-family JSON-Schema registry): the archive is a
// container of existing, already-schema'd family envelopes plus a
// database snapshot, not itself a new entity family with its own
// evolving shape, so a JSON Schema for it would have nothing real to
// describe beyond "a zip with these paths in it."
const manifestSchema = "mill://backup/v1"

// manifest is the archive's own manifest.json -- informational
// metadata read by PreviewImportEverything/ImportEverything, never
// validated field-by-field the way a family envelope's schema id is
// (ValidateImportSchema): an absent or unrecognized Schema is treated
// as "not a Mill backup archive" and rejected outright, matching every
// other Import*'s own "reject wrong-family/garbage input" posture.
type manifest struct {
	Schema      string    `json:"schema"`
	MillVersion string    `json:"millVersion"`
	TakenAt     time.Time `json:"takenAt"`
	HasSnapshot bool      `json:"hasSnapshot"`
}

// archiveEntry is one family member's parsed archive file: its own
// declared id (per ADR-0036, every export envelope carries one; empty
// means "this entry mints a fresh entity on import," the same as
// every existing Import* method's own uniform rule) and its raw JSON,
// unchanged, ready to hand straight to that family's Import func.
type archiveEntry struct {
	id   string
	data string
}

// writeZipFile adds one text file to zw -- shared by every export
// call site (per-family envelopes, atlas.json, manifest.json).
func writeZipFile(zw *zip.Writer, name, content string) error {
	w, err := zw.Create(name)
	if err != nil {
		return fmt.Errorf("export everything: create %q: %w", name, err)
	}
	if _, err := w.Write([]byte(content)); err != nil {
		return fmt.Errorf("export everything: write %q: %w", name, err)
	}
	return nil
}

// readArchiveManifest parses zr's own manifest.json (absent manifest
// -> the zero manifest, accepted the same way every Import*'s own
// absent-schema case is -- an archive produced before this field
// existed). A schema mismatch is rejected outright: this isn't a Mill
// export-everything archive at all.
func readArchiveManifest(zr *zip.Reader) (manifest, error) {
	f, err := zr.Open("manifest.json")
	if err != nil {
		return manifest{}, nil //nolint:nilerr // no manifest at all is accepted, same as every Import*'s absent-schema case
	}
	defer func() { _ = f.Close() }()

	data, err := io.ReadAll(f)
	if err != nil {
		return manifest{}, fmt.Errorf("import everything: read manifest: %w", err)
	}
	var man manifest
	if err := json.Unmarshal(data, &man); err != nil {
		return manifest{}, fmt.Errorf("import everything: parse manifest: %w", err)
	}
	if man.Schema != "" && man.Schema != manifestSchema {
		return manifest{}, fmt.Errorf("import everything: unrecognized archive schema %q", man.Schema)
	}
	return man, nil
}

// hasZipEntry reports whether name is present in zr, byte-exact.
func hasZipEntry(zr *zip.Reader, name string) bool {
	for _, f := range zr.File {
		if f.Name == name {
			return true
		}
	}
	return false
}

// readWholeFile reads name's full content out of zr as a string.
func readWholeFile(zr *zip.Reader, name string) (string, error) {
	f, err := zr.Open(name)
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()
	data, err := io.ReadAll(f)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// familyEntries lists every archived member of one FamilyBundle
// (files under "<name>/*.json"), parsing each entry's own declared
// "id" field generically -- backupsvc deliberately never unmarshals a
// family's full domain shape (that stays each family's own Import
// func's job); only the id is needed here, to classify create-vs-
// update without mutating anything.
func familyEntries(zr *zip.Reader, name string) ([]archiveEntry, error) {
	prefix := name + "/"
	var entries []archiveEntry
	for _, f := range zr.File {
		if len(f.Name) <= len(prefix) || f.Name[:len(prefix)] != prefix {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("import everything: open %q: %w", f.Name, err)
		}
		data, err := io.ReadAll(rc)
		closeErr := rc.Close()
		if err != nil {
			return nil, fmt.Errorf("import everything: read %q: %w", f.Name, err)
		}
		if closeErr != nil {
			return nil, fmt.Errorf("import everything: close %q: %w", f.Name, closeErr)
		}
		var parsed struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(data, &parsed) // best-effort -- an unparsed/absent id just means "create fresh" below
		entries = append(entries, archiveEntry{id: parsed.ID, data: string(data)})
	}
	return entries, nil
}

// countAtlasItems counts atlas.json's own kinds+linkKinds+cards+links
// entries without depending on atlassvc's private exported* types --
// the wire field names (ADR-0036) are stable public contract, unlike
// the Go types behind them.
func countAtlasItems(data string) int {
	var raw struct {
		Kinds     []json.RawMessage `json:"kinds"`
		LinkKinds []json.RawMessage `json:"linkKinds"`
		Cards     []json.RawMessage `json:"cards"`
		Links     []json.RawMessage `json:"links"`
	}
	if err := json.Unmarshal([]byte(data), &raw); err != nil {
		return 0
	}
	return len(raw.Kinds) + len(raw.LinkKinds) + len(raw.Cards) + len(raw.Links)
}

// toSet turns an id list into a membership set for O(1) existence
// checks -- shared by preview and apply, which both need "is this
// archived id already known locally" without mutating anything.
func toSet(ids []string) map[string]bool {
	m := make(map[string]bool, len(ids))
	for _, id := range ids {
		m[id] = true
	}
	return m
}
