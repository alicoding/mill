package clientcert

import "time"

// State is what a Certificates row reports about one entity, computed
// from the certificate's own validity window. It never carries the
// material, and never the reason a read failed beyond "could not be
// read" -- a status line is not a diagnostic channel.
type State string

const (
	// StateIncomplete: the entity names no certificate yet, or names a
	// PEM certificate with no key beside it.
	StateIncomplete State = "incomplete"
	// StateUnreadable: the material is named but cannot be read right
	// now -- the vault is locked, an entry was deleted, or a
	// passphrase does not open the bundle.
	StateUnreadable State = "unreadable"
	StateReady      State = "ready"
	// StateExpiring: valid, but inside ExpiryWarningDays of its end.
	StateExpiring State = "expiring"
	StateExpired  State = "expired"
)

// ExpiryWarningDays is how far ahead a row starts counting down.
const ExpiryWarningDays = 30

// Status is one entity's certificate identity and validity. Subject/
// Issuer/NotBefore/NotAfter are the ONLY fields read out of the
// certificate: never the PEM, never anything derived from the key.
type Status struct {
	ID        string    `json:"id"`
	State     State     `json:"state"`
	DaysLeft  int       `json:"daysLeft"`
	Subject   string    `json:"subject"`
	Issuer    string    `json:"issuer"`
	NotBefore time.Time `json:"notBefore"`
	NotAfter  time.Time `json:"notAfter"`
}

// StateFor classifies a validity window at now. A certificate whose
// start is still in the future counts as expired for this purpose:
// either way the handshake fails, and one state keeps the row honest
// without a fifth pill nobody can act on differently.
func StateFor(notBefore, notAfter, now time.Time) (State, int) {
	if now.Before(notBefore) || !now.Before(notAfter) {
		return StateExpired, 0
	}
	days := int(notAfter.Sub(now).Hours() / 24)
	if days <= ExpiryWarningDays {
		return StateExpiring, days
	}
	return StateReady, days
}
