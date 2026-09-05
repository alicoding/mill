package configuresvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// The credential-presence seam (goal 0127 slice 3, goal 0306): a gap
// only when the request exists, needs a secret, and names none. Since
// a secret is a reference the request carries, presence is a field
// read -- no keychain probe, so no cache to be stale.
func TestRequestCredentialGap_UnnamedNamedAndAuthNone(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	wireTestSecretStore(cfg)

	missing, label := cfg.RequestCredentialGap(httprequest.ExampleConfluencePageReadID)
	if !missing || label == "" {
		t.Errorf("gap = (%v, %q), want missing with the integration's label", missing, label)
	}

	// AuthNone never gaps.
	if missing, _ := cfg.RequestCredentialGap(httprequest.ExampleNoneID); missing {
		t.Error("an AuthNone request reported a credential gap")
	}

	// Unknown id is validateRequiredRefs' territory, never a gap here.
	if missing, _ := cfg.RequestCredentialGap("no-such-request"); missing {
		t.Error("an unknown request reported a credential gap")
	}

	// Naming an entry closes the gap.
	storeRequestSecret(t, cfg, httprequest.ExampleConfluencePageReadID, "token")
	if missing, _ := cfg.RequestCredentialGap(httprequest.ExampleConfluencePageReadID); missing {
		t.Error("gap persisted after the request named a stored secret")
	}
}

// OAuth 1.0a gaps on its CONSUMER secret alone: RFC 5849's 2-legged
// flow has no token, so a missing token secret is not a gap.
func TestRequestCredentialGap_OAuth1_GapsOnTheConsumerSecretOnly(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	secrets := secretStoreOf(t, cfg)
	req, err := cfg.CreateHTTPRequest("Two-legged", "https://example.com", "", "", httprequest.AuthOAuth1, "", nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	if missing, _ := cfg.RequestCredentialGap(req.ID); !missing {
		t.Error("an OAuth 1.0a request naming no consumer secret reported no gap")
	}
	auth := &httprequest.AuthConfig{OAuth1: &httprequest.OAuth1Config{
		ConsumerKey:       "ck",
		ConsumerSecretRef: secrets.Put("Two-legged: consumer secret", "cs"),
	}}
	if _, err := cfg.UpdateHTTPRequest(req.ID, req.Label, req.BaseURL, req.Method, req.Body, req.AuthType, "", req.Headers, req.OpenAPISpec, auth, req.JOSE, req.Description); err != nil {
		t.Fatalf("UpdateHTTPRequest: %v", err)
	}
	if missing, _ := cfg.RequestCredentialGap(req.ID); missing {
		t.Error("an OAuth 1.0a request naming its consumer secret still reported a gap")
	}
}
