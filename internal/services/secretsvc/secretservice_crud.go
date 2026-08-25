package secretsvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// ListSecrets returns every entry's masked Summary (no password) --
// the browse surface's own list, sorted by title
// (secretvault.Vault.List's own contract).
func (s *SecretService) ListSecrets() ([]secret.Summary, error) {
	return s.vault.List()
}

// ResolveSecretValue returns id's password only -- the seam
// configuresvc.SetSecretResolver wires (goal 0185 S3) so a workflow
// consumer (MCPServer.Env's own "vault:" references) can resolve a
// vault entry without reaching for the human-facing RevealSecret RPC.
// Every call records one audit line (goal 0203 S3) -- actx.Context
// names which resolution seam is asking, statically known by that
// seam's own caller, never guessed here. Exported for wiring only,
// never a frontend RPC.
//
//wails:ignore
func (s *SecretService) ResolveSecretValue(id string, actx secretaudit.AccessContext) (string, error) {
	e, err := s.vault.Get(id)
	if err != nil {
		s.recordAccess(id, "", actx, secretaudit.OutcomeError, err.Error())
		return "", err
	}
	s.recordAccess(id, e.Title, actx, secretaudit.OutcomeRead, "")
	return e.Password, nil
}

// RevealSecret returns one entry in full, password included -- a
// distinct, explicit call from ListSecrets (never incidental to
// browsing), matching SetHTTPRequestSecret's own write-only-elsewhere
// posture but inverted: this vault's whole point is a human can read
// their own password back, unlike the write-only integration-secret
// slots. Records one ContextUIReveal audit line (goal 0203 S3) -- a
// human's own click, not gated (S2 contract), but visible in their own
// Access history.
func (s *SecretService) RevealSecret(id string) (secret.Entry, error) {
	e, err := s.vault.Get(id)
	actx := secretaudit.AccessContext{Context: secretaudit.ContextUIReveal}
	if err != nil {
		s.recordAccess(id, "", actx, secretaudit.OutcomeError, err.Error())
		return secret.Entry{}, err
	}
	s.recordAccess(id, e.Title, actx, secretaudit.OutcomeRead, "")
	return e, nil
}

// SecretHistory returns id's past versions, most-recently-superseded
// first.
func (s *SecretService) SecretHistory(id string) ([]secret.Entry, error) {
	return s.vault.History(id)
}

// CreateSecret validates and inserts a new entry.
func (s *SecretService) CreateSecret(title, username, password, url, notes, tags string) (secret.Entry, error) {
	e := secret.Entry{Title: title, Username: username, Password: password, URL: url, Notes: notes, Tags: tags}
	if err := secret.Validate(e); err != nil {
		return secret.Entry{}, err
	}
	created, err := s.vault.Upsert(e)
	if err != nil {
		return secret.Entry{}, err
	}
	dataevent.Emit("secret", created.ID)
	return created, nil
}

// UpdateSecret validates and overwrites id's current values, pushing the
// PREVIOUS values onto its history (secretvault.Vault.Upsert's own
// contract).
func (s *SecretService) UpdateSecret(id, title, username, password, url, notes, tags string) (secret.Entry, error) {
	if id == "" {
		return secret.Entry{}, fmt.Errorf("no entry id given")
	}
	e := secret.Entry{ID: id, Title: title, Username: username, Password: password, URL: url, Notes: notes, Tags: tags}
	if err := secret.Validate(e); err != nil {
		return secret.Entry{}, err
	}
	updated, err := s.vault.Upsert(e)
	if err != nil {
		return secret.Entry{}, err
	}
	dataevent.Emit("secret", updated.ID)
	return updated, nil
}

// DeleteSecret permanently removes id (and its history) -- no undo.
func (s *SecretService) DeleteSecret(id string) error {
	if err := s.vault.Delete(id); err != nil {
		return err
	}
	dataevent.Emit("secret", id)
	return nil
}

// RedactKnownSecrets scrubs every currently-stored password out of
// text (secret.Redact, goal 0185 S4 -- Finding 4's "no enumerable set
// of secret values to redact against" gap). Best-effort: an unlocked-
// vault error is swallowed here rather than propagated, since a caller
// on the error-formatting path (composition.SetSecretRedactor) has no
// good way to surface a SECOND error about redaction failing while
// already reporting a first one -- text passes through unredacted
// rather than the whole error path failing outright.
//
// Deliberately unaudited (goal 0203 S3 contract): this reads every
// vault entry on a failure path purely to SCRUB output, never to expose
// a value to anyone -- recording it would bury real reads (a workflow
// that actually used a credential) under one audit line per error
// message formatted anywhere in the app.
func (s *SecretService) RedactKnownSecrets(text string) string {
	entries, err := s.vault.List()
	if err != nil {
		return text
	}
	secrets := make([]string, 0, len(entries))
	for _, e := range entries {
		full, err := s.vault.Get(e.ID)
		if err != nil {
			continue
		}
		secrets = append(secrets, full.Password)
	}
	return secret.Redact(secrets, text)
}

// GeneratePassword returns a fresh CSPRNG password from the given
// character-class options -- stateless, doesn't touch the vault at all
// (a user can generate before the vault is even unlocked).
func (s *SecretService) GeneratePassword(length int, upper, lower, digits, symbols bool) (string, error) {
	return secret.Generate(secret.GenerateOptions{Length: length, Upper: upper, Lower: lower, Digits: digits, Symbols: symbols})
}
