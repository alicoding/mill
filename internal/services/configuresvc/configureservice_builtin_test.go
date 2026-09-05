package configuresvc

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/openapispec"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/mcpserver"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/SPEC.md §4's Update: seeded example requests, verified at the
// service layer -- internal/domain/httprequest/builtin_test.go already
// proves BuiltIn()'s own data is well-formed; these tests prove
// ConfigureService actually seeds it (and its demo secrets) on a
// genuinely fresh install, and that seeding is lazy/one-shot, same
// pattern already proven for Workflows.

func TestConfigureService_FreshInstall_SeedsBuiltInRequests(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.NewInMemory())

	got := cfg.HTTPRequests()
	want := httprequest.BuiltIn()
	if len(got) != len(want) {
		t.Fatalf("HTTPRequests() on a fresh install = %d entries, want %d (httprequest.BuiltIn())", len(got), len(want))
	}
	seen := map[string]bool{}
	for _, r := range got {
		seen[r.ID] = true
	}
	for _, r := range want {
		if !seen[r.ID] {
			t.Errorf("fresh-install HTTPRequests() missing built-in %q", r.ID)
		}
	}
}

// A seeded example's demo credential is created in the secret store on
// the first unlock, never at seed time (goal 0306) -- and the example
// then NAMES it, so the same resolution a real workflow run takes hands
// the value back. Nothing was ever written to the OS keychain.
func TestAdoptSecretsIntoStore_GivesSeededExamplesTheirDemoCredentials(t *testing.T) {
	cfg, _ := newTestConfigureServiceWithSeeds(t)
	secrets := secretStoreOf(t, cfg)

	// Before the store is open, an example that needs a credential
	// names none, which is the honest state and a stated error.
	if _, err := cfg.resolveHTTPRequest(httprequest.ExampleBearerID, composition.SecretAccessRun{}); err == nil {
		t.Error("a seeded example resolved a secret before the store was ever opened")
	}

	if _, err := cfg.AdoptSecretsIntoStore(); err != nil {
		t.Fatalf("AdoptSecretsIntoStore returned error: %v", err)
	}

	for id, want := range builtInSecrets {
		rc, err := cfg.resolveHTTPRequest(id, composition.SecretAccessRun{})
		if err != nil {
			t.Errorf("resolveHTTPRequest(%q) returned error: %v", id, err)
			continue
		}
		if rc.Secret != want {
			t.Errorf("resolveHTTPRequest(%q) Secret = %q, want %q", id, rc.Secret, want)
		}
	}

	// The OAuth 1.0a example's two secrets are named separately and
	// rejoined for the strategy (Postman's own published test
	// credential, with no token secret).
	rc, err := cfg.resolveHTTPRequest(httprequest.ExampleOAuth1ID, composition.SecretAccessRun{})
	if err != nil {
		t.Fatalf("resolveHTTPRequest(%q) returned error: %v", httprequest.ExampleOAuth1ID, err)
	}
	if want := composition.EncodeOAuth1Secret(builtInOAuth1ConsumerSecret, ""); rc.Secret != want {
		t.Errorf("seeded OAuth 1.0a example Secret = %q, want %q", rc.Secret, want)
	}

	// The OAuth 2.0 example deliberately ships no credential: Mill's
	// own repo will never carry a real client secret, so it still names
	// nothing and still says so.
	if _, err := cfg.resolveHTTPRequest(httprequest.ExampleOAuth2ID, composition.SecretAccessRun{}); err == nil {
		t.Error("the OAuth 2.0 example resolved a secret, want it to still name none")
	}

	// Running again adopts nothing: adoption is defined by what is
	// still unadopted.
	before := secrets.Len()
	adopted, err := cfg.AdoptSecretsIntoStore()
	if err != nil {
		t.Fatalf("second AdoptSecretsIntoStore returned error: %v", err)
	}
	if adopted != 0 || secrets.Len() != before {
		t.Errorf("second adoption created %d entries (store went %d -> %d), want none", adopted, before, secrets.Len())
	}
}

// Seeding is lazy and one-shot, same as CompositionService's own
// BuiltInWorkflows pattern: deleting a seeded request, then
// constructing a second ConfigureService over the same (now-persisted)
// store, must NOT bring it back.
func TestConfigureService_DeletingABuiltIn_DoesNotReturnOnRestart(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.NewInMemory())

	// docs/adr/0040 decision 3: a seeded workflow still references this
	// request, so the delete is blocked, naming it, until the reference
	// is gone.
	err := cfg.DeleteHTTPRequest(httprequest.ExampleNoneID)
	if err == nil {
		t.Fatal("DeleteHTTPRequest on a still-referenced request returned nil error, want it blocked")
	}
	if !strings.Contains(err.Error(), "Forward approvals to the sponsor") {
		t.Errorf("DeleteHTTPRequest blocked-error = %q, want it to name the referencing workflow", err.Error())
	}
	if err := comp.DeleteWorkflow("example-forward-approvals-workflow"); err != nil {
		t.Fatalf("DeleteWorkflow (unblocking the reference): %v", err)
	}
	if err := cfg.DeleteHTTPRequest(httprequest.ExampleNoneID); err != nil {
		t.Fatalf("DeleteHTTPRequest(%q) returned error after unblocking: %v", httprequest.ExampleNoneID, err)
	}

	restarted := NewConfigureService(store, comp, credential.NewInMemory())
	for _, r := range restarted.HTTPRequests() {
		if r.ID == httprequest.ExampleNoneID {
			t.Fatalf("deleted built-in %q reappeared after restart, want it to stay deleted", httprequest.ExampleNoneID)
		}
	}
	// The other six built-ins should still be there -- deleting one
	// persists the whole (now-mutated) list, not just that one entry's
	// absence.
	if len(restarted.HTTPRequests()) != len(httprequest.BuiltIn())-1 {
		t.Errorf("HTTPRequests() after restart = %d entries, want %d (one deleted, the rest persisted)", len(restarted.HTTPRequests()), len(httprequest.BuiltIn())-1)
	}
}

// Editing a seeded example carries its BuiltIn flag forward (same
// "purely informational" behavior CompositionService.UpdateWorkflow
// already established) and correctly persists the new Description.
func TestUpdateHTTPRequest_PreservesBuiltInFlag_AndUpdatesDescription(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.NewInMemory())

	var original httprequest.HTTPRequest
	for _, r := range cfg.HTTPRequests() {
		if r.ID == httprequest.ExampleNoneID {
			original = r
			break
		}
	}
	if original.ID == "" {
		t.Fatalf("seeded request %q not found", httprequest.ExampleNoneID)
	}

	updated, err := cfg.UpdateHTTPRequest(
		original.ID, original.Label, original.BaseURL, original.Method, original.Body, original.AuthType, original.SecretRef,
		original.Headers, original.OpenAPISpec, original.Auth, original.JOSE, "my own notes",
	)
	if err != nil {
		t.Fatalf("UpdateHTTPRequest returned error: %v", err)
	}
	if !updated.BuiltIn {
		t.Error("UpdateHTTPRequest reset BuiltIn to false, want it carried forward (purely informational)")
	}
	if updated.Description != "my own notes" {
		t.Errorf("UpdateHTTPRequest Description = %q, want %q", updated.Description, "my own notes")
	}
}

func TestCreateHTTPRequest_DescriptionPersists(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("My API", "https://example.com", "", "", httprequest.AuthNone, "", nil, "", nil, nil, "a helpful note")
	if err != nil {
		t.Fatalf("CreateHTTPRequest returned error: %v", err)
	}
	if req.Description != "a helpful note" {
		t.Errorf("CreateHTTPRequest Description = %q, want %q", req.Description, "a helpful note")
	}
}

// The two typed seeded examples (docs/SPEC.md §4's Update) declare a
// real input parameter / typed response fields, parsed here through
// the same adapter the app itself uses -- so the "typed request and
// response in the Test feature" demo can't silently regress into a
// bare untyped 200.
func TestBuiltIn_TypedExamples_DeclareRealFields(t *testing.T) {
	find := func(id string) httprequest.HTTPRequest {
		for _, r := range httprequest.BuiltIn() {
			if r.ID == id {
				return r
			}
		}
		t.Fatalf("no built-in request with id %q", id)
		return httprequest.HTTPRequest{}
	}

	echo := find(httprequest.ExampleNoneID)
	spec, err := openapispec.Parse([]byte(echo.OpenAPISpec))
	if err != nil {
		t.Fatalf("typed echo spec does not parse: %v", err)
	}
	op, err := spec.Operation("/", "GET")
	if err != nil {
		t.Fatalf("typed echo spec has no GET / operation: %v", err)
	}
	if len(op.InputFields) != 1 || op.InputFields[0].Key != "q" || op.InputFields[0].In != "query" {
		t.Errorf("typed echo inputs = %+v, want one query parameter q", op.InputFields)
	}
	wantPath := map[string]string{"url": "", "origin": "", "echoedQ": "args.q"}
	if len(op.OutputFields) != len(wantPath) {
		t.Fatalf("typed echo outputs = %+v, want url/origin/echoedQ", op.OutputFields)
	}
	for _, f := range op.OutputFields {
		p, ok := wantPath[f.Key]
		if !ok {
			t.Errorf("unexpected typed echo output field %q", f.Key)
			continue
		}
		if f.Path != p {
			t.Errorf("output field %q Path = %q, want %q", f.Key, f.Path, p)
		}
	}

	bearer := find(httprequest.ExampleBearerID)
	spec, err = openapispec.Parse([]byte(bearer.OpenAPISpec))
	if err != nil {
		t.Fatalf("typed bearer spec does not parse: %v", err)
	}
	op, err = spec.Operation("/", "GET")
	if err != nil {
		t.Fatalf("typed bearer spec has no GET / operation: %v", err)
	}
	types := map[string]string{}
	for _, f := range op.OutputFields {
		types[f.Key] = string(f.Type)
	}
	// The OpenAPI document itself still declares "type": "string" for
	// token (Mill's document vocabulary is unaffected by this) --
	// schemaType (ADR-0029 Phase 3) translates that into typedfield's
	// own "text", the Mill-side value this in-memory Field.Type now
	// carries.
	if types["authenticated"] != "boolean" || types["token"] != "text" {
		t.Errorf("typed bearer outputs = %+v, want authenticated:boolean + token:text", op.OutputFields)
	}
}

// Top-up seeding: every capability ships a seeded example that
// exercises it (.claude/rules/testing.md), so a newly shipped example
// must reach an EXISTING instance, not just fresh installs. A persisted store
// missing a built-in gets it appended on restore; a deliberately
// deleted built-in is tombstoned and stays gone across restarts.
func TestTopUpSeeding_AddsNewBuiltIns_ButNeverResurrectsDeletedOnes(t *testing.T) {
	store := servicetest.NewFakeStore()

	// First boot: everything seeds.
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	if err := cfg.DeleteHTTPRequest(httprequest.ExampleBearerID); err != nil {
		t.Fatalf("DeleteHTTPRequest: %v", err)
	}
	if err := comp.DeleteWorkflow("example-parent-workflow"); err != nil {
		t.Fatalf("DeleteWorkflow: %v", err)
	}

	// Second boot over the same persisted store: nothing deleted comes
	// back, everything else is still there.
	comp2 := compositionsvc.NewCompositionService(store)
	cfg2 := NewConfigureService(store, comp2, servicetest.FakeCredentialStore{})
	for _, r := range cfg2.HTTPRequests() {
		if r.ID == httprequest.ExampleBearerID {
			t.Error("deleted built-in request was resurrected by top-up seeding -- tombstone must stick")
		}
	}
	for _, wf := range comp2.Workflows() {
		if wf.ID == "example-parent-workflow" {
			t.Error("deleted built-in workflow was resurrected by top-up seeding -- tombstone must stick")
		}
	}

	// Simulate an older instance that persisted before a new example
	// shipped: strip one built-in from the persisted blob directly,
	// then restore -- top-up must add it back (it was never deleted by
	// the user, it just didn't exist when this instance last saved).
	var wfs []composition.Workflow
	for _, wf := range comp2.Workflows() {
		if wf.ID != composition.ExampleChildWorkflowID {
			wfs = append(wfs, wf)
		}
	}
	data, _ := json.Marshal(wfs)
	if err := store.Set("composition-workflows-v2", string(data)); err != nil {
		t.Fatalf("store.Set: %v", err)
	}
	comp3 := compositionsvc.NewCompositionService(store)
	found := false
	for _, wf := range comp3.Workflows() {
		if wf.ID == composition.ExampleChildWorkflowID {
			found = true
		}
	}
	if !found {
		t.Error("a built-in absent from an older persisted store was not topped up on restore")
	}
}

// docs/goals/0010 items 4-5: Lists and MCP Servers had zero seeded
// examples before this -- same fresh-install/tombstone-on-delete
// discipline as httprequest.BuiltIn() above, proven for both new
// entity types.

func TestConfigureService_FreshInstall_SeedsBuiltInLists(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.NewInMemory())

	got := cfg.Lists()
	want := list.BuiltIn()
	if len(got) != len(want) {
		t.Fatalf("Lists() on a fresh install = %d entries, want %d (list.BuiltIn())", len(got), len(want))
	}
	seen := map[string]bool{}
	for _, l := range got {
		seen[l.ID] = true
	}
	for _, l := range want {
		if !seen[l.ID] {
			t.Errorf("fresh-install Lists() missing built-in %q", l.ID)
		}
	}
}

func TestConfigureService_DeletingABuiltInList_DoesNotReturnOnRestart(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.NewInMemory())

	// docs/adr/0040 decision 3: two seeded workflows still reference
	// this list, so the delete is blocked, naming both, until both
	// references are gone.
	err := cfg.DeleteList(list.ExampleCountryCodesID)
	if err == nil {
		t.Fatal("DeleteList on a still-referenced list returned nil error, want it blocked")
	}
	if !strings.Contains(err.Error(), "Look up a client country") || !strings.Contains(err.Error(), "Search client countries") {
		t.Errorf("DeleteList blocked-error = %q, want it to name both referencing workflows", err.Error())
	}
	for _, wfID := range []string{"example-list-lookup-workflow", "example-list-search-workflow"} {
		if err := comp.DeleteWorkflow(wfID); err != nil {
			t.Fatalf("DeleteWorkflow(%q) (unblocking the reference): %v", wfID, err)
		}
	}
	if err := cfg.DeleteList(list.ExampleCountryCodesID); err != nil {
		t.Fatalf("DeleteList(%q) returned error after unblocking: %v", list.ExampleCountryCodesID, err)
	}

	restarted := NewConfigureService(store, comp, credential.NewInMemory())
	for _, l := range restarted.Lists() {
		if l.ID == list.ExampleCountryCodesID {
			t.Fatalf("deleted built-in list %q reappeared after restart, want it to stay deleted", list.ExampleCountryCodesID)
		}
	}
}

func TestConfigureService_FreshInstall_SeedsBuiltInMCPServers(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.NewInMemory())

	got := cfg.MCPServers()
	want := mcpserver.BuiltIn()
	if len(got) != len(want) {
		t.Fatalf("MCPServers() on a fresh install = %d entries, want %d (mcpserver.BuiltIn())", len(got), len(want))
	}
	seen := map[string]bool{}
	for _, s := range got {
		seen[s.ID] = true
	}
	for _, s := range want {
		if !seen[s.ID] {
			t.Errorf("fresh-install MCPServers() missing built-in %q", s.ID)
		}
	}
}

func TestConfigureService_DeletingABuiltInMCPServer_DoesNotReturnOnRestart(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.NewInMemory())

	// docs/adr/0040 decision 3: the seeded "Example: MCP echo call"
	// workflow still references this server, so the delete is blocked,
	// naming it, until that reference is gone.
	err := cfg.DeleteMCPServer(mcpserver.ExampleReferenceServerID)
	if err == nil {
		t.Fatal("DeleteMCPServer on a still-referenced server returned nil error, want it blocked")
	}
	if !strings.Contains(err.Error(), "Example: MCP echo call") {
		t.Errorf("DeleteMCPServer blocked-error = %q, want it to name the referencing workflow", err.Error())
	}
	if err := comp.DeleteWorkflow("example-mcp-echo-workflow"); err != nil {
		t.Fatalf("DeleteWorkflow (unblocking the reference): %v", err)
	}
	if err := cfg.DeleteMCPServer(mcpserver.ExampleReferenceServerID); err != nil {
		t.Fatalf("DeleteMCPServer(%q) returned error after unblocking: %v", mcpserver.ExampleReferenceServerID, err)
	}

	restarted := NewConfigureService(store, comp, credential.NewInMemory())
	for _, s := range restarted.MCPServers() {
		if s.ID == mcpserver.ExampleReferenceServerID {
			t.Fatalf("deleted built-in MCP server %q reappeared after restart, want it to stay deleted", mcpserver.ExampleReferenceServerID)
		}
	}
}
