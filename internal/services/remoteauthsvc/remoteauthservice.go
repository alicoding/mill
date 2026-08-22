// Package remoteauthsvc gates every request Mill's AssetServer serves
// behind device pairing for any connection that did not arrive over
// loopback. The desktop webview always connects over loopback and is
// never challenged; a phone or another machine reaching Mill over the
// Tailscale interface (today) or a tunnel (docs/goals/0132-remote-access.md
// slice 2) must present a valid device token first. See that goal
// file's "SLICE 1 DESIGN CONTRACT" section for the full behavior this
// package implements.
package remoteauthsvc

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/settings"
)

// devicesSettingsKey persists the paired-device list as one atomic
// JSON blob, the same shape settingssvc uses for its own single-key
// settings (see settingsservice.go's summonHotkeyKey). Only a salted
// hash, a label, and timestamps are ever written here -- never a raw
// token (SLICE 1 DESIGN CONTRACT, pairing step 3).
const devicesSettingsKey = "remote-access-devices"

// DeviceTokenCookieName is the cookie a paired device presents on
// every later request. Just a cookie name, not a secret itself --
// the actual token never appears in source.
const DeviceTokenCookieName = "mill_device_token" //nolint:gosec // cookie name, not a credential

// device is a paired device's persisted record. Salt and Hash are
// stored hex-encoded because settings.Store persists through
// encoding/json, which cannot round-trip raw []byte as anything but a
// string anyway -- named fields keep that encoding explicit rather
// than incidental.
type device struct {
	ID         string    `json:"id"`
	Label      string    `json:"label"`
	SaltB64    string    `json:"salt"`
	HashB64    string    `json:"hash"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

// pairingCode is the single in-memory, on-demand enrollment code.
// Never persisted (SLICE 1 DESIGN CONTRACT, pairing step 2).
type pairingCode struct {
	code      string
	expiresAt time.Time
}

// Service is the Wails-bound owner of Mill's remote-access auth gate:
// the AssetServer middleware (remoteauthservice_middleware.go), the
// pairing-code lifecycle (remoteauthservice_pairing.go), the paired-
// device store (remoteauthservice_devices.go), and the per-source
// rate limiter (remoteauthservice_ratelimit.go).
type Service struct {
	mu     sync.Mutex
	store  settings.Store
	logger *slog.Logger

	devices []device
	code    *pairingCode
	limiter map[string]*rateLimitEntry
}

// New constructs a Service backed by store for persistence, loading
// any previously paired devices immediately so a restart never
// silently unpairs a device.
func New(store settings.Store, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Service{
		store:   store,
		logger:  logger,
		limiter: make(map[string]*rateLimitEntry),
	}
	s.loadDevices()
	return s
}

// loadDevices reads the persisted device list. A missing or corrupt
// entry is treated as "no devices paired" rather than a fatal error --
// the surface simply challenges every non-loopback request again,
// which is the fail-closed direction.
func (s *Service) loadDevices() {
	raw, ok := s.store.Get(devicesSettingsKey).(string)
	if !ok || raw == "" {
		return
	}
	var devices []device
	if err := json.Unmarshal([]byte(raw), &devices); err != nil {
		s.logger.Error("remote access: loading paired devices", "error", err)
		return
	}
	s.devices = devices
}

// saveDevices persists the current device list. Called with mu held.
func (s *Service) saveDevices() error {
	raw, err := json.Marshal(s.devices)
	if err != nil {
		return err
	}
	return s.store.Set(devicesSettingsKey, string(raw))
}
