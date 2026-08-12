package configuresvc

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

func TestExportImportHTTPRequest_RoundTrips_NeverCarriesASecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateHTTPRequest("My request", "https://example.com", "QUERY", "", httprequest.AuthAPIKey, nil, "", nil, nil, "a description")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	if err := cfg.SetHTTPRequestSecret(created.ID, "super-secret-value"); err != nil {
		t.Fatalf("SetHTTPRequestSecret: %v", err)
	}

	exported, err := cfg.ExportHTTPRequest(created.ID)
	if err != nil {
		t.Fatalf("ExportHTTPRequest: %v", err)
	}
	if strings.Contains(exported, "super-secret-value") {
		t.Fatalf("exported HTTPRequest JSON leaked the secret value:\n%s", exported)
	}

	var raw map[string]any
	if err := json.Unmarshal([]byte(exported), &raw); err != nil {
		t.Fatalf("exported output is not valid JSON: %v", err)
	}
	if _, ok := raw["id"]; ok {
		t.Error("exported JSON carries an id field -- should be omitted")
	}

	imported, err := cfg.ImportHTTPRequest(exported)
	if err != nil {
		t.Fatalf("ImportHTTPRequest: %v", err)
	}
	if imported.ID == created.ID {
		t.Error("ImportHTTPRequest reused the original ID -- should always mint a new one")
	}
	if imported.Label != created.Label || imported.BaseURL != created.BaseURL || imported.AuthType != created.AuthType {
		t.Errorf("imported = %+v, want matching Label/BaseURL/AuthType from %+v", imported, created)
	}
	// ADR-0016 Phase B: Method is part of the wire shape -- an open
	// method (QUERY) survives the round trip, not just the common verbs.
	if imported.Method != "QUERY" {
		t.Errorf("imported.Method = %q, want QUERY", imported.Method)
	}
	// The imported request never had SetHTTPRequestSecret called on it --
	// it should have no usable secret of its own.
	if _, err := cfg.credentials.Get(imported.ID); err == nil {
		t.Error("imported HTTPRequest has a secret in the keychain -- import must never carry one over")
	}
}

func testListColumns() []typedfield.Field {
	return []typedfield.Field{
		{Key: "a", Label: "A", Type: typedfield.TypeText},
		{Key: "b", Label: "B", Type: typedfield.TypeText},
	}
}

func TestExportImportList_RoundTrips(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateList("My list", "a list", testListColumns())
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	created, err = cfg.AddListRow(created.ID, map[string]string{"a": "1", "b": "2"})
	if err != nil {
		t.Fatalf("AddListRow: %v", err)
	}

	exported, err := cfg.ExportList(created.ID)
	if err != nil {
		t.Fatalf("ExportList: %v", err)
	}
	imported, err := cfg.ImportList(exported)
	if err != nil {
		t.Fatalf("ImportList: %v", err)
	}

	if imported.ID == created.ID {
		t.Error("ImportList reused the original ID -- should always mint a new one")
	}
	if imported.Label != created.Label || imported.Description != created.Description {
		t.Errorf("imported = %+v, want matching Label/Description from %+v", imported, created)
	}
	if len(imported.Columns) != 2 {
		t.Errorf("imported.Columns = %+v, want 2 columns", imported.Columns)
	}
	if len(imported.Rows) != 1 || imported.Rows[0].Values["a"] != "1" || imported.Rows[0].Values["b"] != "2" {
		t.Errorf("imported.Rows = %+v, want a copy of the one created row", imported.Rows)
	}
}

func TestImportList_LegacyEntriesShape_Migrates(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	// An old export document written before goal 0011 -- no
	// columns/rows, just the flat key/value shape.
	legacy := `{"label":"Old list","entries":{"US":"United States","CA":"Canada"}}`
	imported, err := cfg.ImportList(legacy)
	if err != nil {
		t.Fatalf("ImportList(legacy shape): %v", err)
	}
	if len(imported.Columns) != 2 || imported.Columns[0].Key != "key" || imported.Columns[1].Key != "value" {
		t.Fatalf("imported.Columns = %+v, want synthesized [key, value]", imported.Columns)
	}
	if len(imported.Rows) != 2 {
		t.Fatalf("imported.Rows = %+v, want 2 rows", imported.Rows)
	}
	entries := map[string]string{}
	for _, r := range imported.Rows {
		entries[r.Values["key"]] = r.Values["value"]
	}
	if entries["US"] != "United States" || entries["CA"] != "Canada" {
		t.Errorf("imported entries = %+v, want the legacy key/value pairs preserved", entries)
	}
}

func TestExportList_IsDeterministic(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateList("My list", "", testListColumns())
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}

	first, err := cfg.ExportList(created.ID)
	if err != nil {
		t.Fatalf("first ExportList: %v", err)
	}
	second, err := cfg.ExportList(created.ID)
	if err != nil {
		t.Fatalf("second ExportList: %v", err)
	}
	if first != second {
		t.Errorf("two exports of an unchanged list produced different output.\nfirst:\n%s\nsecond:\n%s", first, second)
	}
}

func TestExportImportMCPServer_RoundTrips(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateMCPServer("My server", "npx", []string{"-y", "some-package"})
	if err != nil {
		t.Fatalf("CreateMCPServer: %v", err)
	}

	exported, err := cfg.ExportMCPServer(created.ID)
	if err != nil {
		t.Fatalf("ExportMCPServer: %v", err)
	}
	imported, err := cfg.ImportMCPServer(exported)
	if err != nil {
		t.Fatalf("ImportMCPServer: %v", err)
	}

	if imported.ID == created.ID {
		t.Error("ImportMCPServer reused the original ID -- should always mint a new one")
	}
	if imported.Label != created.Label || imported.Command != created.Command || len(imported.Args) != len(created.Args) {
		t.Errorf("imported = %+v, want matching Label/Command/Args from %+v", imported, created)
	}
}

func TestExportHTTPRequest_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.ExportHTTPRequest("does-not-exist"); err == nil {
		t.Error("ExportHTTPRequest(unknown id) returned nil error, want one")
	}
}

func TestExportList_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.ExportList("does-not-exist"); err == nil {
		t.Error("ExportList(unknown id) returned nil error, want one")
	}
}

func TestExportMCPServer_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.ExportMCPServer("does-not-exist"); err == nil {
		t.Error("ExportMCPServer(unknown id) returned nil error, want one")
	}
}

func TestImportList_InvalidJSON_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.ImportList("not json"); err == nil {
		t.Error("ImportList(invalid JSON) returned nil error, want one")
	}
}

func TestImportMCPServer_MissingCommand_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.ImportMCPServer(`{"label":"no command"}`); err == nil {
		t.Error("ImportMCPServer with no command returned nil error, want one (matches CreateMCPServer's own validation)")
	}
}
