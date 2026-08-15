package atlassvc

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// TestExportAtlas_Deterministic pins ADR-0036 decision 3's determinism
// guarantee: exporting twice with no intervening change produces
// byte-identical bytes.
func TestExportAtlas_Deterministic(t *testing.T) {
	a := newTestAtlasService(t)
	first, err := a.ExportAtlas()
	if err != nil {
		t.Fatalf("ExportAtlas (1st): %v", err)
	}
	second, err := a.ExportAtlas()
	if err != nil {
		t.Fatalf("ExportAtlas (2nd): %v", err)
	}
	if first != second {
		t.Error("ExportAtlas is not deterministic across two calls with no intervening change")
	}
}

// TestExportAtlas_CarriesSchemaID proves every export names its
// envelope's contract id (ADR-0036 decision 2).
func TestExportAtlas_CarriesSchemaID(t *testing.T) {
	a := newTestAtlasService(t)
	data, err := a.ExportAtlas()
	if err != nil {
		t.Fatalf("ExportAtlas: %v", err)
	}
	if !strings.Contains(data, `"schema": "mill://schema/atlas/v1"`) {
		t.Errorf("ExportAtlas output missing schema id:\n%s", data)
	}
}

// TestImportAtlas_IDAbsent_Creates covers ADR-0036 decision 3's first
// id-semantics case: an entity with no id mints a fresh local one.
func TestImportAtlas_IDAbsent_Creates(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	before := len(a.Kinds())

	bundle := `{"schema":"mill://schema/atlas/v1","kinds":[{"label":"Widget","fields":[]}]}`
	summary, err := a.ImportAtlas(bundle)
	if err != nil {
		t.Fatalf("ImportAtlas: %v", err)
	}
	if summary.KindsCreated != 1 || summary.KindsUpdated != 0 {
		t.Errorf("summary = %+v, want KindsCreated=1", summary)
	}
	if got := len(a.Kinds()); got != before+1 {
		t.Errorf("Kinds() count = %d, want %d", got, before+1)
	}
	found := false
	for _, k := range a.Kinds() {
		if k.Label == "Widget" {
			found = true
			if k.ID == "" {
				t.Error("imported kind has no minted id")
			}
		}
	}
	if !found {
		t.Error("imported Kind \"Widget\" not found")
	}
}

// TestImportAtlas_IDKnown_Updates covers the second id-semantics case:
// an id matching a local entity updates it in place rather than
// creating a duplicate.
func TestImportAtlas_IDKnown_Updates(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	k, err := a.CreateKind("Widget", "original", "", nil)
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	before := len(a.Kinds())

	bundle, err := json.Marshal(exportedAtlas{
		Schema: "mill://schema/atlas/v1",
		Kinds:  []exportedKind{{ID: k.ID, Label: "Widget v2", Description: "updated"}},
	})
	if err != nil {
		t.Fatalf("marshal bundle: %v", err)
	}
	summary, err := a.ImportAtlas(string(bundle))
	if err != nil {
		t.Fatalf("ImportAtlas: %v", err)
	}
	if summary.KindsCreated != 0 || summary.KindsUpdated != 1 {
		t.Errorf("summary = %+v, want KindsUpdated=1", summary)
	}
	if got := len(a.Kinds()); got != before {
		t.Errorf("Kinds() count changed from %d to %d, want no change (update, not create)", before, got)
	}
	for _, got := range a.Kinds() {
		if got.ID == k.ID && got.Description != "updated" {
			t.Errorf("kind %q Description = %q, want %q", k.ID, got.Description, "updated")
		}
	}
}

// TestImportAtlas_IDUnknown_CreatesPreservingID covers the third
// id-semantics case: an id present but unrecognized locally creates a
// new entity AT that id -- the two-machine bridge identity ADR-0036
// exists for.
func TestImportAtlas_IDUnknown_CreatesPreservingID(t *testing.T) {
	a := NewAtlasService(servicetest.NewFakeStore())
	const foreignID = "atlas-kind-from-another-machine"

	bundle, err := json.Marshal(exportedAtlas{
		Schema: "mill://schema/atlas/v1",
		Kinds:  []exportedKind{{ID: foreignID, Label: "Widget"}},
	})
	if err != nil {
		t.Fatalf("marshal bundle: %v", err)
	}
	summary, err := a.ImportAtlas(string(bundle))
	if err != nil {
		t.Fatalf("ImportAtlas: %v", err)
	}
	if summary.KindsCreated != 1 {
		t.Errorf("summary = %+v, want KindsCreated=1", summary)
	}
	found := false
	for _, k := range a.Kinds() {
		if k.ID == foreignID {
			found = true
		}
	}
	if !found {
		t.Errorf("ImportAtlas did not preserve the foreign id %q", foreignID)
	}
}

// TestImportAtlas_RoundTrip proves ExportAtlas's output re-imports into
// a FRESH instance and reproduces the same graph, including containment
// (a card whose bundle entry appears before its parent still lands
// correctly, since ImportAtlas applies placement in a second pass).
func TestImportAtlas_RoundTrip(t *testing.T) {
	source := NewAtlasService(servicetest.NewFakeStore())
	kind, err := source.CreateKind("Widget", "", "", []typedfield.Field{{Key: "size", Type: typedfield.TypeText}})
	if err != nil {
		t.Fatalf("CreateKind: %v", err)
	}
	linkKind, err := source.CreateLinkKind("relates to", "")
	if err != nil {
		t.Fatalf("CreateLinkKind: %v", err)
	}
	parent, err := source.CreateCard(kind.ID, "Parent", "", nil, "", nil, atlas.ViewModeCanvas, "", "", "")
	if err != nil {
		t.Fatalf("CreateCard parent: %v", err)
	}
	child, err := source.CreateCard(kind.ID, "Child", "", map[string]string{"size": "M"}, parent.ID, &atlas.Position{X: 10, Y: 20}, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard child: %v", err)
	}
	if _, err := source.CreateLink(parent.ID, child.ID, linkKind.ID, "contains"); err != nil {
		t.Fatalf("CreateLink: %v", err)
	}

	data, err := source.ExportAtlas()
	if err != nil {
		t.Fatalf("ExportAtlas: %v", err)
	}

	target := NewAtlasService(servicetest.NewFakeStore())
	if _, err := target.ImportAtlas(data); err != nil {
		t.Fatalf("ImportAtlas: %v", err)
	}

	var gotChild atlas.Card
	found := false
	for _, c := range target.Cards() {
		if c.ID == child.ID {
			gotChild, found = c, true
		}
	}
	if !found {
		t.Fatalf("imported card %q not found", child.ID)
	}
	if gotChild.ParentID != parent.ID {
		t.Errorf("imported child's ParentID = %q, want %q", gotChild.ParentID, parent.ID)
	}
	if gotChild.Position == nil || gotChild.Position.X != 10 || gotChild.Position.Y != 20 {
		t.Errorf("imported child's Position = %+v, want {10 20}", gotChild.Position)
	}
	if gotChild.Fields["size"] != "M" {
		t.Errorf("imported child's Fields[size] = %q, want %q", gotChild.Fields["size"], "M")
	}

	linksFound := 0
	for _, l := range target.Links() {
		if l.FromCardID == parent.ID && l.ToCardID == child.ID {
			linksFound++
		}
	}
	if linksFound != 1 {
		t.Errorf("imported Links containing the parent->child relation = %d, want 1", linksFound)
	}
}

// TestImportAtlas_WrongSchemaFamily_Rejected pins ADR-0036 decision
// 2's cross-family rejection.
func TestImportAtlas_WrongSchemaFamily_Rejected(t *testing.T) {
	a := newTestAtlasService(t)
	_, err := a.ImportAtlas(`{"schema":"mill://schema/workflow/v1","kinds":[]}`)
	if err == nil {
		t.Error("ImportAtlas() with a foreign schema id = nil error, want an error")
	}
}
