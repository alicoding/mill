package remoteauthsvc

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"sort"
	"time"
)

// deviceTokenBytes and deviceSaltBytes are the SLICE 1 DESIGN
// CONTRACT's "32 random bytes" device token verbatim, plus a
// same-size random salt per device so two devices' hashes never
// collide even from the same token-generation process.
const (
	deviceTokenBytes = 32
	deviceSaltBytes  = 32
	deviceIDBytes    = 16
)

// DeviceInfo is Settings > Remote access's read model for one paired
// device -- deliberately excludes Salt/Hash, which never leave the
// server.
type DeviceInfo struct {
	ID         string    `json:"id"`
	Label      string    `json:"label"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

// ListDevices returns every currently paired device, oldest first, so
// Settings renders a stable order across renders.
func (s *RemoteAuthService) ListDevices() []DeviceInfo {
	s.mu.Lock()
	defer s.mu.Unlock()

	infos := make([]DeviceInfo, 0, len(s.devices))
	for _, d := range s.devices {
		infos = append(infos, DeviceInfo{
			ID:         d.ID,
			Label:      d.Label,
			CreatedAt:  d.CreatedAt,
			LastSeenAt: d.LastSeenAt,
		})
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].CreatedAt.Before(infos[j].CreatedAt) })
	return infos
}

// RevokeDevice deletes id's paired-device record. Any request still
// carrying that device's cookie is rejected on its very next request
// -- validateToken (below) only ever matches against the live list.
func (s *RemoteAuthService) RevokeDevice(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	kept := s.devices[:0]
	found := false
	for _, d := range s.devices {
		if d.ID == id {
			found = true
			continue
		}
		kept = append(kept, d)
	}
	if !found {
		return fmt.Errorf("remoteauthsvc: no paired device %q", id)
	}
	s.devices = kept
	return s.saveDevices()
}

// mintDevice pairs a new device: generates its token, stores only a
// salted hash of it (SLICE 1 DESIGN CONTRACT, pairing step 3), and
// returns the raw token so the caller can set it as the device
// cookie. The raw token is never retained after this call returns.
// Held under mu by callers.
func (s *RemoteAuthService) mintDevice(label string) (token string, err error) {
	tokenBytes, err := randomBytes(deviceTokenBytes)
	if err != nil {
		return "", err
	}
	saltBytes, err := randomBytes(deviceSaltBytes)
	if err != nil {
		return "", err
	}
	idBytes, err := randomBytes(deviceIDBytes)
	if err != nil {
		return "", err
	}

	token = hex.EncodeToString(tokenBytes)
	now := time.Now()
	s.devices = append(s.devices, device{
		ID:         hex.EncodeToString(idBytes),
		Label:      label,
		SaltB64:    hex.EncodeToString(saltBytes),
		HashB64:    hashToken(saltBytes, tokenBytes),
		CreatedAt:  now,
		LastSeenAt: now,
	})
	if err := s.saveDevices(); err != nil {
		return "", err
	}
	return token, nil
}

// validateToken reports whether token matches a live paired device,
// updating that device's LastSeenAt on success. It always walks the
// full device list rather than short-circuiting on the first
// comparison, and every comparison is crypto/subtle -- no early exit
// gives an attacker a per-device timing signal, and an absent/
// malformed token still costs the same compare loop as a wrong one.
// Held under mu by callers.
func (s *RemoteAuthService) validateToken(token string, now time.Time) bool {
	tokenBytes, err := hex.DecodeString(token)
	if err != nil {
		return false
	}
	matchedIndex := -1
	for i, d := range s.devices {
		saltBytes, err := hex.DecodeString(d.SaltB64)
		if err != nil {
			continue
		}
		candidateHash := hashToken(saltBytes, tokenBytes)
		if subtle.ConstantTimeCompare([]byte(candidateHash), []byte(d.HashB64)) == 1 {
			matchedIndex = i
		}
	}
	if matchedIndex == -1 {
		return false
	}
	s.devices[matchedIndex].LastSeenAt = now
	if err := s.saveDevices(); err != nil {
		s.logger.Error("remote access: recording device last-seen", "error", err)
	}
	return true
}

// hashToken is the salted SHA-256 hash persisted for a device -- the
// only server-side record of its token (SLICE 1 DESIGN CONTRACT,
// pairing step 3: "the token itself is never stored server-side").
func hashToken(salt, token []byte) string {
	h := sha256.New()
	h.Write(salt)
	h.Write(token)
	return hex.EncodeToString(h.Sum(nil))
}

func randomBytes(n int) ([]byte, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return b, nil
}
