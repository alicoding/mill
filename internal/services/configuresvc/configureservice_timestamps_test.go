package configuresvc

import (
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// docs/SPEC.md §3.2.2's reserved-column pattern, applied to
// ConfigureService's own entities: CreatedAt/UpdatedAt are
// system-managed, stamped server-side at every persisted mutation,
// never trusted from the wire. HTTPRequest and List cover this once
// each -- every other ConfigureService entity (MCPServer, Decision,
// ExecEnv) shares the exact same Create/Update shape.

func TestCreateHTTPRequest_StampsBothTimestamps(t *testing.T) {
	cfg, _ := newTestConfigureService(t)

	before := time.Now()
	req, err := cfg.CreateHTTPRequest("My API", "https://example.com", "", "", httprequest.AuthNone, "", nil, "", nil, nil, "")
	after := time.Now()
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}

	if req.CreatedAt.IsZero() || req.UpdatedAt.IsZero() {
		t.Fatalf("CreateHTTPRequest left a zero timestamp: CreatedAt=%v UpdatedAt=%v", req.CreatedAt, req.UpdatedAt)
	}
	if req.CreatedAt.Before(before) || req.CreatedAt.After(after) {
		t.Errorf("CreatedAt %v not within [%v, %v]", req.CreatedAt, before, after)
	}
	if !req.CreatedAt.Equal(req.UpdatedAt) {
		t.Errorf("a freshly created request should have CreatedAt == UpdatedAt, got %v vs %v", req.CreatedAt, req.UpdatedAt)
	}
}

func TestUpdateHTTPRequest_PreservesCreatedAt_AdvancesUpdatedAt(t *testing.T) {
	cfg, _ := newTestConfigureService(t)

	req, err := cfg.CreateHTTPRequest("My API", "https://example.com", "", "", httprequest.AuthNone, "", nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	originalCreatedAt := req.CreatedAt

	time.Sleep(2 * time.Millisecond)

	updated, err := cfg.UpdateHTTPRequest(req.ID, "My API (edited)", "https://example.com", "", "", httprequest.AuthNone, "", nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("UpdateHTTPRequest: %v", err)
	}
	if !updated.CreatedAt.Equal(originalCreatedAt) {
		t.Errorf("UpdateHTTPRequest must preserve the stored CreatedAt, got %v want %v", updated.CreatedAt, originalCreatedAt)
	}
	if !updated.UpdatedAt.After(originalCreatedAt) {
		t.Errorf("UpdateHTTPRequest must advance UpdatedAt past the original stamp, got %v", updated.UpdatedAt)
	}
	// UpdateHTTPRequest's own signature carries no CreatedAt/UpdatedAt
	// parameter -- there is no wire channel through which a caller
	// could forge one, the strongest form of "never trusted from the
	// wire."
}

func TestImportHTTPRequest_StampsFresh_IgnoringAnyWireTimestamp(t *testing.T) {
	cfg, _ := newTestConfigureService(t)

	// exportedHTTPRequest carries no createdAt/updatedAt field -- a
	// hand-authored document trying to forge one is silently dropped by
	// json.Unmarshal (unknown fields are ignored).
	forgedDoc := `{
		"label": "Imported API",
		"description": "",
		"baseURL": "https://example.com",
		"method": "",
		"body": "",
		"authType": "none",
		"headers": null,
		"openAPISpec": "",
		"auth": null,
		"jose": null,
		"createdAt": "2001-01-01T00:00:00Z",
		"updatedAt": "2001-01-01T00:00:00Z"
	}`

	before := time.Now()
	req, err := cfg.ImportHTTPRequest(forgedDoc)
	after := time.Now()
	if err != nil {
		t.Fatalf("ImportHTTPRequest: %v", err)
	}
	if req.CreatedAt.Before(before) || req.CreatedAt.After(after) {
		t.Errorf("ImportHTTPRequest's CreatedAt %v not within [%v, %v] -- a forged wire timestamp was trusted", req.CreatedAt, before, after)
	}
	if !req.CreatedAt.Equal(req.UpdatedAt) {
		t.Errorf("a freshly imported request should have CreatedAt == UpdatedAt, got %v vs %v", req.CreatedAt, req.UpdatedAt)
	}
}

func TestSeededBuiltInHTTPRequests_AreStamped(t *testing.T) {
	// newTestConfigureService clears the seeded set, so construct a
	// service directly against a fresh store to see the real seed path
	// (same pattern configureservice_builtin_test.go's own fresh-install
	// tests already use).
	store := servicetest.NewFakeStore()
	before := time.Now()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, credential.NewInMemory())
	after := time.Now()

	reqs := cfg.HTTPRequests()
	if len(reqs) == 0 {
		t.Fatal("expected at least one seeded built-in HTTPRequest")
	}
	for _, r := range reqs {
		if r.CreatedAt.IsZero() || r.UpdatedAt.IsZero() {
			t.Errorf("seeded request %q has a zero timestamp: CreatedAt=%v UpdatedAt=%v", r.ID, r.CreatedAt, r.UpdatedAt)
		}
		if r.CreatedAt.Before(before) || r.CreatedAt.After(after) {
			t.Errorf("seeded request %q CreatedAt %v not within [%v, %v]", r.ID, r.CreatedAt, before, after)
		}
	}
}

// --- List ---

func TestCreateList_StampsBothTimestamps(t *testing.T) {
	cfg, _ := newTestConfigureService(t)

	before := time.Now()
	l, err := cfg.CreateList("Region codes", "", regionCodeColumns())
	after := time.Now()
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}

	if l.CreatedAt.IsZero() || l.UpdatedAt.IsZero() {
		t.Fatalf("CreateList left a zero timestamp: CreatedAt=%v UpdatedAt=%v", l.CreatedAt, l.UpdatedAt)
	}
	if l.CreatedAt.Before(before) || l.CreatedAt.After(after) {
		t.Errorf("CreatedAt %v not within [%v, %v]", l.CreatedAt, before, after)
	}
	if !l.CreatedAt.Equal(l.UpdatedAt) {
		t.Errorf("a freshly created list should have CreatedAt == UpdatedAt, got %v vs %v", l.CreatedAt, l.UpdatedAt)
	}
}

func TestUpdateList_PreservesCreatedAt_AdvancesUpdatedAt(t *testing.T) {
	cfg, _ := newTestConfigureService(t)

	l, err := cfg.CreateList("Region codes", "", regionCodeColumns())
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	originalCreatedAt := l.CreatedAt

	time.Sleep(2 * time.Millisecond)

	updated, err := cfg.UpdateList(l.ID, "Region codes (edited)", "edited", regionCodeColumns(), nil)
	if err != nil {
		t.Fatalf("UpdateList: %v", err)
	}
	if !updated.CreatedAt.Equal(originalCreatedAt) {
		t.Errorf("UpdateList must preserve the stored CreatedAt, got %v want %v", updated.CreatedAt, originalCreatedAt)
	}
	if !updated.UpdatedAt.After(originalCreatedAt) {
		t.Errorf("UpdateList must advance UpdatedAt past the original stamp, got %v", updated.UpdatedAt)
	}
}

func TestImportList_StampsFresh_IgnoringAnyWireTimestamp(t *testing.T) {
	cfg, _ := newTestConfigureService(t)

	forgedDoc := `{
		"label": "Imported list",
		"entries": {"US": "United States"},
		"createdAt": "2001-01-01T00:00:00Z",
		"updatedAt": "2001-01-01T00:00:00Z"
	}`

	before := time.Now()
	l, err := cfg.ImportList(forgedDoc)
	after := time.Now()
	if err != nil {
		t.Fatalf("ImportList: %v", err)
	}
	if l.CreatedAt.Before(before) || l.CreatedAt.After(after) {
		t.Errorf("ImportList's CreatedAt %v not within [%v, %v] -- a forged wire timestamp was trusted", l.CreatedAt, before, after)
	}
	if !l.CreatedAt.Equal(l.UpdatedAt) {
		t.Errorf("a freshly imported list should have CreatedAt == UpdatedAt, got %v vs %v", l.CreatedAt, l.UpdatedAt)
	}
}
