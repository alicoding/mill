package remoteauthsvc

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
)

// deviceLabelMaxLen caps a renamed device's label so a pasted essay
// can't blow out the Settings row -- truncated, never rejected, since
// a length cap is a display concern, not a validity one.
const deviceLabelMaxLen = 64

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
// server. Unlike the device token (shown once, at pairing), the phone
// channel's SubscribeURL is meant to be re-copied any time, so it is
// exposed in full here.
type DeviceInfo struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	// Kind is KindDevice for a phone or another computer, KindBrowser
	// for a paired browser extension -- Settings lists the two in
	// separate sections and never mixes them in one list.
	Kind       string    `json:"kind"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
	// SubscribeURL is this device's ntfy phone-channel address (docs/
	// goals/0132 SLICE B), built from Topic plus the address this
	// device last reached Mill on. Empty until Mill has seen a request
	// from this device with a resolvable host.
	SubscribeURL string `json:"subscribeUrl,omitempty"`
}

// ListDevices returns every currently paired phone or computer, oldest
// first, so Settings renders a stable order across renders. Paired
// browsers are deliberately absent -- they have their own section and
// their own list (ListBrowsers).
func (s *RemoteAuthService) ListDevices() []DeviceInfo {
	return s.listOfKind(KindDevice)
}

// ListBrowsers returns every paired browser extension, same order and
// read model as ListDevices.
func (s *RemoteAuthService) ListBrowsers() []DeviceInfo {
	return s.listOfKind(KindBrowser)
}

func (s *RemoteAuthService) listOfKind(kind string) []DeviceInfo {
	s.mu.Lock()
	defer s.mu.Unlock()

	infos := make([]DeviceInfo, 0, len(s.devices))
	for _, d := range s.devices {
		if d.Kind != kind {
			continue
		}
		infos = append(infos, DeviceInfo{
			ID:           d.ID,
			Label:        d.Label,
			Kind:         d.Kind,
			CreatedAt:    d.CreatedAt,
			LastSeenAt:   d.LastSeenAt,
			SubscribeURL: subscribeURL(d),
		})
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].CreatedAt.Before(infos[j].CreatedAt) })
	return infos
}

// subscribeURL builds d's copyable ntfy address, or "" until both
// halves (a topic, and a proven-reachable base address) are known.
func subscribeURL(d device) string {
	if d.BaseURL == "" || d.Topic == "" {
		return ""
	}
	return d.BaseURL + "/" + d.Topic + "/json"
}

// RevokeDevice deletes id's paired-device record. Any request still
// carrying that device's cookie is rejected on its very next request
// -- validateToken (below) only ever matches against the live list.
// The device's phone-channel topic dies with it: a new subscribe
// attempt gets the same 404 as any never-paired topic (recordTopicSeen
// only matches the live list too), and forceCloseTopic drops any
// subscribe connection already open right now, rather than waiting for
// it to eventually reconnect into a 404.
func (s *RemoteAuthService) RevokeDevice(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	kept := s.devices[:0]
	found := false
	var revokedTopic string
	for _, d := range s.devices {
		if d.ID == id {
			found = true
			revokedTopic = d.Topic
			continue
		}
		kept = append(kept, d)
	}
	if !found {
		return fmt.Errorf("remoteauthsvc: no paired device %q", id)
	}
	s.devices = kept
	err := s.saveDevices()
	if revokedTopic != "" {
		s.forceCloseTopic(revokedTopic)
	}
	return err
}

// RenameDevice updates a paired device's label -- a device is
// pre-filled with a self-announced label at pairing time
// (deviceLabelFor) and renameable afterwards. Empty (after trimming)
// is rejected rather than silently keeping the old label, so the
// caller gets an explicit signal a blank name didn't take.
func (s *RemoteAuthService) RenameDevice(id, label string) error {
	trimmed := strings.TrimSpace(label)
	if trimmed == "" {
		return fmt.Errorf("remoteauthsvc: device label cannot be empty")
	}
	if len(trimmed) > deviceLabelMaxLen {
		trimmed = trimmed[:deviceLabelMaxLen]
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for i, d := range s.devices {
		if d.ID == id {
			s.devices[i].Label = trimmed
			return s.saveDevices()
		}
	}
	return fmt.Errorf("remoteauthsvc: no paired device %q", id)
}

// testAllowDeviceSeedEnv lets the Playwright e2e suite populate a
// paired device without a real pairing round trip: pairing only ever
// completes over a non-loopback connection (SLICE 1 DESIGN CONTRACT),
// which the isolated per-worker server pool never has. Unset in every
// real deployment, where SeedTestDevice below refuses outright.
const testAllowDeviceSeedEnv = "MILL_TEST_ALLOW_DEVICE_SEED"

// SeedTestDevice mints a paired device directly, bypassing the HTTP
// pairing flow entirely -- e2e-only (see testAllowDeviceSeedEnv
// above), never reachable in a real deployment.
// baseURL is accepted (rather than always "") so e2e coverage can seed
// a device whose SubscribeURL is already populated -- a real pairing
// round trip sets it from the pairing request itself, which this seam
// exists specifically to bypass.
func (s *RemoteAuthService) SeedTestDevice(label, baseURL string) (DeviceInfo, error) {
	if os.Getenv(testAllowDeviceSeedEnv) == "" {
		return DeviceInfo{}, fmt.Errorf("remoteauthsvc: SeedTestDevice is unavailable outside test mode")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.mintDevice(label, baseURL, KindDevice); err != nil {
		return DeviceInfo{}, err
	}
	d := s.devices[len(s.devices)-1]
	return DeviceInfo{ID: d.ID, Label: d.Label, Kind: d.Kind, CreatedAt: d.CreatedAt, LastSeenAt: d.LastSeenAt, SubscribeURL: subscribeURL(d)}, nil
}

// mintDevice pairs a new device: generates its token, stores only a
// salted hash of it (SLICE 1 DESIGN CONTRACT, pairing step 3), and
// returns the raw token so the caller can set it as the device
// cookie. The raw token is never retained after this call returns.
// It also generates the phone channel's topic (SLICE B item 1) --
// long, crypto/rand, never user-chosen -- and records baseURL (the
// scheme+host this pairing request itself arrived on, "" when
// unknown) as the device's first known reachable address. Held under
// mu by callers.
func (s *RemoteAuthService) mintDevice(label, baseURL, kind string) (token string, err error) {
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
	topicBytes, err := randomBytes(deviceTopicBytes)
	if err != nil {
		return "", err
	}

	token = hex.EncodeToString(tokenBytes)
	now := time.Now()
	s.devices = append(s.devices, device{
		ID:         hex.EncodeToString(idBytes),
		Label:      label,
		Kind:       kind,
		SaltB64:    hex.EncodeToString(saltBytes),
		HashB64:    hashToken(saltBytes, tokenBytes),
		Topic:      hex.EncodeToString(topicBytes),
		BaseURL:    baseURL,
		CreatedAt:  now,
		LastSeenAt: now,
	})
	if err := s.saveDevices(); err != nil {
		return "", err
	}
	return token, nil
}

// backfillTopics assigns a phone-channel topic to any device paired
// before that channel existed, so an already-paired device gets the
// capability with no re-pair required. Reports whether anything
// changed, so the caller only persists when needed. Held under mu by
// callers (loadDevices, at construction, before the service is shared).
func (s *RemoteAuthService) backfillTopics() bool {
	changed := false
	for i, d := range s.devices {
		if d.Topic != "" {
			continue
		}
		topicBytes, err := randomBytes(deviceTopicBytes)
		if err != nil {
			s.logger.Error("remote access: backfilling phone topic", "device", d.ID, "error", err)
			continue
		}
		s.devices[i].Topic = hex.EncodeToString(topicBytes)
		changed = true
	}
	return changed
}

// validateToken reports whether token matches a live paired record OF
// THE GIVEN KIND, updating its LastSeenAt (and BaseURL, when baseURL is
// non-empty) on success. The kind check is what stops one credential
// crossing into the other surface: a browser's bearer token can never
// serve as an app-access cookie, and a phone's cookie can never drive
// the bridge. It always walks the full device list rather
// than short-circuiting on the first comparison, and every comparison
// is crypto/subtle -- no early exit gives an attacker a per-device
// timing signal, and an absent/malformed token still costs the same
// compare loop as a wrong one. Held under mu by callers.
func (s *RemoteAuthService) validateToken(token, baseURL, kind string, now time.Time) (DeviceInfo, bool) {
	tokenBytes, err := hex.DecodeString(token)
	if err != nil {
		return DeviceInfo{}, false
	}
	matchedIndex := -1
	for i, d := range s.devices {
		saltBytes, err := hex.DecodeString(d.SaltB64)
		if err != nil {
			continue
		}
		candidateHash := hashToken(saltBytes, tokenBytes)
		if subtle.ConstantTimeCompare([]byte(candidateHash), []byte(d.HashB64)) == 1 && d.Kind == kind {
			matchedIndex = i
		}
	}
	if matchedIndex == -1 {
		return DeviceInfo{}, false
	}
	s.devices[matchedIndex].LastSeenAt = now
	if baseURL != "" {
		s.devices[matchedIndex].BaseURL = baseURL
	}
	if err := s.saveDevices(); err != nil {
		s.logger.Error("remote access: recording device last-seen", "error", err)
	}
	d := s.devices[matchedIndex]
	return DeviceInfo{ID: d.ID, Label: d.Label, Kind: d.Kind, CreatedAt: d.CreatedAt, LastSeenAt: d.LastSeenAt, SubscribeURL: subscribeURL(d)}, true
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
