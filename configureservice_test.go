package main

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/zalando/go-keyring"
)

// TestMain swaps in an in-memory keyring for the whole package's test
// run -- ConfigureService's request-secret methods go through the real
// internal/adapters/credential adapter, which isn't CI-testable against
// the real OS keychain (same class of gap docs/SPEC.md §1.3 notes for
// clipboard); credential's own package ships this mock specifically so
// callers don't have to skip-in-CI the way clipboard does.
func TestMain(m *testing.M) {
	keyring.MockInit()
	m.Run()
}

// newTestConfigureService starts from a genuinely empty request list,
// not the seeded built-in examples (docs/SPEC.md §4's Update) --
// NewConfigureService's restore() seeds httprequest.BuiltIn() on any
// fresh store, same as CompositionService.restore() already does for
// BuiltInWorkflows, so every existing count-based assertion in this
// package (len(cfg.HTTPRequests()) != 1, etc.) would otherwise see 7
// unexpected entries. The seeding behavior itself gets its own
// dedicated tests in configureservice_builtin_test.go, which construct
// ConfigureService directly rather than through this helper.
func newTestConfigureService(t *testing.T) (*ConfigureService, *CompositionService) {
	t.Helper()
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp)
	cfg.requests = nil
	return cfg, comp
}

// HTTPRequest CRUD/auth/JOSE tests live in
// configureservice_requestauth_test.go (split out once this file
// crossed the 500-line limit, mirroring the configureservice_requestauth.go
// source split). Lists/Attributes/MCP Server tests stay here.

// TestRestore_MigratesLegacyConnectorsKey proves ADR-0016's migration
// plan against a real scenario, not just the code reading correctly:
// a real machine's pre-rename settings.json holds data under the old
// connectorsKey (unlike composition-workflows -> -v2's own precedent,
// this key holds real current data that must not be silently dropped
// on upgrade). restore() must migrate it into c.requests, and persist
// it forward under the new requestsKey so a second restore (the next
// launch) reads it from there directly rather than re-migrating.
func TestRestore_MigratesLegacyConnectorsKey(t *testing.T) {
	store := newFakeStore()
	legacy := `[{"ID":"old-1","Label":"Old API","BaseURL":"https://old.example.com","AuthType":"none","Type":"http"}]`
	_ = store.Set(legacyConnectorsKey, legacy)

	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp)

	got := cfg.HTTPRequests()
	if len(got) != 1 || got[0].ID != "old-1" || got[0].Label != "Old API" {
		t.Fatalf("HTTPRequests() after legacy migration = %+v, want the migrated old-1 entry", got)
	}

	restarted := NewConfigureService(store, comp)
	if len(restarted.HTTPRequests()) != 1 || restarted.HTTPRequests()[0].ID != "old-1" {
		t.Fatalf("HTTPRequests() after restart = %+v, want the migrated entry to persist under the new key", restarted.HTTPRequests())
	}
}

func TestCreateList_ValidatesAndPersists(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	l, err := cfg.CreateList("Region codes", map[string]string{"US": "United States"})
	if err != nil {
		t.Fatalf("CreateList returned error: %v", err)
	}
	got := cfg.Lists()
	if len(got) != 1 || got[0].ID != l.ID {
		t.Errorf("Lists() = %+v, want a single entry matching the created list", got)
	}
}

func TestUpdateList_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.UpdateList("does-not-exist", "New label", nil); err == nil {
		t.Fatal("UpdateList with an unknown id returned nil error, want an error")
	}
}

func TestDeleteList_RemovesIt(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	l, err := cfg.CreateList("Region codes", nil)
	if err != nil {
		t.Fatalf("CreateList returned error: %v", err)
	}
	if err := cfg.DeleteList(l.ID); err != nil {
		t.Fatalf("DeleteList returned error: %v", err)
	}
	if len(cfg.Lists()) != 0 {
		t.Error("Lists() still returns entries after DeleteList")
	}
}

func TestResolveList_ReturnsEntries(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	l, err := cfg.CreateList("Region codes", map[string]string{"US": "United States"})
	if err != nil {
		t.Fatalf("CreateList returned error: %v", err)
	}
	rl, err := cfg.resolveList(l.ID)
	if err != nil {
		t.Fatalf("resolveList returned error: %v", err)
	}
	if rl.Entries["US"] != "United States" {
		t.Errorf("resolveList Entries = %+v, want US -> United States", rl.Entries)
	}
}

func TestResolveList_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.resolveList("does-not-exist"); err == nil {
		t.Fatal("resolveList with an unknown id returned nil error, want an error")
	}
}

func TestUpdateWorkflowAttributes_DelegatesToCompositionService(t *testing.T) {
	cfg, comp := newTestConfigureService(t)
	wf, err := comp.CreateWorkflow("My workflow", "", []composition.Node{{NodeTypeID: "capture-clipboard-html"}}, nil)
	if err != nil {
		t.Fatalf("CreateWorkflow returned error: %v", err)
	}

	attrs := []composition.AttributeDef{{Key: "region", Label: "Region", Type: composition.FieldText}}
	updated, err := cfg.UpdateWorkflowAttributes(wf.ID, attrs)
	if err != nil {
		t.Fatalf("UpdateWorkflowAttributes returned error: %v", err)
	}
	if len(updated.Attributes) != 1 || updated.Attributes[0].Key != "region" {
		t.Errorf("UpdateWorkflowAttributes result Attributes = %+v, want the new schema", updated.Attributes)
	}
}

func TestUpdateWorkflowAttributes_UnknownWorkflow_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.UpdateWorkflowAttributes("does-not-exist", nil); err == nil {
		t.Fatal("UpdateWorkflowAttributes for an unknown workflow returned nil error, want an error")
	}
}

// --- MCP Servers --- ListMCPServerTools' successful-call path needs a
// real MCP server subprocess to connect to (mcpclient.ListTools uses a
// real CommandTransport) -- that round-trip is already real-protocol
// tested at internal/adapters/mcpclient's own level via an in-memory
// transport; these tests cover what's testable at this layer without
// one: CRUD, resolution, and the unknown-id error path.

func TestCreateMCPServer_ValidatesAndPersists(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	s, err := cfg.CreateMCPServer("My MCP Server", "my-mcp-server", []string{"--flag"})
	if err != nil {
		t.Fatalf("CreateMCPServer returned error: %v", err)
	}
	if s.ID == "" {
		t.Error("CreateMCPServer left ID empty, want a generated ID")
	}
	got := cfg.MCPServers()
	if len(got) != 1 || got[0].ID != s.ID {
		t.Errorf("MCPServers() = %+v, want a single entry matching the created server", got)
	}
}

func TestCreateMCPServer_InvalidRejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.CreateMCPServer("", "my-mcp-server", nil); err == nil {
		t.Fatal("CreateMCPServer with an empty label returned nil error, want an error")
	}
}

func TestUpdateMCPServer_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.UpdateMCPServer("does-not-exist", "New label", "cmd", nil); err == nil {
		t.Fatal("UpdateMCPServer with an unknown id returned nil error, want an error")
	}
}

func TestDeleteMCPServer_RemovesIt(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	s, err := cfg.CreateMCPServer("My MCP Server", "my-mcp-server", nil)
	if err != nil {
		t.Fatalf("CreateMCPServer returned error: %v", err)
	}
	if err := cfg.DeleteMCPServer(s.ID); err != nil {
		t.Fatalf("DeleteMCPServer returned error: %v", err)
	}
	if len(cfg.MCPServers()) != 0 {
		t.Error("MCPServers() still returns entries after DeleteMCPServer")
	}
}

func TestResolveMCPServer_ReturnsCommandAndArgs(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	s, err := cfg.CreateMCPServer("My MCP Server", "my-mcp-server", []string{"--flag", "value"})
	if err != nil {
		t.Fatalf("CreateMCPServer returned error: %v", err)
	}
	rs, err := cfg.resolveMCPServer(s.ID)
	if err != nil {
		t.Fatalf("resolveMCPServer returned error: %v", err)
	}
	if rs.Command != "my-mcp-server" || len(rs.Args) != 2 {
		t.Errorf("resolveMCPServer = %+v, want the server's own Command/Args", rs)
	}
}

func TestResolveMCPServer_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.resolveMCPServer("does-not-exist"); err == nil {
		t.Fatal("resolveMCPServer with an unknown id returned nil error, want an error")
	}
}

func TestListMCPServerTools_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.ListMCPServerTools("does-not-exist"); err == nil {
		t.Fatal("ListMCPServerTools for an unknown server returned nil error, want an error")
	}
}
