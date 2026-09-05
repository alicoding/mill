package configuresvc

import (
	"errors"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// adoptionHarness is a ConfigureService over a real in-memory keychain,
// so the pass that lifts values OUT of one (goal 0306) is exercised
// against the same semantics a real device gives: absent means
// not-found.
func adoptionHarness(t *testing.T) (*ConfigureService, credential.Store, *servicetest.FakeSecretStore) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	keychain := credential.NewInMemory()
	cfg := NewConfigureService(store, comp, keychain)
	cfg.requests = nil
	cfg.aiProviders = nil
	secrets := wireTestSecretStore(cfg)
	return cfg, keychain, secrets
}

// A value an older Mill left in a per-entity keychain item becomes a
// store entry the entity NAMES, and the keychain item is removed only
// after the entry has been read back intact.
func TestAdoptSecretsIntoStore_MovesAKeychainValueAndClearsTheItem(t *testing.T) {
	cfg, keychain, secrets := adoptionHarness(t)
	req, err := cfg.CreateHTTPRequest("Payments API", "https://example.com", "", "", httprequest.AuthBearer, "", nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	if err := keychain.Set(req.ID, "legacy-bearer-token"); err != nil {
		t.Fatalf("seeding the legacy keychain item: %v", err)
	}

	adopted, err := cfg.AdoptSecretsIntoStore()
	if err != nil {
		t.Fatalf("AdoptSecretsIntoStore: %v", err)
	}
	if adopted != 1 {
		t.Errorf("adopted = %d, want 1", adopted)
	}

	stored, found := findRequestByID(cfg.HTTPRequests(), req.ID)
	if !found || stored.SecretRef == "" {
		t.Fatalf("request after adoption = %+v, want it naming a stored entry", stored)
	}
	rc, err := cfg.resolveHTTPRequest(req.ID, composition.SecretAccessRun{})
	if err != nil {
		t.Fatalf("resolveHTTPRequest after adoption: %v", err)
	}
	if rc.Secret != "legacy-bearer-token" {
		t.Errorf("resolved Secret = %q, want the adopted value", rc.Secret)
	}
	if title := secrets.TitleOf(strings.TrimPrefix(stored.SecretRef, "vault:")); title != "Payments API: secret" {
		t.Errorf("entry title = %q, want it named after the integration and field", title)
	}
	if _, err := keychain.Get(req.ID); !errors.Is(err, credential.ErrNotFound) {
		t.Errorf("keychain item still present after adoption (err=%v), want it removed", err)
	}
}

// Adoption is defined by what is still unadopted, so a second run
// creates nothing and changes nothing.
func TestAdoptSecretsIntoStore_IsIdempotent(t *testing.T) {
	cfg, keychain, secrets := adoptionHarness(t)
	req, err := cfg.CreateHTTPRequest("Payments API", "https://example.com", "", "", httprequest.AuthBearer, "", nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	if err := keychain.Set(req.ID, "legacy-bearer-token"); err != nil {
		t.Fatalf("seeding the legacy keychain item: %v", err)
	}
	if _, err := cfg.AdoptSecretsIntoStore(); err != nil {
		t.Fatalf("first AdoptSecretsIntoStore: %v", err)
	}
	first, _ := findRequestByID(cfg.HTTPRequests(), req.ID)

	adopted, err := cfg.AdoptSecretsIntoStore()
	if err != nil {
		t.Fatalf("second AdoptSecretsIntoStore: %v", err)
	}
	if adopted != 0 {
		t.Errorf("second run adopted %d, want 0", adopted)
	}
	if secrets.Len() != 1 {
		t.Errorf("secret store holds %d entries after two runs, want 1", secrets.Len())
	}
	again, _ := findRequestByID(cfg.HTTPRequests(), req.ID)
	if again.SecretRef != first.SecretRef {
		t.Errorf("second run re-pointed the field: %q -> %q", first.SecretRef, again.SecretRef)
	}
}

// A value that reaches the store but does not read back identically
// leaves the keychain item exactly where it is and the field
// unadopted, so nothing is lost and the next unlock tries again.
func TestAdoptSecretsIntoStore_UnverifiedReadBack_LeavesTheItemInPlace(t *testing.T) {
	cfg, keychain, _ := adoptionHarness(t)
	req, err := cfg.CreateHTTPRequest("Payments API", "https://example.com", "", "", httprequest.AuthBearer, "", nil, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	if err := keychain.Set(req.ID, "legacy-bearer-token"); err != nil {
		t.Fatalf("seeding the legacy keychain item: %v", err)
	}
	// A store that accepts the write but hands back something else --
	// the corruption the read-back exists to catch.
	cfg.SetSecretCreator(func(string, string, secret.Kind) (string, error) { return "entry-x", nil })
	cfg.SetSecretResolver(func(string, secretaudit.AccessContext) (string, error) { return "not-what-was-written", nil })

	if _, err := cfg.AdoptSecretsIntoStore(); err == nil {
		t.Fatal("AdoptSecretsIntoStore reported no error for a value that did not read back")
	}
	stored, _ := findRequestByID(cfg.HTTPRequests(), req.ID)
	if stored.SecretRef != "" {
		t.Errorf("request names %q after a failed read-back, want it left unadopted", stored.SecretRef)
	}
	if got, err := keychain.Get(req.ID); err != nil || got != "legacy-bearer-token" {
		t.Errorf("keychain item = (%q, %v) after a failed read-back, want it left exactly where it was", got, err)
	}
}

// OAuth 1.0a's single legacy slot held both secrets in one encoded
// string; adoption splits it into two independently-rotatable entries.
func TestAdoptSecretsIntoStore_SplitsTheOAuth1DualSecret(t *testing.T) {
	cfg, keychain, _ := adoptionHarness(t)
	auth := &httprequest.AuthConfig{OAuth1: &httprequest.OAuth1Config{ConsumerKey: "ck"}}
	req, err := cfg.CreateHTTPRequest("Legacy OAuth1", "https://example.com", "", "", httprequest.AuthOAuth1, "", nil, "", auth, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	if err := keychain.Set(req.ID, composition.EncodeOAuth1Secret("cs-legacy", "ts-legacy")); err != nil {
		t.Fatalf("seeding the legacy keychain item: %v", err)
	}

	if _, err := cfg.AdoptSecretsIntoStore(); err != nil {
		t.Fatalf("AdoptSecretsIntoStore: %v", err)
	}
	stored, _ := findRequestByID(cfg.HTTPRequests(), req.ID)
	if stored.Auth == nil || stored.Auth.OAuth1 == nil ||
		stored.Auth.OAuth1.ConsumerSecretRef == "" || stored.Auth.OAuth1.TokenSecretRef == "" {
		t.Fatalf("OAuth 1.0a request after adoption = %+v, want both secrets named separately", stored.Auth)
	}
	if stored.Auth.OAuth1.ConsumerSecretRef == stored.Auth.OAuth1.TokenSecretRef {
		t.Error("both OAuth 1.0a secrets point at one entry, want two independently-rotatable ones")
	}
	rc, err := cfg.resolveHTTPRequest(req.ID, composition.SecretAccessRun{})
	if err != nil {
		t.Fatalf("resolveHTTPRequest after adoption: %v", err)
	}
	if want := composition.EncodeOAuth1Secret("cs-legacy", "ts-legacy"); rc.Secret != want {
		t.Errorf("resolved Secret = %q, want %q rejoined for the strategy", rc.Secret, want)
	}
}

// A JOSE public key that used to sit inline on the entity moves into
// the store as a key-kind entry, and the inline copy is cleared.
func TestAdoptSecretsIntoStore_MovesTheInlineJOSEPublicKey(t *testing.T) {
	cfg, _, secrets := adoptionHarness(t)
	const pem = "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----"
	req, err := cfg.CreateHTTPRequest("JOSE API", "https://example.com", "", "", httprequest.AuthNone, "", nil, "", nil,
		&httprequest.JOSEConfig{Enabled: true, RecipientPublicKeyRef: "vault:placeholder"}, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}
	// Reproduce what an older Mill's settings.json decodes to: the key
	// inline, no reference.
	cfg.mu.Lock()
	for i := range cfg.requests {
		if cfg.requests[i].ID == req.ID {
			cfg.requests[i].JOSE.RecipientPublicKeyRef = ""
			cfg.requests[i].JOSE.LegacyRecipientPublicKeyPEM = pem
		}
	}
	cfg.mu.Unlock()

	if _, err := cfg.AdoptSecretsIntoStore(); err != nil {
		t.Fatalf("AdoptSecretsIntoStore: %v", err)
	}
	stored, _ := findRequestByID(cfg.HTTPRequests(), req.ID)
	if stored.JOSE.RecipientPublicKeyRef == "" {
		t.Fatal("the JOSE public key was not adopted")
	}
	if stored.JOSE.LegacyRecipientPublicKeyPEM != "" {
		t.Error("the inline public key survived adoption, want it cleared once the store holds it")
	}
	id := strings.TrimPrefix(stored.JOSE.RecipientPublicKeyRef, "vault:")
	if got := secrets.KindOf(id); got != secret.KindKey {
		t.Errorf("adopted entry kind = %q, want %q", got, secret.KindKey)
	}
}

// An AI provider's key travels the same door as an integration's.
func TestAdoptSecretsIntoStore_MovesAnAIProviderKey(t *testing.T) {
	cfg, keychain, _ := adoptionHarness(t)
	p, err := cfg.CreateAIProvider("BYO endpoint", aiprovider.KindOpenAICompat, "http://localhost:1234", "m", "")
	if err != nil {
		t.Fatalf("CreateAIProvider: %v", err)
	}
	if err := keychain.Set(p.ID, "sk-legacy"); err != nil {
		t.Fatalf("seeding the legacy keychain item: %v", err)
	}

	if _, err := cfg.AdoptSecretsIntoStore(); err != nil {
		t.Fatalf("AdoptSecretsIntoStore: %v", err)
	}
	rp, err := cfg.resolveAIProvider(p.ID)
	if err != nil {
		t.Fatalf("resolveAIProvider after adoption: %v", err)
	}
	if rp.APIKey != "sk-legacy" {
		t.Errorf("resolved APIKey = %q, want the adopted value", rp.APIKey)
	}
	if _, err := keychain.Get(p.ID); !errors.Is(err, credential.ErrNotFound) {
		t.Errorf("keychain item still present after adoption (err=%v), want it removed", err)
	}
}
