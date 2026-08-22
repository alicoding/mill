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

// mintCode replaces any outstanding code with a fresh one, single live
// code at a time, and returns it unlogged -- callers decide whether
// and how to log it.
func (s *RemoteAuthService) mintCode() (PairingCodeInfo, error) {
	code, err := generateCode()
	if err != nil {
		return PairingCodeInfo{}, fmt.Errorf("remoteauthsvc: generating pairing code: %w", err)
	}

	s.mu.Lock()
	expiresAt := time.Now().Add(pairingCodeTTL)
	s.code = &pairingCode{code: code, expiresAt: expiresAt}
	s.mu.Unlock()

	return PairingCodeInfo{Code: code, ExpiresAt: expiresAt}, nil
}

// GeneratePairingCode mints a new single-use enrollment code on
// demand, replacing any code still outstanding (only one is ever
// live at a time). Held in memory only -- see devicesSettingsKey's
// doc comment for why nothing here touches the settings store. The
// deliberate log line lets a headless/server-mode run (no Settings UI
// to show the code in) still complete pairing from a terminal, but
// only while the instance is unpaired -- once any device is paired,
// the code is never logged again, no matter which caller generated
// it (docs/goals/0132-remote-access.md SLICE 1b: "never log the code
// once paired"). This is the RPC path (Settings > Remote access,
// loopback-only): a desktop owner pairing a second device already
// sees the code on screen, so logging it too would be redundant.
// resendPairingCode below is the OTHER caller, unconditional on
// purpose.
func (s *RemoteAuthService) GeneratePairingCode() (PairingCodeInfo, error) {
	info, err := s.mintCode()
	if err != nil {
		return info, err
	}

	s.mu.Lock()
	unpaired := len(s.devices) == 0
	s.mu.Unlock()

	if unpaired {
		s.logger.Info("remote access: pairing code generated", "code", info.Code, "expires", info.ExpiresAt)
	}
	return info, nil
}

// resendPairingCode is the pairing page's own unauthenticated "Get a
// new code" action (SLICE 2 DESIGN CONTRACT item 2). Unlike
// GeneratePairingCode above it logs UNCONDITIONALLY, regardless of how
// many devices are already paired -- closing a real lockout:
// BootstrapPairingCode only mints at process start and only while
// unpaired, so once a first device pairs, a restart mints nothing
// further. A device that then loses its cookie (cleared site data, a
// wiped phone) has no other path back in without this. Reading the
// log still requires host filesystem access, the same authorization
// signal the whole bootstrap design already rests on, so an
// unauthenticated caller triggering this gains nothing -- the code
// itself never leaves the log (never the HTTP response).
func (s *RemoteAuthService) resendPairingCode() (PairingCodeInfo, error) {
	info, err := s.mintCode()
	if err != nil {
		return info, err
	}
	s.logger.Info("remote access: pairing code generated", "code", info.Code, "expires", info.ExpiresAt)
	return info, nil
}

// BootstrapPairingCode closes the SLICE 1b bootstrap deadlock: a
// server-mode instance bound to a non-loopback interface (Mill's own
// documented remote-access posture) has no loopback path at all, so
// every request -- including the one that would call
// GeneratePairingCode over RPC -- is challenged by the very gate a
// pairing code is needed to pass. Called once at process construction
// (internal/services/wiring.WireRemoteAuth), it mints and logs a code
// directly, in-process, bypassing the RPC path entirely, whenever the
// instance is still unpaired -- refreshed on every restart until the
// first device pairs. Reading that log line requires filesystem
// access to the host, the same bootstrap-authorization shape
// code-server's config-file password and Syncthing's first-run GUI
// credentials use.
//
// serverMode is passed in rather than sensed here because desktop
// builds already have a loopback-reachable Settings > Remote access
// path regardless of pairing state -- auto-minting (and logging) a
// code on every desktop launch would be log noise for a bootstrap
// path desktop mode never needs. It is recorded on the service either
// way (even when this call is a no-op below) so the pairing page can
// always choose its per-mode copy correctly (SLICE 2 DESIGN CONTRACT
// item 1).
//
// Exported for main.go/wiring's own construction flow, not a frontend
// RPC -- calling this outside process construction would re-run the
// bootstrap decision against already-live state.
//
//wails:ignore
func (s *RemoteAuthService) BootstrapPairingCode(serverMode bool) {
	s.mu.Lock()
	s.serverMode = serverMode
	unpaired := len(s.devices) == 0
	s.mu.Unlock()
	if !serverMode || !unpaired {
		return
	}
	if _, err := s.GeneratePairingCode(); err != nil {
		s.logger.Error("remote access: bootstrap pairing code", "error", err)
	}
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
func (s *RemoteAuthService) validatePairingCode(candidate string, now time.Time) bool {
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
