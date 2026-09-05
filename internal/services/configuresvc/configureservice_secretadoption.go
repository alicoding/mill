package configuresvc

import (
	"errors"
	"fmt"
	"log/slog"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/domain/vaultref"
)

// Adoption is the one-way move from "the value sat in a per-entity OS
// keychain item" to "the entity names an entry in the secret store"
// (goal 0306). It runs on every unlock and is defined by what is still
// unadopted -- a field already naming an entry is skipped -- so running
// it twice does nothing the first run did not. Once it has run, the OS
// keychain holds one Mill item: the vault's own master key (goal 0330).
//
// It also gives a seeded example its demo credential. Those used to be
// written straight to the keychain at seed time, which no longer
// happens at all: the store is the only place a credential is created,
// and the store is not open until someone unlocks it.

// legacyJOSEAccount is where a request's JOSE private key was kept
// before keys became references -- a second keychain item per request,
// because JOSE is independent of AuthType and the two values could not
// share one slot.
func legacyJOSEAccount(id string) string { return id + ":jose" }

// ErrSecretAdoptionUnverified is a value that reached the store but did
// not read back identically. The keychain item is left exactly where it
// is and the field left unadopted, so the next unlock tries again and
// nothing is lost in between.
var ErrSecretAdoptionUnverified = usererror.New("secret-adoption-unverified",
	"A saved credential could not be moved into your secret store, so it was left where it was.")

// SecretCreator creates one entry in the store and returns its id.
type SecretCreator func(title, value string, kind secret.Kind) (string, error)

// SetSecretCreator wires the store's own create door, late, the same
// way SetSecretResolver wires its read door.
//
//wails:ignore
func (c *ConfigureService) SetSecretCreator(fn SecretCreator) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.secretCreator = fn
}

func (c *ConfigureService) creatorFn() SecretCreator {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.secretCreator
}

// AdoptSecretsIntoStore moves every still-unadopted credential into the
// secret store and rewrites the entity that used it to name the new
// entry. Returns how many entries it created. It always finishes what
// it can, reporting the first failure rather than stopping at it.
//
//wails:ignore
func (c *ConfigureService) AdoptSecretsIntoStore() (int, error) {
	if c.creatorFn() == nil {
		return 0, nil
	}
	adopted, firstErr := c.adoptRequestSecrets()
	n, err := c.adoptAIProviderKeys()
	adopted += n
	if firstErr == nil {
		firstErr = err
	}
	return adopted, firstErr
}

// adoptRequestSecrets walks every HTTPRequest, adopting whichever of
// its secret-shaped fields still hold no reference.
func (c *ConfigureService) adoptRequestSecrets() (int, error) {
	adopted := 0
	var firstErr error
	for _, req := range c.HTTPRequests() {
		n, err := c.adoptOneRequest(req)
		adopted += n
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return adopted, firstErr
}

// adoptOneRequest creates an entry for each unadopted field of req,
// writes the references back in one update, and only then removes the
// keychain items the values came from.
func (c *ConfigureService) adoptOneRequest(req httprequest.HTTPRequest) (int, error) {
	refs, err := c.buildRequestRefs(req)
	if refs == nil {
		return 0, err
	}
	if applyErr := c.applyRequestRefs(req.ID, refs); applyErr != nil {
		return refs.count(), applyErr
	}
	c.forgetLegacyRequestKeychain(req.ID)
	return refs.count(), err
}

// requestRefs is one request's adopted references, by field.
type requestRefs struct {
	secretRef    string
	consumerRef  string
	tokenRef     string
	publicKeyRef string
	privateRef   string
}

// applyTo writes every adopted reference onto r, leaving any field
// this adoption did not touch exactly as it is.
func (r *requestRefs) applyTo(req *httprequest.HTTPRequest) {
	if r.secretRef != "" {
		req.SecretRef = r.secretRef
	}
	if r.consumerRef != "" || r.tokenRef != "" {
		ensureOAuth1(req)
		setIfAdopted(&req.Auth.OAuth1.ConsumerSecretRef, r.consumerRef)
		setIfAdopted(&req.Auth.OAuth1.TokenSecretRef, r.tokenRef)
	}
	if req.JOSE == nil {
		return
	}
	if r.publicKeyRef != "" {
		req.JOSE.RecipientPublicKeyRef = r.publicKeyRef
		req.JOSE.LegacyRecipientPublicKeyPEM = ""
	}
	setIfAdopted(&req.JOSE.PrivateKeyRef, r.privateRef)
}

func setIfAdopted(field *string, ref string) {
	if ref != "" {
		*field = ref
	}
}

// count is how many store entries this adoption created.
func (r *requestRefs) count() int {
	n := 0
	for _, ref := range []string{r.secretRef, r.consumerRef, r.tokenRef, r.publicKeyRef, r.privateRef} {
		if ref != "" {
			n++
		}
	}
	return n
}

// adopter creates store entries for one request, remembering the first
// failure rather than stopping at it, so one unadoptable field never
// strands the rest.
type adopter struct {
	cfg     *ConfigureService
	label   string
	created bool
	err     error
}

// take stores value as this request's field and points into at the new
// entry. An empty value means the field had nothing to adopt.
func (a *adopter) take(field, value string, kind secret.Kind, into *string) {
	if value == "" {
		return
	}
	ref, err := a.cfg.storeAdopted(adoptionTitle(a.label, field), value, kind)
	if err != nil {
		if a.err == nil {
			a.err = err
		}
		return
	}
	*into = ref
	a.created = true
}

// buildRequestRefs creates the store entries req still needs. A field
// takes its value from the keychain item that held it, or -- for a
// seeded example whose demo credential was never stored anywhere on
// this device -- from the example's own golden value.
func (c *ConfigureService) buildRequestRefs(req httprequest.HTTPRequest) (*requestRefs, error) {
	out := &requestRefs{}
	a := &adopter{cfg: c, label: req.Label}
	c.adoptRequestAuth(a, req, out)
	c.adoptRequestJOSE(a, req, out)
	if !a.created {
		return nil, a.err
	}
	return out, a.err
}

// adoptRequestAuth adopts whichever secret req's own auth scheme needs.
func (c *ConfigureService) adoptRequestAuth(a *adopter, req httprequest.HTTPRequest, out *requestRefs) {
	value := c.legacyValue(req.ID)
	if isOAuth1(req.AuthType) {
		if !oauth1RefsMissing(req) {
			return
		}
		if value == "" {
			value = builtInOAuth1SecretFor(req.ID)
		}
		consumer, token := composition.DecodeOAuth1Secret(value)
		a.take(fieldConsumerSecret, consumer, secret.KindText, &out.consumerRef)
		a.take(fieldTokenSecret, token, secret.KindText, &out.tokenRef)
		return
	}
	if req.AuthType == httprequest.AuthNone || req.SecretRef != "" {
		return
	}
	if value == "" {
		value = builtInSecrets[req.ID]
	}
	a.take(fieldSecret, value, secret.KindText, &out.secretRef)
}

// adoptRequestJOSE adopts the two keys JOSE names, when it is
// configured at all.
func (c *ConfigureService) adoptRequestJOSE(a *adopter, req httprequest.HTTPRequest, out *requestRefs) {
	if req.JOSE == nil {
		return
	}
	if req.JOSE.RecipientPublicKeyRef == "" {
		a.take(fieldPublicKey, req.JOSE.LegacyRecipientPublicKeyPEM, secret.KindKey, &out.publicKeyRef)
	}
	if req.JOSE.DecryptResponse && req.JOSE.PrivateKeyRef == "" {
		a.take(fieldPrivateKey, c.legacyValue(legacyJOSEAccount(req.ID)), secret.KindKey, &out.privateRef)
	}
}

func isOAuth1(t httprequest.AuthType) bool {
	return t == httprequest.AuthOAuth1 || t == httprequest.AuthOAuth1Vendor
}

// applyRequestRefs writes refs onto the stored request, re-reading it
// under the lock so a concurrent edit is never overwritten by a stale
// copy, and leaving any field the caller did not adopt exactly as it is.
func (c *ConfigureService) applyRequestRefs(id string, refs *requestRefs) error {
	c.mu.Lock()
	idx := -1
	for i, r := range c.requests {
		if r.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.mu.Unlock()
		return nil
	}
	updated := c.requests[idx]
	refs.applyTo(&updated)
	c.requests[idx] = updated
	c.mu.Unlock()

	if err := c.persistHTTPRequests(); err != nil {
		return fmt.Errorf("saving %q after moving its secrets into the store: %w", updated.Label, err)
	}
	return nil
}

// forgetLegacyRequestKeychain removes a request's old keychain items
// once its fields name store entries instead. An item that is already
// gone reports not-found, which is the state this wants anyway.
func (c *ConfigureService) forgetLegacyRequestKeychain(id string) {
	for _, account := range []string{id, legacyJOSEAccount(id)} {
		if err := c.credentials.Delete(account); err != nil && !errors.Is(err, credential.ErrNotFound) {
			slog.Warn("removing a credential Mill no longer keeps in the OS keychain", "request", id, "error", err)
		}
	}
}

// adoptAIProviderKeys does for AI providers what adoptRequestSecrets
// does for requests -- one field each, so no per-field table.
func (c *ConfigureService) adoptAIProviderKeys() (int, error) {
	adopted := 0
	var firstErr error
	for _, p := range c.AIProviders() {
		done, err := c.adoptOneAIProviderKey(p)
		if err != nil && firstErr == nil {
			firstErr = err
		}
		if done {
			adopted++
		}
	}
	return adopted, firstErr
}

// adoptOneAIProviderKey moves one provider's legacy key into the store
// and points the provider at it.
func (c *ConfigureService) adoptOneAIProviderKey(p aiprovider.AIProvider) (bool, error) {
	if p.KeyRef != "" {
		return false, nil
	}
	value := c.legacyValue(p.ID)
	if value == "" {
		return false, nil
	}
	ref, err := c.storeAdopted(adoptionTitle(p.Label, fieldAIProviderKey), value, secret.KindText)
	if err != nil {
		return false, err
	}
	c.mu.Lock()
	for i, entry := range c.aiProviders {
		if entry.ID == p.ID {
			c.aiProviders[i].KeyRef = ref
		}
	}
	c.mu.Unlock()
	if err := c.persistAIProviders(); err != nil {
		return true, fmt.Errorf("saving %q after moving its key into the store: %w", p.Label, err)
	}
	if err := c.credentials.Delete(p.ID); err != nil && !errors.Is(err, credential.ErrNotFound) {
		slog.Warn("removing a credential Mill no longer keeps in the OS keychain", "aiprovider", p.ID, "error", err)
	}
	return true, nil
}

// legacyValue reads one old keychain item, treating every failure as
// "nothing there": a keychain that cannot be read is not a reason to
// fail an unlock, and an unadopted field is retried on the next one.
func (c *ConfigureService) legacyValue(account string) string {
	value, err := c.credentials.Get(account)
	if err != nil {
		return ""
	}
	return value
}

// storeAdopted creates the entry and proves it reads back before any
// caller rewrites a field to point at it -- the read-back is what makes
// removing the old copy safe.
func (c *ConfigureService) storeAdopted(title, value string, kind secret.Kind) (string, error) {
	id, err := c.creatorFn()(title, value, kind)
	if err != nil {
		return "", fmt.Errorf("saving %q into the secret store: %w", title, err)
	}
	actx := secretaudit.AccessContext{Context: secretaudit.ContextSecretAdoption}
	readBack, err := c.secretResolver(id, actx)
	if err != nil || readBack != value {
		return "", usererror.Wrap(ErrSecretAdoptionUnverified.Code, ErrSecretAdoptionUnverified.Message,
			fmt.Errorf("entry %q did not read back after being written: %w", title, err))
	}
	return vaultref.Ref(vaultref.ProviderVault, id), nil
}

// adoptionTitle names the created entry after the entity and field it
// came from, so a store full of adopted entries still says what each
// one is for.
func adoptionTitle(label, field string) string { return label + ": " + field }

// oauth1RefsMissing reports whether an OAuth 1.0a request still names
// neither of its two secrets.
func oauth1RefsMissing(r httprequest.HTTPRequest) bool {
	return r.Auth == nil || r.Auth.OAuth1 == nil ||
		(r.Auth.OAuth1.ConsumerSecretRef == "" && r.Auth.OAuth1.TokenSecretRef == "")
}

func ensureOAuth1(r *httprequest.HTTPRequest) {
	if r.Auth == nil {
		r.Auth = &httprequest.AuthConfig{}
	}
	if r.Auth.OAuth1 == nil {
		r.Auth.OAuth1 = &httprequest.OAuth1Config{}
	}
}
