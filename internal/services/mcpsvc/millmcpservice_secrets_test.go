package mcpsvc

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/secretsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// secrets_list_references over MCP (goal 0408 S3 decision 7): the same
// real-client-over-loopback-HTTP harness shape
// atlasMCPHarness/TestMillMCPService_RealClientRoundTrip already
// establish for this package.

func newSecretsMCPHarness(t *testing.T, addr string) (*MillMCPService, *mcp.ClientSession, context.Context) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	dir := t.TempDir()
	secrets := secretsvc.NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory(), store)
	t.Cleanup(secrets.StopAutoLock)
	secrets.SetSourcesLister(cfg.SecretSources)
	if err := secrets.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}

	svc := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	svc.SetSecretService(secrets)
	if err := svc.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = svc.Shutdown(ctx)
	})

	client := mcp.NewClient(&mcp.Implementation{Name: "mill-secrets-mcp-test", Version: "0.0.0"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr}, nil)
	if err != nil {
		t.Fatalf("client.Connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })

	if _, err := secrets.CreateSecret("A plain secret", "", "top-secret-value", "", "", nil, "", "", nil); err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}

	return svc, session, ctx
}

func TestSecretsMCP_ListReferences_NamesReferencesNeverAValue(t *testing.T) {
	_, session, ctx := newSecretsMCPHarness(t, "127.0.0.1:18096")

	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "secrets_list_references", Arguments: map[string]any{}})
	if err != nil {
		t.Fatalf("CallTool: %v", err)
	}
	if res.IsError {
		t.Fatalf("tool error: %+v", res.Content)
	}
	text := res.Content[0].(*mcp.TextContent).Text
	if !strings.Contains(text, "A plain secret") {
		t.Fatalf("response missing the seeded entry's label: %s", text)
	}
	if strings.Contains(text, "top-secret-value") {
		t.Fatalf("response leaked the entry's own value: %s", text)
	}

	var refs []secretsvc.Reference
	if err := json.Unmarshal([]byte(text), &refs); err != nil {
		t.Fatalf("response is not the expected JSON shape: %v\n%s", err, text)
	}
	found := false
	for _, r := range refs {
		if r.Label == "A plain secret" {
			found = true
			if r.Source != nil || r.Unresolved {
				t.Errorf("plain entry row = %+v, want Source=nil Unresolved=false", r)
			}
		}
	}
	if !found {
		t.Fatalf("no row for the seeded entry in %+v", refs)
	}
}

func TestSecretsMCP_ListReferences_IsReadOnlyAndWiredWithoutSecretService(t *testing.T) {
	tools, err := BuiltInTools(servicetest.NewFakeStore())
	if err != nil {
		t.Fatalf("BuiltInTools: %v", err)
	}
	var tool *mcp.Tool
	for _, tl := range tools {
		if tl.Name == "secrets_list_references" {
			tool = tl
		}
	}
	if tool == nil {
		t.Fatal("secrets_list_references not registered on a bare server")
	}
	if tool.Annotations == nil || !tool.Annotations.ReadOnlyHint {
		t.Errorf("secrets_list_references annotations = %+v, want ReadOnlyHint true", tool.Annotations)
	}
}
