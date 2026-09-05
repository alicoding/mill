package mcpsvc

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func newAuthoringExtHarness(t *testing.T) (*MillMCPService, *atlassvc.AtlasService, *configuresvc.ConfigureService) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	atlasSvc := atlassvc.NewAtlasService(store)
	svc := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	svc.SetAtlasService(atlasSvc)
	return svc, atlasSvc, cfg
}

const extTestSpec = `{
  "openapi": "3.0.3",
  "info": {"title": "Test", "version": "1.0.0"},
  "paths": {"/ping": {"get": {"responses": {"200": {"description": "OK"}}}}}
}`

// test_request's executor performs the real call and returns a typed
// result -- goal 0130's Try-it twin, draft mode.
func TestExecuteTestRequest_DraftMode_CallsAndReturnsResult(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte(`{"pong":true}`))
	}))
	defer srv.Close()

	svc, _, _ := newAuthoringExtHarness(t)
	// Literal JSON, not a marshaled struct: the args type carries a
	// secret-named field the linter rightly flags on marshal in tests.
	args := fmt.Sprintf(`{"baseUrl":%q,"openApiSpec":%q,"path":"/ping","method":"GET"}`, srv.URL, extTestSpec)
	out, err := svc.executeTestRequest(args)
	if err != nil {
		t.Fatalf("executeTestRequest: %v", err)
	}
	var result configuresvc.TestHTTPRequestResult
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		t.Fatalf("result JSON: %v", err)
	}
	if result.StatusCode != http.StatusTeapot || !strings.Contains(result.Body, "pong") {
		t.Errorf("result = %+v, want the server's own 418 pong", result)
	}
}

// requestId mode fills the stored integration's definition in --
// the agent tests a CONFIGURED integration without re-supplying it.
func TestResolveTestRequestInput_FillsFromStoredIntegration(t *testing.T) {
	svc, _, cfg := newAuthoringExtHarness(t)
	created, err := cfg.CreateHTTPRequest("Ext test", "https://api.example.test", "GET", "", httprequest.AuthNone, "", nil, extTestSpec, nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	resolved, err := svc.resolveTestRequestInput(testRequestArgs{RequestID: created.ID, Path: "/ping", Method: "GET"})
	if err != nil {
		t.Fatalf("resolveTestRequestInput: %v", err)
	}
	if resolved.BaseURL != "https://api.example.test" || resolved.OpenAPISpec == "" {
		t.Errorf("resolved = %+v, want stored base URL + spec filled", resolved)
	}
	if _, err := svc.resolveTestRequestInput(testRequestArgs{RequestID: "nope", Path: "/", Method: "GET"}); err == nil {
		t.Error("unknown requestId must refuse")
	}
}

// Kind writes route the full create/update/delete lifecycle through
// Atlas's own methods -- delete refused while a live card uses it.
func TestExecuteAtlasProposeKindWrite_Lifecycle(t *testing.T) {
	svc, atlasSvc, _ := newAuthoringExtHarness(t)

	create, err := json.Marshal(atlasProposeKindWriteArgs{Label: "Vendor", Fields: []kindProposedField{{Key: "status", Label: "Status", Type: "options", Options: []string{"ok", "bad"}}}})
	if err != nil {
		t.Fatalf("marshal create: %v", err)
	}
	out, err := svc.executeAtlasProposeKindWrite(string(create))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	var created struct{ KindID, Label string }
	if err := json.Unmarshal([]byte(out), &created); err != nil || created.KindID == "" {
		t.Fatalf("create result %q: %v", out, err)
	}

	update, err := json.Marshal(atlasProposeKindWriteArgs{KindID: created.KindID, Label: "Vendor v2"})
	if err != nil {
		t.Fatalf("marshal update: %v", err)
	}
	if _, err := svc.executeAtlasProposeKindWrite(string(update)); err != nil {
		t.Fatalf("update: %v", err)
	}

	// A live card of this kind blocks deletion (Atlas's own guard).
	card, err := atlasSvc.CreateCard(created.KindID, "Acme", "", nil, "", nil, "", "", "", "")
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}
	del, err := json.Marshal(atlasProposeKindWriteArgs{KindID: created.KindID, Delete: true})
	if err != nil {
		t.Fatalf("marshal delete: %v", err)
	}
	if _, err := svc.executeAtlasProposeKindWrite(string(del)); err == nil {
		t.Fatal("delete must refuse while a live card uses the kind")
	}
	if _, err := atlasSvc.DeleteCard(card.ID); err != nil {
		t.Fatalf("DeleteCard: %v", err)
	}
	if _, err := svc.executeAtlasProposeKindWrite(string(del)); err != nil {
		t.Fatalf("delete after card removal: %v", err)
	}
}
