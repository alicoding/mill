package mcpsvc

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// TestMillMCPService_RealClientRoundTrip proves the whole path end to
// end against a real MCP client over real HTTP -- not a mock, not a
// direct Go call into the handler functions. Starts the actual service
// this repo ships, connects with the SDK's own client role (the same
// SDK Mill already uses server-side here and client-side in
// internal/adapters/mcpclient, §3.6), and exercises resources/list and
// resources/read exactly as an external agent's host would.
func TestMillMCPService_RealClientRoundTrip(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})

	svc := NewMillMCPService("0.0.0-test", comp, cfg, store)
	const addr = "127.0.0.1:18090"
	if err := svc.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() {
		// 2s previously flaked on shared CI runners under load
		// ("Shutdown: context deadline exceeded") -- a runner-
		// timing flake, not a real bug (goal 0021 Phase-1-remainder PR #20).
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := svc.Shutdown(ctx); err != nil {
			t.Errorf("Shutdown: %v", err)
		}
	}()

	if _, err := comp.CreateWorkflow("MCP e2e workflow", "for the real-client test",
		[]composition.Node{{ID: "t", NodeTypeID: "trigger-manual"}, {ID: "c", NodeTypeID: "capture-clipboard-html"}},
		[]composition.Edge{{ID: "e1", Source: "t", Target: "c"}}); err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	client := mcp.NewClient(&mcp.Implementation{Name: "mill-mcp-test-client", Version: "0.0.0"}, nil)
	transport := &mcp.StreamableClientTransport{Endpoint: "http://" + addr}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		t.Fatalf("client.Connect: %v", err)
	}
	defer func() { _ = session.Close() }()

	listed, err := session.ListResources(ctx, nil)
	if err != nil {
		t.Fatalf("ListResources: %v", err)
	}
	var sawWorkflowsIndex bool
	for _, r := range listed.Resources {
		if r.URI == "mill://workflows" {
			sawWorkflowsIndex = true
		}
	}
	if !sawWorkflowsIndex {
		t.Errorf("ListResources did not include mill://workflows, got %+v", listed.Resources)
	}

	readIndex, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: "mill://workflows"})
	if err != nil {
		t.Fatalf("ReadResource(mill://workflows): %v", err)
	}
	if len(readIndex.Contents) != 1 {
		t.Fatalf("readIndex.Contents has %d entries, want 1", len(readIndex.Contents))
	}
	if !strings.Contains(readIndex.Contents[0].Text, "MCP e2e workflow") {
		t.Errorf("workflows index doesn't mention the real created workflow:\n%s", readIndex.Contents[0].Text)
	}

	var entries []resourceIndexEntry
	if err := json.Unmarshal([]byte(readIndex.Contents[0].Text), &entries); err != nil {
		t.Fatalf("workflows index is not valid JSON: %v", err)
	}
	var workflowID string
	for _, e := range entries {
		if e.Label == "MCP e2e workflow" {
			workflowID = e.ID
		}
	}
	if workflowID == "" {
		t.Fatal("could not find the created workflow's ID in the index")
	}

	readOne, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: "mill://workflows/" + workflowID})
	if err != nil {
		t.Fatalf("ReadResource(mill://workflows/%s): %v", workflowID, err)
	}
	if !strings.Contains(readOne.Contents[0].Text, "capture-clipboard-html") {
		t.Errorf("single-workflow read doesn't contain the real node type:\n%s", readOne.Contents[0].Text)
	}

	if _, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: "mill://workflows/does-not-exist"}); err == nil {
		t.Error("ReadResource on an unknown workflow ID returned nil error, want a resource-not-found error")
	}
}

// TestMillMCPService_RequestResource_NeverLeaksSecretOverTheWire is a
// second, independent check of the same guarantee
// TestExportImportHTTPRequest_RoundTrips_NeverCarriesASecret already
// proves for the UI's Export button -- worth re-verifying through this
// separate code path (the MCP resource handler), not assumed to
// inherit the guarantee just because it calls the same ExportHTTPRequest
// function underneath.
func TestMillMCPService_RequestResource_NeverLeaksSecretOverTheWire(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})

	req, err := cfg.CreateHTTPRequest("MCP e2e request", "https://example.com", "", "", httprequest.AuthAPIKey, nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	if err := cfg.SetHTTPRequestSecret(req.ID, "super-secret-over-the-wire"); err != nil {
		t.Fatalf("SetHTTPRequestSecret: %v", err)
	}

	svc := NewMillMCPService("0.0.0-test", comp, cfg, store)
	const addr = "127.0.0.1:18091"
	if err := svc.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = svc.Shutdown(ctx)
	}()

	client := mcp.NewClient(&mcp.Implementation{Name: "mill-mcp-test-client", Version: "0.0.0"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr}, nil)
	if err != nil {
		t.Fatalf("client.Connect: %v", err)
	}
	defer func() { _ = session.Close() }()

	result, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: "mill://requests/" + req.ID})
	if err != nil {
		t.Fatalf("ReadResource: %v", err)
	}
	if strings.Contains(result.Contents[0].Text, "super-secret-over-the-wire") {
		t.Fatalf("the MCP resource response leaked the secret over the wire:\n%s", result.Contents[0].Text)
	}
}
