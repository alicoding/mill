package remoteauthsvc

import (
	"crypto/rand"
	"crypto/subtle"
	"fmt"
	"math/big"
	"strings"
	"time"
)

// pairingCodeAlphabet excludes every character that a person could
// misread from another (0/O, 1/I/L) -- an 8-character code typed by
// hand on a phone keyboard needs to survive that, not just be short.
const pairingCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// pairingCodeLength and pairingCodeTTL are the SLICE 1 DESIGN
// CONTRACT's pairing numbers verbatim.
const (
	pairingCodeLength = 8
	pairingCodeTTL    = 5 * time.Minute
)

// PairingCodeInfo is what Settings > Remote access renders after
// "Pair a device" is pressed.
type PairingCodeInfo struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// GeneratePairingCode mints a new single-use enrollment code on
// demand, replacing any code still outstanding (only one is ever
// live at a time). Held in memory only -- see devicesSettingsKey's
// doc comment for why nothing here touches the settings store. The
// one deliberate log line lets a headless/server-mode run (no
// Settings UI to show the code in) still complete pairing from a
// terminal.
func (s *Service) GeneratePairingCode() (PairingCodeInfo, error) {
	code, err := generateCode()
	if err != nil {
		return PairingCodeInfo{}, fmt.Errorf("remoteauthsvc: generating pairing code: %w", err)
	}

	s.mu.Lock()
	expiresAt := time.Now().Add(pairingCodeTTL)
	s.code = &pairingCode{code: code, expiresAt: expiresAt}
	s.mu.Unlock()

	s.logger.Info("remote access: pairing code generated", "code", code, "expires", expiresAt)
	return PairingCodeInfo{Code: code, ExpiresAt: expiresAt}, nil
}

// generateCode draws pairingCodeLength characters from
// pairingCodeAlphabet via crypto/rand, uniformly (rand.Int rejects
// bias rather than reducing modulo an unevenly-sized alphabet).
func generateCode() (string, error) {
	alphabetSize := big.NewInt(int64(len(pairingCodeAlphabet)))
	var b strings.Builder
	b.Grow(pairingCodeLength)
	for i := 0; i < pairingCodeLength; i++ {
		n, err := rand.Int(rand.Reader, alphabetSize)
		if err != nil {
			return "", err
		}
		b.WriteByte(pairingCodeAlphabet[n.Int64()])
	}
	return b.String(), nil
}

// validatePairingCode checks candidate (already uppercased/trimmed by
// the caller) against the live code in constant time, and consumes it
// on success -- a code is single-use whether it succeeds or its TTL
// simply expires first (SLICE 1 DESIGN CONTRACT: "codes expire on
// first success or TTL"). Held under mu by callers.
func (s *Service) validatePairingCode(candidate string, now time.Time) bool {
	if s.code == nil {
		return false
	}
	if now.After(s.code.expiresAt) {
		s.code = nil
		return false
	}
	// subtle.ConstantTimeCompare requires equal-length slices; padding
	// isn't needed because both sides are the fixed pairingCodeLength
	// by construction (the caller rejects any other length before this
	// point never reaches here with a mismatched length in practice,
	// but compare defensively rather than assume it).
	match := len(candidate) == len(s.code.code) &&
		subtle.ConstantTimeCompare([]byte(candidate), []byte(s.code.code)) == 1
	if match {
		s.code = nil
	}
	return match
}
