package configuresvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// The credential-presence seam (goal 0127 slice 3): a gap only when
// the request exists, needs a secret, and the keychain provably has
// none; a stored secret (through the caching decorator's own Set)
// clears it without another keychain read.
func TestRequestCredentialGap_MissingStoredAndAuthNone(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := NewConfigureService(store, comp, notFoundCredentialStore{})

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

	// Storing the secret through the service clears the gap via the
	// decorator's own cache -- even though the INNER store still
	// reports not-found on reads (Set is a no-op there), proving the
	// answer came from the cache, not another keychain read.
	if err := cfg.credentials.Set(httprequest.ExampleConfluencePageReadID, "token"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if missing, _ := cfg.RequestCredentialGap(httprequest.ExampleConfluencePageReadID); missing {
		t.Error("gap persisted after the credential was stored")
	}
}
