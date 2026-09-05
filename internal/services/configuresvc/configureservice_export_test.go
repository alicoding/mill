package configuresvc

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// stripIDField removes the top-level "id" key from a JSON object
// document -- used to force ADR-0036 decision 3's fresh-create path in
// a test whose exported payload would otherwise carry an id matching a
// local entity (the update-in-place path).
func stripIDField(t *testing.T, doc string) string {
	t.Helper()
	var raw map[string]any
	if err := json.Unmarshal([]byte(doc), &raw); err != nil {
		t.Fatalf("stripIDField: invalid JSON: %v", err)
	}
	delete(raw, "id")
	out, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("stripIDField: re-marshal: %v", err)
	}
	return string(out)
}

// TestExportImportHTTPRequest_KnownID_UpdatesInPlace pins ADR-0036
// decision 3's update path: an export's id now matches its source
// request, so importing it back updates that request rather than
// creating a duplicate -- and never touches the keychain (UpdateHTTP
// Request doesn't), so the existing secret survives the round trip.
func TestExportImportHTTPRequest_KnownID_UpdatesInPlace(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateHTTPRequest("My request", "https://example.com", "QUERY", "", httprequest.AuthAPIKey, "", nil, "", nil, nil, "a description")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	storeRequestSecret(t, cfg, created.ID, "super-secret-value")

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
	if got, _ := raw["id"].(string); got != created.ID {
		t.Errorf("exported id = %q, want %q", got, created.ID)
	}

	imported, err := cfg.ImportHTTPRequest(exported)
	if err != nil {
		t.Fatalf("ImportHTTPRequest: %v", err)
	}
	if imported.ID != created.ID {
		t.Errorf("ImportHTTPRequest.ID = %q, want the same id %q (update in place)", imported.ID, created.ID)
	}
	if imported.Label != created.Label || imported.BaseURL != created.BaseURL || imported.AuthType != created.AuthType {
		t.Errorf("imported = %+v, want matching Label/BaseURL/AuthType from %+v", imported, created)
	}
	// ADR-0016 Phase B: Method is part of the wire shape -- an open
	// method (QUERY) survives the round trip, not just the common verbs.
	if imported.Method != "QUERY" {
		t.Errorf("imported.Method = %q, want QUERY", imported.Method)
	}
	// The reference survives the round trip: an export carries which
	// entry a request names, never the credential itself (goal 0306).
	stored, found := findRequestByID(cfg.HTTPRequests(), created.ID)
	if !found || imported.SecretRef == "" || imported.SecretRef != stored.SecretRef {
		t.Errorf("imported.SecretRef = %q, want the request's own %q", imported.SecretRef, stored.SecretRef)
	}
}

// TestExportImportHTTPRequest_NoID_CreatesFreshWithoutASecret covers
// decision 3's fresh-create path: an id-less payload (a hand-authored
// file, or any export written before ADR-0036) mints a new request
// with no secret of its own -- ExportHTTPRequest never puts one on the
// wire in the first place.
func TestExportImportHTTPRequest_NoID_CreatesFreshWithoutASecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateHTTPRequest("My request", "https://example.com", "GET", "", httprequest.AuthAPIKey, "", nil, "", nil, nil, "a description")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	storeRequestSecret(t, cfg, created.ID, "super-secret-value")
	exported, err := cfg.ExportHTTPRequest(created.ID)
	if err != nil {
		t.Fatalf("ExportHTTPRequest: %v", err)
	}
	fresh := stripIDField(t, exported)

	imported, err := cfg.ImportHTTPRequest(fresh)
	if err != nil {
		t.Fatalf("ImportHTTPRequest: %v", err)
	}
	if imported.ID == created.ID {
		t.Error("ImportHTTPRequest of an id-less payload reused the original ID -- should mint a fresh one")
	}
	if _, err := cfg.credentials.Get(imported.ID); err == nil {
		t.Error("freshly created HTTPRequest has a secret in the keychain -- import must never carry one over")
	}
}

func testListColumns() []typedfield.Field {
	return []typedfield.Field{
		{Key: "a", Label: "A", Type: typedfield.TypeText},
		{Key: "b", Label: "B", Type: typedfield.TypeText},
	}
}

// TestExportImportList_KnownID_UpdatesInPlace pins ADR-0036 decision
// 3's update path for List.
func TestExportImportList_KnownID_UpdatesInPlace(t *testing.T) {
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

	if imported.ID != created.ID {
		t.Errorf("ImportList.ID = %q, want the same id %q (update in place)", imported.ID, created.ID)
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
	if got := cfg.Lists(); len(got) != 1 {
		t.Errorf("Lists() has %d entries, want 1 (updated in place, not duplicated)", len(got))
	}
}

// TestExportImportList_NoID_CreatesFresh covers decision 3's
// fresh-create path for List.
func TestExportImportList_NoID_CreatesFresh(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateList("My list", "a list", testListColumns())
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	exported, err := cfg.ExportList(created.ID)
	if err != nil {
		t.Fatalf("ExportList: %v", err)
	}
	fresh := stripIDField(t, exported)

	imported, err := cfg.ImportList(fresh)
	if err != nil {
		t.Fatalf("ImportList: %v", err)
	}
	if imported.ID == created.ID {
		t.Error("ImportList of an id-less payload reused the original ID -- should mint a fresh one")
	}
	if got := cfg.Lists(); len(got) != 2 {
		t.Errorf("Lists() has %d entries, want 2", len(got))
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

// TestExportImportMCPServer_KnownID_UpdatesInPlace pins ADR-0036
// decision 3's update path for MCPServer.
func TestExportImportMCPServer_KnownID_UpdatesInPlace(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateMCPServer("My server", "npx", []string{"-y", "some-package"}, nil)
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

	if imported.ID != created.ID {
		t.Errorf("ImportMCPServer.ID = %q, want the same id %q (update in place)", imported.ID, created.ID)
	}
	if imported.Label != created.Label || imported.Command != created.Command || len(imported.Args) != len(created.Args) {
		t.Errorf("imported = %+v, want matching Label/Command/Args from %+v", imported, created)
	}
	if got := cfg.MCPServers(); len(got) != 1 {
		t.Errorf("MCPServers() has %d entries, want 1 (updated in place, not duplicated)", len(got))
	}
}

// TestExportImportMCPServer_NoID_CreatesFresh covers decision 3's
// fresh-create path for MCPServer.
func TestExportImportMCPServer_NoID_CreatesFresh(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateMCPServer("My server", "npx", []string{"-y", "some-package"}, nil)
	if err != nil {
		t.Fatalf("CreateMCPServer: %v", err)
	}
	exported, err := cfg.ExportMCPServer(created.ID)
	if err != nil {
		t.Fatalf("ExportMCPServer: %v", err)
	}
	fresh := stripIDField(t, exported)

	imported, err := cfg.ImportMCPServer(fresh)
	if err != nil {
		t.Fatalf("ImportMCPServer: %v", err)
	}
	if imported.ID == created.ID {
		t.Error("ImportMCPServer of an id-less payload reused the original ID -- should mint a fresh one")
	}
	if got := cfg.MCPServers(); len(got) != 2 {
		t.Errorf("MCPServers() has %d entries, want 2", len(got))
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
