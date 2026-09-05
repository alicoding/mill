package remoteauthsvc

import (
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/settings"
)

// TestSeedTestDevice_RefusesOutsideTestMode pins the e2e-only seam's
// guard: absent MILL_TEST_ALLOW_DEVICE_SEED, this must never mint a
// device -- a real deployment must never expose an unauthenticated
// device-minting path.
func TestSeedTestDevice_RefusesOutsideTestMode(t *testing.T) {
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s := New(store, slog.New(slog.DiscardHandler))

	if _, err := s.SeedTestDevice("Phone", ""); err == nil {
		t.Fatalf("SeedTestDevice() outside test mode = nil error, want an error")
	}
	if len(s.ListDevices()) != 0 {
		t.Fatalf("ListDevices() = %v, want no device minted", s.ListDevices())
	}
}

func TestSeedTestDevice_MintsWhenEnabled(t *testing.T) {
	t.Setenv(testAllowDeviceSeedEnv, "1")
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s := New(store, slog.New(slog.DiscardHandler))

	info, err := s.SeedTestDevice("Phone", "")
	if err != nil {
		t.Fatalf("SeedTestDevice() = %v, want nil error", err)
	}
	if info.Label != "Phone" || info.ID == "" {
		t.Fatalf("SeedTestDevice() = %+v, want a labeled device with an ID", info)
	}
	if len(s.ListDevices()) != 1 {
		t.Fatalf("ListDevices() = %v, want exactly one device", s.ListDevices())
	}
}

// TestSeedTestDevice_BaseURLPopulatesSubscribeURL pins the e2e seam
// SLICE B's Settings-row coverage relies on: passing a baseURL through
// SeedTestDevice must produce the same SubscribeURL shape a real
// pairing round trip would.
func TestSeedTestDevice_BaseURLPopulatesSubscribeURL(t *testing.T) {
	t.Setenv(testAllowDeviceSeedEnv, "1")
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s := New(store, slog.New(slog.DiscardHandler))

	info, err := s.SeedTestDevice("Phone", "http://phone-test.local:9000")
	if err != nil {
		t.Fatalf("SeedTestDevice() = %v, want nil error", err)
	}
	if info.SubscribeURL == "" || !strings.HasPrefix(info.SubscribeURL, "http://phone-test.local:9000/") || !strings.HasSuffix(info.SubscribeURL, "/json") {
		t.Fatalf("SubscribeURL = %q, want it built from the given base address", info.SubscribeURL)
	}
}

func TestMintDevice_PersistsOnlyHashNeverRawToken(t *testing.T) {
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s := New(store, slog.New(slog.DiscardHandler))

	token, err := s.mintDevice("Test Device", "", KindDevice)
	if err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}
	if len(s.devices) != 1 {
		t.Fatalf("devices = %v, want exactly one", s.devices)
	}
	d := s.devices[0]
	if d.HashB64 == token || d.SaltB64 == token {
		t.Fatalf("persisted device record contains the raw token: %+v", d)
	}
	if d.HashB64 == "" || d.SaltB64 == "" {
		t.Fatalf("persisted device record missing salt/hash: %+v", d)
	}

	raw, ok := store.Get(devicesSettingsKey).(string)
	if !ok || raw == "" {
		t.Fatalf("devicesSettingsKey not persisted to the settings store")
	}
	if strings.Contains(raw, token) {
		t.Fatalf("settings store payload contains the raw token: %s", raw)
	}
}

func TestValidateToken_AcceptsMintedTokenOnly(t *testing.T) {
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s := New(store, slog.New(slog.DiscardHandler))

	token, err := s.mintDevice("Test Device", "", KindDevice)
	if err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}

	now := time.Now()
	if _, ok := s.validateToken(token, "", KindDevice, now); !ok {
		t.Errorf("validateToken(minted token) = false, want true")
	}
	if _, ok := s.validateToken("not-the-token", "", KindDevice, now); ok {
		t.Errorf("validateToken(wrong token) = true, want false")
	}
	if _, ok := s.validateToken("", "", KindDevice, now); ok {
		t.Errorf("validateToken(empty) = true, want false")
	}
}

func TestListDevices_ExcludesSecrets(t *testing.T) {
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s := New(store, slog.New(slog.DiscardHandler))
	if _, err := s.mintDevice("Phone", "", KindDevice); err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}

	infos := s.ListDevices()
	if len(infos) != 1 || infos[0].Label != "Phone" {
		t.Fatalf("ListDevices() = %+v, want one device labeled Phone", infos)
	}
}

func TestRevokeDevice_UnknownIDReturnsError(t *testing.T) {
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s := New(store, slog.New(slog.DiscardHandler))

	if err := s.RevokeDevice("does-not-exist"); err == nil {
		t.Fatalf("RevokeDevice(unknown id) = nil error, want an error")
	}
}

func TestRenameDevice_RejectsEmptyAndWhitespace(t *testing.T) {
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s := New(store, slog.New(slog.DiscardHandler))
	if _, err := s.mintDevice("Phone", "", KindDevice); err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}
	id := s.ListDevices()[0].ID

	for _, label := range []string{"", "   ", "\t\n"} {
		if err := s.RenameDevice(id, label); err == nil {
			t.Errorf("RenameDevice(%q) = nil error, want an error", label)
		}
	}

	infos := s.ListDevices()
	if len(infos) != 1 || infos[0].Label != "Phone" {
		t.Fatalf("ListDevices() = %+v, want the original label unchanged after a rejected rename", infos)
	}
}

func TestRenameDevice_PersistsTheNewLabel(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store1, err := settings.New(path)
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s1 := New(store1, slog.New(slog.DiscardHandler))
	if _, err := s1.mintDevice("Phone", "", KindDevice); err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}
	id := s1.ListDevices()[0].ID

	if err := s1.RenameDevice(id, "  Ali's iPhone  "); err != nil {
		t.Fatalf("RenameDevice() = %v, want nil error", err)
	}
	infos := s1.ListDevices()
	if len(infos) != 1 || infos[0].Label != "Ali's iPhone" {
		t.Fatalf("ListDevices() = %+v, want the trimmed new label", infos)
	}

	store2, err := settings.New(path)
	if err != nil {
		t.Fatalf("second settings.New() = %v, want nil error", err)
	}
	s2 := New(store2, slog.New(slog.DiscardHandler))
	infos2 := s2.ListDevices()
	if len(infos2) != 1 || infos2[0].Label != "Ali's iPhone" {
		t.Fatalf("ListDevices() after restart = %+v, want the rename to have persisted", infos2)
	}
}

func TestRenameDevice_UnknownIDReturnsError(t *testing.T) {
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s := New(store, slog.New(slog.DiscardHandler))

	if err := s.RenameDevice("does-not-exist", "New Label"); err == nil {
		t.Fatalf("RenameDevice(unknown id) = nil error, want an error")
	}
}

// TestDevices_SurviveAcrossServiceInstances pins that pairing state
// is durable: a restart must not silently unpair every device.
func TestDevices_SurviveAcrossServiceInstances(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store1, err := settings.New(path)
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s1 := New(store1, slog.New(slog.DiscardHandler))
	token, err := s1.mintDevice("Laptop", "", KindDevice)
	if err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}

	store2, err := settings.New(path)
	if err != nil {
		t.Fatalf("second settings.New() = %v, want nil error", err)
	}
	s2 := New(store2, slog.New(slog.DiscardHandler))
	if _, ok := s2.validateToken(token, "", KindDevice, time.Now()); !ok {
		t.Fatalf("a device paired before restart must still validate after restart")
	}
}
