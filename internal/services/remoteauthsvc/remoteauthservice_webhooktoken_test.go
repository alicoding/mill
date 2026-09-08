package remoteauthsvc

import (
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/adapters/settings"
)

// TestMintWebhookToken_ShowsOnceListsForever pins the mint posture the
// Settings surface depends on: the raw token arrives exactly once from
// MintWebhookToken (never from ListWebhookTokens), while the row
// itself persists.
func TestMintWebhookToken_ShowsOnceListsForever(t *testing.T) {
	s := newBrowserTestService(t)

	minted, err := s.MintWebhookToken("CI on the build box")
	if err != nil {
		t.Fatalf("MintWebhookToken() = %v, want nil error", err)
	}
	if minted.Token == "" || minted.DeviceID == "" {
		t.Fatalf("MintWebhookToken() = %+v, want a token and an id", minted)
	}
	if minted.Label != "CI on the build box" {
		t.Fatalf("label = %q, want the minted one", minted.Label)
	}

	tokens := s.ListWebhookTokens()
	if len(tokens) != 1 || tokens[0].ID != minted.DeviceID || tokens[0].Kind != KindWebhookToken {
		t.Fatalf("ListWebhookTokens() = %+v, want exactly the minted token", tokens)
	}
	// A second mint is legitimate (one per tool, or a rotation): its
	// own row, its own token, neither list nor validation confused.
	second, err := s.MintWebhookToken("")
	if err != nil {
		t.Fatalf("MintWebhookToken(empty label) = %v, want nil error", err)
	}
	if second.Label != webhookTokenLabelFallback {
		t.Fatalf("empty-label mint = %q, want the fallback", second.Label)
	}
	if second.Token == minted.Token {
		t.Fatal("two mints returned the same token")
	}
	if got := len(s.ListWebhookTokens()); got != 2 {
		t.Fatalf("ListWebhookTokens() has %d rows, want 2", got)
	}
}

// TestValidateWebhookToken_KindSeparation pins that a webhook
// credential never serves as a browser or device one, and vice versa
// -- the same pair of refusals validateToken's kind check enforces for
// browsers.
func TestValidateWebhookToken_KindSeparation(t *testing.T) {
	s := newBrowserTestService(t)

	minted, err := s.MintWebhookToken("CI")
	if err != nil {
		t.Fatalf("MintWebhookToken() = %v, want nil error", err)
	}
	if _, ok := s.ValidateWebhookToken(minted.Token); !ok {
		t.Fatal("a freshly minted webhook token should validate")
	}
	if _, ok := s.ValidateBrowserToken(minted.Token); ok {
		t.Fatal("a webhook token validated as a browser token")
	}
	s.mu.Lock()
	deviceToken, err := s.mintDevice("Phone", "", KindDevice)
	s.mu.Unlock()
	if err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}
	if _, ok := s.ValidateWebhookToken(deviceToken); ok {
		t.Fatal("a phone's token validated as a webhook token")
	}
}

// TestWebhookToken_RevokeEndsIt pins that Settings' Revoke is the
// un-minting path: the row disappears and the very next webhook post
// with that token is a 401 at the door.
func TestWebhookToken_RevokeEndsIt(t *testing.T) {
	s := newBrowserTestService(t)

	minted, err := s.MintWebhookToken("CI")
	if err != nil {
		t.Fatalf("MintWebhookToken() = %v, want nil error", err)
	}
	if err := s.RevokeDevice(minted.DeviceID); err != nil {
		t.Fatalf("RevokeDevice() = %v, want nil error", err)
	}
	if _, ok := s.ValidateWebhookToken(minted.Token); ok {
		t.Fatal("a revoked webhook token still validates")
	}
	if len(s.ListWebhookTokens()) != 0 {
		t.Fatalf("ListWebhookTokens() after revoke = %v, want empty", s.ListWebhookTokens())
	}
}

// TestListWebhookTokens_NeverMixesOtherKinds pins that Settings' three
// sections read three disjoint lists.
func TestListWebhookTokens_NeverMixesOtherKinds(t *testing.T) {
	s := newBrowserTestService(t)
	if _, err := s.MintWebhookToken("CI"); err != nil {
		t.Fatalf("MintWebhookToken() = %v, want nil error", err)
	}
	s.mu.Lock()
	if _, err := s.mintDevice("Phone", "", KindDevice); err != nil {
		s.mu.Unlock()
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}
	s.mu.Unlock()

	if got := s.ListWebhookTokens(); len(got) != 1 || got[0].Label != "CI" {
		t.Fatalf("ListWebhookTokens() = %+v, want exactly the minted token", got)
	}
	if got := s.ListDevices(); len(got) != 1 || got[0].Label != "Phone" {
		t.Fatalf("ListDevices() = %+v, want exactly the paired phone", got)
	}
	if got := s.ListBrowsers(); len(got) != 0 {
		t.Fatalf("ListBrowsers() = %+v, want empty", got)
	}
}

// TestLoadDevices_MigratesRetiredKindValueToWebhookToken pins goal
// 0387's migration: a device record persisted before this goal with
// Kind "hook" reads back as KindWebhookToken on the next load, with no
// re-mint required, and the migrated record is written back so the
// migration runs at most once per store.
func TestLoadDevices_MigratesRetiredKindValueToWebhookToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store1, err := settings.New(path)
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	s1 := New(store1, slog.New(slog.DiscardHandler))
	s1.mu.Lock()
	token, err := s1.mintDevice("CI", "", "hook")
	s1.mu.Unlock()
	if err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}

	// A second instance backed by the same file models a restart: the
	// persisted record is what loadDevices actually migrates, not the
	// in-memory one mintDevice just wrote.
	store2, err := settings.New(path)
	if err != nil {
		t.Fatalf("second settings.New() = %v, want nil error", err)
	}
	s2 := New(store2, slog.New(slog.DiscardHandler))
	tokens := s2.ListWebhookTokens()
	if len(tokens) != 1 || tokens[0].Kind != KindWebhookToken {
		t.Fatalf("ListWebhookTokens() after reload = %+v, want one row with Kind %q", tokens, KindWebhookToken)
	}
	if _, ok := s2.ValidateWebhookToken(token); !ok {
		t.Fatal("a token minted under the retired kind value should still validate after migration")
	}

	// A third instance proves the migrated Kind was persisted, not
	// re-derived in memory on every load.
	store3, err := settings.New(path)
	if err != nil {
		t.Fatalf("third settings.New() = %v, want nil error", err)
	}
	s3 := New(store3, slog.New(slog.DiscardHandler))
	if got := s3.ListWebhookTokens(); len(got) != 1 || got[0].Kind != KindWebhookToken {
		t.Fatalf("ListWebhookTokens() after a second reload = %+v, want the migration to have persisted", got)
	}
}
