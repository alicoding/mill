package main

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/connector"
	"github.com/zalando/go-keyring"
)

// TestMain swaps in an in-memory keyring for the whole package's test
// run -- ConfigureService's connector-secret methods go through the real
// internal/adapters/credential adapter, which isn't CI-testable against
// the real OS keychain (same class of gap docs/SPEC.md §1.3 notes for
// clipboard); credential's own package ships this mock specifically so
// callers don't have to skip-in-CI the way clipboard does.
func TestMain(m *testing.M) {
	keyring.MockInit()
	m.Run()
}

func newTestConfigureService(t *testing.T) (*ConfigureService, *CompositionService) {
	t.Helper()
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp)
	return cfg, comp
}

func TestCreateConnector_ValidatesAndPersists(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("My API", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if conn.ID == "" {
		t.Error("CreateConnector left ID empty, want a generated ID")
	}
	got := cfg.Connectors()
	if len(got) != 1 || got[0].ID != conn.ID {
		t.Errorf("Connectors() = %+v, want a single entry matching the created connector", got)
	}
}

func TestCreateConnector_InvalidRejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.CreateConnector("", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil); err == nil {
		t.Fatal("CreateConnector with an empty label returned nil error, want an error")
	}
}

func TestUpdateConnector_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.UpdateConnector("does-not-exist", "New label", connector.TypeHTTP, "https://example.com", connector.AuthNone, nil); err == nil {
		t.Fatal("UpdateConnector with an unknown id returned nil error, want an error")
	}
}

func TestDeleteConnector_RemovesItAndItsSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("My API", connector.TypeHTTP, "https://example.com", connector.AuthBearer, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if err := cfg.SetConnectorSecret(conn.ID, "tok123"); err != nil {
		t.Fatalf("SetConnectorSecret returned error: %v", err)
	}

	if err := cfg.DeleteConnector(conn.ID); err != nil {
		t.Fatalf("DeleteConnector returned error: %v", err)
	}
	if len(cfg.Connectors()) != 0 {
		t.Error("Connectors() still returns entries after DeleteConnector")
	}
	// resolveConnector (the only way this test can observe the secret
	// was actually cleared -- there is deliberately no GetSecret) should
	// now fail to find the connector at all, confirming both the entry
	// and its secret are gone.
	if _, err := cfg.resolveConnector(conn.ID); err == nil {
		t.Error("resolveConnector still resolves a deleted connector, want an error")
	}
}

func TestSetConnectorSecret_UnknownConnector_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if err := cfg.SetConnectorSecret("does-not-exist", "secret"); err == nil {
		t.Fatal("SetConnectorSecret for an unknown connector returned nil error, want an error")
	}
}

func TestResolveConnector_AuthNone_NoSecretNeeded(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("Public API", connector.TypeHTTP, "https://example.com", connector.AuthNone, map[string]string{"Accept": "application/json"})
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}

	rc, err := cfg.resolveConnector(conn.ID)
	if err != nil {
		t.Fatalf("resolveConnector returned error for an AuthNone connector with no secret set: %v", err)
	}
	if rc.BaseURL != "https://example.com" || rc.Headers["Accept"] != "application/json" {
		t.Errorf("resolveConnector = %+v, want the connector's own BaseURL/Headers", rc)
	}
}

func TestResolveConnector_AuthBearer_MissingSecret_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("Secured API", connector.TypeHTTP, "https://example.com", connector.AuthBearer, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if _, err := cfg.resolveConnector(conn.ID); err == nil {
		t.Fatal("resolveConnector for an AuthBearer connector with no secret set returned nil error, want an error")
	}
}

func TestResolveConnector_AuthBearer_ResolvesSecret(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	conn, err := cfg.CreateConnector("Secured API", connector.TypeHTTP, "https://example.com", connector.AuthBearer, nil)
	if err != nil {
		t.Fatalf("CreateConnector returned error: %v", err)
	}
	if err := cfg.SetConnectorSecret(conn.ID, "s3cr3t"); err != nil {
		t.Fatalf("SetConnectorSecret returned error: %v", err)
	}

	rc, err := cfg.resolveConnector(conn.ID)
	if err != nil {
		t.Fatalf("resolveConnector returned error: %v", err)
	}
	if rc.Secret != "s3cr3t" {
		t.Errorf("resolveConnector Secret = %q, want %q", rc.Secret, "s3cr3t")
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
