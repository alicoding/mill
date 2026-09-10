package mcpsvc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func providerReportFromTool(t *testing.T, result *mcp.CallToolResult) aiprovider.Report {
	t.Helper()
	if result.IsError || len(result.Content) != 1 {
		t.Fatalf("tool result = %+v", result)
	}
	text, ok := result.Content[0].(*mcp.TextContent)
	if !ok {
		t.Fatalf("tool content = %T", result.Content[0])
	}
	var report aiprovider.Report
	if err := json.Unmarshal([]byte(text.Text), &report); err != nil {
		t.Fatalf("decode report: %v\n%s", err, text.Text)
	}
	return report
}

func TestAIProviderAvailabilityTools_UseTheSameGuardedCoordinatorAsWails(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	p, err := cfg.CreateAIProvider("MCP provider", aiprovider.KindOpenAICompat, "http://127.0.0.1:1", "model", "")
	if err != nil {
		t.Fatal(err)
	}
	requests := make(chan configuresvc.ProviderCheckPermissionRequest, 2)
	configuresvc.SetAIProviderCheckAuthorizer(cfg, func(ctx context.Context, request configuresvc.ProviderCheckPermissionRequest) (aiprovider.PermissionResult, error) {
		requests <- request
		<-ctx.Done()
		return aiprovider.PermissionResult{}, ctx.Err()
	})

	direct := cfg.StartAIProviderCheck(p.ID)
	select {
	case request := <-requests:
		if request.Actor != "configure" || request.CheckID != direct.CheckID {
			t.Fatalf("direct permission request = %+v", request)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("direct start did not reach coordinator authorizer")
	}
	_ = cfg.CancelAIProviderCheck(p.ID, direct.CheckID)

	service := NewMillMCPService("test", comp, cfg, store, nil)
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	serverSession, err := service.server.Connect(context.Background(), serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = serverSession.Close() }()
	client := mcp.NewClient(&mcp.Implementation{Name: "provider-test", Version: "1"}, nil)
	clientSession, err := client.Connect(context.Background(), clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = clientSession.Close() }()

	startResult, err := clientSession.CallTool(context.Background(), &mcp.CallToolParams{Name: "start_ai_provider_check", Arguments: map[string]any{"providerId": p.ID}})
	if err != nil {
		t.Fatal(err)
	}
	started := providerReportFromTool(t, startResult)
	select {
	case request := <-requests:
		if request.Actor != "mcp" || request.CheckID != started.CheckID || request.ProviderID != p.ID {
			t.Fatalf("MCP permission request = %+v", request)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("MCP start did not reach coordinator authorizer")
	}
	getResult, err := clientSession.CallTool(context.Background(), &mcp.CallToolParams{Name: "get_ai_provider_availability", Arguments: map[string]any{"providerId": p.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if cached := providerReportFromTool(t, getResult); cached.CheckID != started.CheckID || cached.Lifecycle != aiprovider.CheckAwaitingApproval {
		t.Fatalf("cached report = %+v, started = %+v", cached, started)
	}
	cancelResult, err := clientSession.CallTool(context.Background(), &mcp.CallToolParams{Name: "cancel_ai_provider_check", Arguments: map[string]any{"providerId": p.ID, "checkId": started.CheckID}})
	if err != nil {
		t.Fatal(err)
	}
	if cancelled := providerReportFromTool(t, cancelResult); cancelled.Lifecycle != aiprovider.CheckCancelled {
		t.Fatalf("cancel report = %+v", cancelled)
	}
}

func TestAIProviderAvailabilityTools_RealHTTPServerInspectsConfiguredProvider(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("provider path = %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"model"}]}`))
	}))
	defer provider.Close()

	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	p, err := cfg.CreateAIProvider("HTTP provider", aiprovider.KindOpenAICompat, provider.URL, "model", "")
	if err != nil {
		t.Fatal(err)
	}
	configuresvc.SetAIProviderCheckAuthorizer(cfg, func(context.Context, configuresvc.ProviderCheckPermissionRequest) (aiprovider.PermissionResult, error) {
		return aiprovider.PermissionResult{Status: aiprovider.PermissionAllowed, Source: "allow"}, nil
	})

	service := NewMillMCPService("test", comp, cfg, store, nil)
	if err := service.Start("127.0.0.1:0"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = service.Shutdown(ctx)
	})

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "provider-http-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + service.BoundAddr()}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = session.Close() }()

	startResult, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "start_ai_provider_check", Arguments: map[string]any{"providerId": p.ID}})
	if err != nil {
		t.Fatal(err)
	}
	started := providerReportFromTool(t, startResult)
	for {
		getResult, callErr := session.CallTool(ctx, &mcp.CallToolParams{Name: "get_ai_provider_availability", Arguments: map[string]any{"providerId": p.ID}})
		if callErr != nil {
			t.Fatal(callErr)
		}
		got := providerReportFromTool(t, getResult)
		if got.Lifecycle == aiprovider.CheckCompleted {
			if got.CheckID != started.CheckID || got.Transport != aiprovider.TransportResponded || got.Inspection != aiprovider.InspectionAvailable || got.SelectedModelFound == nil || !*got.SelectedModelFound {
				t.Fatalf("completed report = %+v", got)
			}
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("provider check did not complete: %v", ctx.Err())
		case <-time.After(5 * time.Millisecond):
		}
	}
}
