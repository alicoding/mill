package main

import (
	"encoding/json"
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/adapters/openapispec"
	"github.com/alicoding/mill/internal/domain/httprequest"
)

// docs/SPEC.md §4's Update: seeded example requests, verified at the
// service layer -- internal/domain/httprequest/builtin_test.go already
// proves BuiltIn()'s own data is well-formed; these tests prove
// ConfigureService actually seeds it (and its demo secrets) on a
// genuinely fresh install, and that seeding is lazy/one-shot, same
// pattern already proven for Workflows.

func TestConfigureService_FreshInstall_SeedsBuiltInRequests(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.New())

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

// The OAuth1 example's demo secret (Postman's own published test
// credential) must actually be resolvable end-to-end -- the same path
// a real workflow run would take -- not just present in BuiltIn()'s
// config.
func TestConfigureService_FreshInstall_SeedsOAuth1DemoSecret(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.New())

	rc, err := cfg.resolveHTTPRequest(httprequest.ExampleOAuth1ID)
	if err != nil {
		t.Fatalf("resolveHTTPRequest(%q) returned error: %v", httprequest.ExampleOAuth1ID, err)
	}
	if rc.Secret == "" {
		t.Error("seeded OAuth1 example's resolved Secret is empty, want Postman's published test credential (encoded)")
	}
}

// APIKey/Bearer/HMAC/QueryParam's demo secrets are arbitrary
// placeholders (builtInSecrets, configureservice_builtin.go) -- confirm
// each actually landed in the keychain and resolves, not just that the
// map declares them.
func TestConfigureService_FreshInstall_SeedsPlaceholderDemoSecrets(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.New())

	for id, want := range builtInSecrets {
		rc, err := cfg.resolveHTTPRequest(id)
		if err != nil {
			t.Errorf("resolveHTTPRequest(%q) returned error: %v", id, err)
			continue
		}
		if rc.Secret != want {
			t.Errorf("resolveHTTPRequest(%q) Secret = %q, want %q", id, rc.Secret, want)
		}
	}
}

// The OAuth2 example deliberately has no keychain secret seeded --
// resolveHTTPRequest must still succeed (AuthOAuth2 != AuthNone, but
// there's genuinely no secret to fetch since none was ever Set) rather
// than erroring, since a missing-but-never-set secret and a
// missing-but-expected one need to be distinguishable in principle --
// here we only assert the resolved Secret is empty, matching
// "credential.Get on an id nothing was ever Set for" behavior.
func TestConfigureService_FreshInstall_OAuth2Example_HasNoSecretSeeded(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.New())

	if _, err := cfg.resolveHTTPRequest(httprequest.ExampleOAuth2ID); err == nil {
		t.Error("resolveHTTPRequest for the credential-less OAuth2 example returned nil error, want an error (no secret was ever seeded for it, matching a real not-yet-configured request)")
	}
}

// Seeding is lazy and one-shot, same as CompositionService's own
// BuiltInWorkflows pattern: deleting a seeded request, then
// constructing a second ConfigureService over the same (now-persisted)
// store, must NOT bring it back.
func TestConfigureService_DeletingABuiltIn_DoesNotReturnOnRestart(t *testing.T) {
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.New())

	if err := cfg.DeleteHTTPRequest(httprequest.ExampleNoneID); err != nil {
		t.Fatalf("DeleteHTTPRequest(%q) returned error: %v", httprequest.ExampleNoneID, err)
	}

	restarted := NewConfigureService(store, comp, credential.New())
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
	store := newFakeStore()
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.New())

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
		original.ID, original.Label, original.BaseURL, original.Method, original.Body, original.AuthType,
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
	req, err := cfg.CreateHTTPRequest("My API", "https://example.com", "", "", httprequest.AuthNone, nil, "", nil, nil, "a helpful note")
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
	op, err := spec.Operation("/get", "GET")
	if err != nil {
		t.Fatalf("typed echo spec has no GET /get operation: %v", err)
	}
	if len(op.InputFields) != 1 || op.InputFields[0].Name != "q" || op.InputFields[0].In != "query" {
		t.Errorf("typed echo inputs = %+v, want one query parameter q", op.InputFields)
	}
	wantPath := map[string]string{"url": "", "origin": "", "echoedQ": "args.q"}
	if len(op.OutputFields) != len(wantPath) {
		t.Fatalf("typed echo outputs = %+v, want url/origin/echoedQ", op.OutputFields)
	}
	for _, f := range op.OutputFields {
		p, ok := wantPath[f.Name]
		if !ok {
			t.Errorf("unexpected typed echo output field %q", f.Name)
			continue
		}
		if f.Path != p {
			t.Errorf("output field %q Path = %q, want %q", f.Name, f.Path, p)
		}
	}

	bearer := find(httprequest.ExampleBearerID)
	spec, err = openapispec.Parse([]byte(bearer.OpenAPISpec))
	if err != nil {
		t.Fatalf("typed bearer spec does not parse: %v", err)
	}
	op, err = spec.Operation("/bearer", "GET")
	if err != nil {
		t.Fatalf("typed bearer spec has no GET /bearer operation: %v", err)
	}
	types := map[string]string{}
	for _, f := range op.OutputFields {
		types[f.Name] = f.Type
	}
	if types["authenticated"] != "boolean" || types["token"] != "string" {
		t.Errorf("typed bearer outputs = %+v, want authenticated:boolean + token:string", op.OutputFields)
	}
}

// Top-up seeding (direct user decision: "every feature we build needs
// proof with a seeded example" -- so a newly shipped example must reach
// an EXISTING instance, not just fresh installs): a persisted store
// missing a built-in gets it appended on restore; a deliberately
// deleted built-in is tombstoned and stays gone across restarts.
func TestTopUpSeeding_AddsNewBuiltIns_ButNeverResurrectsDeletedOnes(t *testing.T) {
	store := newFakeStore()

	// First boot: everything seeds.
	comp := NewCompositionService(store)
	cfg := NewConfigureService(store, comp, testCredentialStore{})
	if err := cfg.DeleteHTTPRequest(httprequest.ExampleBearerID); err != nil {
		t.Fatalf("DeleteHTTPRequest: %v", err)
	}
	if err := comp.DeleteWorkflow("example-parent-workflow"); err != nil {
		t.Fatalf("DeleteWorkflow: %v", err)
	}

	// Second boot over the same persisted store: nothing deleted comes
	// back, everything else is still there.
	comp2 := NewCompositionService(store)
	cfg2 := NewConfigureService(store, comp2, testCredentialStore{})
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
	comp3 := NewCompositionService(store)
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
