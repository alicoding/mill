package mcpsvc

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/buildinfo"
	"github.com/alicoding/mill/internal/contract"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// newContractTestService starts a real MillMCPService/HTTP listener and
// connects a real MCP client -- same real-client-over-real-HTTP shape
// as TestMillMCPService_RealClientRoundTrip, scoped to this file's own
// port so it can run alongside the rest of the package's tests.
func newContractTestService(t *testing.T, addr, version string) *mcp.ClientSession {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})

	svc := NewMillMCPService(version, comp, cfg, store)
	if err := svc.Start(addr); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = svc.Shutdown(ctx)
	})

	client := mcp.NewClient(&mcp.Implementation{Name: "contract-test-client", Version: "0.0.0"}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr}, nil)
	if err != nil {
		t.Fatalf("client.Connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func readResourceText(t *testing.T, session *mcp.ClientSession, uri string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	res, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: uri})
	if err != nil {
		t.Fatalf("ReadResource(%s): %v", uri, err)
	}
	if len(res.Contents) == 0 {
		t.Fatalf("ReadResource(%s): empty contents", uri)
	}
	return res.Contents[0].Text
}

// TestMCPManifest_MatchesWiredVersionAndBuildInfo is goal 0052 item 4's
// own acceptance: mill://manifest's values must match the version this
// service was actually constructed with and the real runtime/debug
// build info -- never a hardcoded expectation, since both are
// environment-dependent (this is `go test`'s own build, not a release).
func TestMCPManifest_MatchesWiredVersionAndBuildInfo(t *testing.T) {
	const wantVersion = "9.8.7-manifest-test"
	session := newContractTestService(t, "127.0.0.1:18102", wantVersion)

	var got contract.Manifest
	if err := json.Unmarshal([]byte(readResourceText(t, session, "mill://manifest")), &got); err != nil {
		t.Fatalf("mill://manifest not JSON: %v", err)
	}

	if got.Version != wantVersion {
		t.Errorf("Version = %q, want the wired version %q", got.Version, wantVersion)
	}

	build := buildinfo.Read()
	if got.Commit != build.Revision {
		t.Errorf("Commit = %q, want buildinfo.Read().Revision %q", got.Commit, build.Revision)
	}
	if got.Modified != build.Modified {
		t.Errorf("Modified = %v, want buildinfo.Read().Modified %v", got.Modified, build.Modified)
	}
	wantMode := "desktop"
	if build.Server {
		wantMode = "server"
	}
	if got.Mode != wantMode {
		t.Errorf("Mode = %q, want %q (buildinfo.Read().Server = %v)", got.Mode, wantMode, build.Server)
	}

	families := contract.Families()
	if len(got.Schemas) != len(families) {
		t.Fatalf("Schemas has %d entries, want %d (one per registered family)", len(got.Schemas), len(families))
	}
	for _, f := range families {
		found := false
		for _, s := range got.Schemas {
			if s.Family == f && s.ID == contract.SchemaID(f) {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Schemas missing family %q at its current schema id %q", f, contract.SchemaID(f))
		}
	}
}

// TestMCPContract_IsStaticDocumentPlusLiveManifest proves mill://contract
// serves the exact committed document (schemas + node catalog + import
// contract) with only the manifest injected live -- the served form
// ADR-0036 decision 4 describes, exercised over the real transport.
func TestMCPContract_IsStaticDocumentPlusLiveManifest(t *testing.T) {
	const wantVersion = "9.8.7-contract-test"
	session := newContractTestService(t, "127.0.0.1:18103", wantVersion)

	raw := readResourceText(t, session, "mill://contract")
	var served contract.ServedDocument
	if err := json.Unmarshal([]byte(raw), &served); err != nil {
		t.Fatalf("mill://contract not JSON: %v", err)
	}

	if served.Manifest.Version != wantVersion {
		t.Errorf("Manifest.Version = %q, want %q", served.Manifest.Version, wantVersion)
	}
	if len(served.NodeTypes) == 0 {
		t.Error("served document has no nodeTypes")
	}
	if len(served.Schemas) != len(contract.Families()) {
		t.Errorf("served document has %d schemas, want %d", len(served.Schemas), len(contract.Families()))
	}
	if len(served.Import.SupportedSchemas) != len(contract.Families()) {
		t.Errorf("served document's import.supportedSchemas has %d entries, want %d", len(served.Import.SupportedSchemas), len(contract.Families()))
	}

	// The static half must match the committed document byte-for-byte
	// once the manifest is stripped back out -- Served (internal/contract)
	// decodes CommittedDocument rather than recomputing, so this also
	// guards against a future regression that starts regenerating on
	// every request instead of serving the committed bytes.
	committedBytes, err := contract.CommittedDocument.ReadFile("contract.json")
	if err != nil {
		t.Fatalf("read committed contract.json: %v", err)
	}
	var committed contract.Document
	if err := json.Unmarshal(committedBytes, &committed); err != nil {
		t.Fatalf("decode committed contract.json: %v", err)
	}
	committedJSON, _ := json.Marshal(committed)
	servedStaticJSON, _ := json.Marshal(served.Document)
	if string(committedJSON) != string(servedStaticJSON) {
		t.Errorf("served document's static half diverges from the committed contract.json")
	}
}
