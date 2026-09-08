package configuresvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/httprequest"
)

// The unresolved-secret seam (goal 0408 S1): RequestSecretUnresolved
// only names a gone key when the request exists, carries a set secret
// reference, AND the wired lookup itself reports it unresolved --
// mirroring RequestCredentialGap's own "exists, needs one, names none"
// shape one state over (a NAMED reference that no longer resolves,
// not an unnamed one).
func TestRequestSecretUnresolved_NamesTheGoneKeyOnlyWhenTheSourceStillExists(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	req, err := cfg.CreateHTTPRequest("Bearer example", "https://example.com", "GET", "", httprequest.AuthBearer,
		"env:proj-env/API_TOKEN", nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}

	// The seam is unwired: never blocks a run on a false positive.
	if unresolved, _, _ := cfg.RequestSecretUnresolved(req.ID); unresolved {
		t.Error("an unwired lookup must never report unresolved")
	}

	var asked string
	cfg.SetSecretUnresolvedLookup(func(ref string) (bool, string, string) {
		asked = ref
		return ref == "env:proj-env/API_TOKEN", "API_TOKEN", "Project .env"
	})

	unresolved, key, sourceLabel := cfg.RequestSecretUnresolved(req.ID)
	if !unresolved || key != "API_TOKEN" || sourceLabel != "Project .env" {
		t.Fatalf("RequestSecretUnresolved = %v, %q, %q, want true, API_TOKEN, Project .env", unresolved, key, sourceLabel)
	}
	if asked != "env:proj-env/API_TOKEN" {
		t.Errorf("lookup asked about %q, want the request's own reference", asked)
	}

	// An unknown request id is validateRequiredRefs' territory, never
	// this check's.
	if unresolved, _, _ := cfg.RequestSecretUnresolved("no-such-request"); unresolved {
		t.Error("an unknown request reported unresolved")
	}

	// An unset reference is validateRequiredRefs' territory too.
	unset, err := cfg.CreateHTTPRequest("No secret yet", "https://example.com", "GET", "", httprequest.AuthBearer,
		"", nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	if unresolved, _, _ := cfg.RequestSecretUnresolved(unset.ID); unresolved {
		t.Error("an unset reference reported unresolved")
	}
}
