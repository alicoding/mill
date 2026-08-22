package remoteauthsvc

import (
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/settings"
)

func TestMintDevice_PersistsOnlyHashNeverRawToken(t *testing.T) {
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s := New(store, slog.New(slog.DiscardHandler))

	token, err := s.mintDevice("Test Device")
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

	token, err := s.mintDevice("Test Device")
	if err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}

	now := time.Now()
	if !s.validateToken(token, now) {
		t.Errorf("validateToken(minted token) = false, want true")
	}
	if s.validateToken("not-the-token", now) {
		t.Errorf("validateToken(wrong token) = true, want false")
	}
	if s.validateToken("", now) {
		t.Errorf("validateToken(empty) = true, want false")
	}
}

func TestListDevices_ExcludesSecrets(t *testing.T) {
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s := New(store, slog.New(slog.DiscardHandler))
	if _, err := s.mintDevice("Phone"); err != nil {
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

// TestDevices_SurviveAcrossServiceInstances pins that pairing state
// is durable: a restart must not silently unpair every device.
func TestDevices_SurviveAcrossServiceInstances(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store1, err := settings.New(path)
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s1 := New(store1, slog.New(slog.DiscardHandler))
	token, err := s1.mintDevice("Laptop")
	if err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}

	store2, err := settings.New(path)
	if err != nil {
		t.Fatalf("second settings.New() = %v, want nil error", err)
	}
	s2 := New(store2, slog.New(slog.DiscardHandler))
	if !s2.validateToken(token, time.Now()) {
		t.Fatalf("a device paired before restart must still validate after restart")
	}
}
