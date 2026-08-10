package configuresvc

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/httprequest"
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

func TestExportImportList_RoundTrips(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateList("My list", map[string]string{"a": "1", "b": "2"})
	if err != nil {
		t.Fatalf("CreateList: %v", err)
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
	if imported.Label != created.Label {
		t.Errorf("imported.Label = %q, want %q", imported.Label, created.Label)
	}
	if len(imported.Entries) != 2 || imported.Entries["a"] != "1" || imported.Entries["b"] != "2" {
		t.Errorf("imported.Entries = %+v, want a copy of %+v", imported.Entries, created.Entries)
	}
}

func TestExportList_IsDeterministic(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateList("My list", map[string]string{"a": "1", "b": "2", "c": "3"})
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
