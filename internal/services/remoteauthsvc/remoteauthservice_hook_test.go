package remoteauthsvc

import "testing"

// TestMintHookToken_ShowsOnceListsForever pins the mint posture the
// Settings surface depends on: the raw token arrives exactly once from
// MintHookToken (never from ListHooks), while the row itself persists.
func TestMintHookToken_ShowsOnceListsForever(t *testing.T) {
	s := newBrowserTestService(t)

	hook, err := s.MintHookToken("CI on the build box")
	if err != nil {
		t.Fatalf("MintHookToken() = %v, want nil error", err)
	}
	if hook.Token == "" || hook.DeviceID == "" {
		t.Fatalf("MintHookToken() = %+v, want a token and an id", hook)
	}
	if hook.Label != "CI on the build box" {
		t.Fatalf("label = %q, want the minted one", hook.Label)
	}

	hooks := s.ListHooks()
	if len(hooks) != 1 || hooks[0].ID != hook.DeviceID || hooks[0].Kind != KindHook {
		t.Fatalf("ListHooks() = %+v, want exactly the minted hook", hooks)
	}
	// A second mint is legitimate (one per tool, or a rotation): its
	// own row, its own token, neither list nor validation confused.
	second, err := s.MintHookToken("")
	if err != nil {
		t.Fatalf("MintHookToken(empty label) = %v, want nil error", err)
	}
	if second.Label != hookLabelFallback {
		t.Fatalf("empty-label mint = %q, want the fallback", second.Label)
	}
	if second.Token == hook.Token {
		t.Fatal("two mints returned the same token")
	}
	if got := len(s.ListHooks()); got != 2 {
		t.Fatalf("ListHooks() has %d rows, want 2", got)
	}
}

// TestValidateHookToken_KindSeparation pins that a hook credential
// never serves as a browser or device one, and vice versa -- the same
// pair of refusals validateToken's kind check enforces for browsers.
func TestValidateHookToken_KindSeparation(t *testing.T) {
	s := newBrowserTestService(t)

	hook, err := s.MintHookToken("CI")
	if err != nil {
		t.Fatalf("MintHookToken() = %v, want nil error", err)
	}
	if _, ok := s.ValidateHookToken(hook.Token); !ok {
		t.Fatal("a freshly minted hook token should validate")
	}
	if _, ok := s.ValidateBrowserToken(hook.Token); ok {
		t.Fatal("a hook token validated as a browser token")
	}
	s.mu.Lock()
	deviceToken, err := s.mintDevice("Phone", "", KindDevice)
	s.mu.Unlock()
	if err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}
	if _, ok := s.ValidateHookToken(deviceToken); ok {
		t.Fatal("a phone's token validated as a hook token")
	}
}

// TestHookToken_RevokeEndsIt pins that Settings' Revoke is the
// un-minting path: the row disappears and the very next hook post with
// that token is a 401 at the door.
func TestHookToken_RevokeEndsIt(t *testing.T) {
	s := newBrowserTestService(t)

	hook, err := s.MintHookToken("CI")
	if err != nil {
		t.Fatalf("MintHookToken() = %v, want nil error", err)
	}
	if err := s.RevokeDevice(hook.DeviceID); err != nil {
		t.Fatalf("RevokeDevice() = %v, want nil error", err)
	}
	if _, ok := s.ValidateHookToken(hook.Token); ok {
		t.Fatal("a revoked hook token still validates")
	}
	if len(s.ListHooks()) != 0 {
		t.Fatalf("ListHooks() after revoke = %v, want empty", s.ListHooks())
	}
}

// TestListHooks_NeverMixesOtherKinds pins that Settings' three sections
// read three disjoint lists.
func TestListHooks_NeverMixesOtherKinds(t *testing.T) {
	s := newBrowserTestService(t)
	if _, err := s.MintHookToken("CI"); err != nil {
		t.Fatalf("MintHookToken() = %v, want nil error", err)
	}
	s.mu.Lock()
	if _, err := s.mintDevice("Phone", "", KindDevice); err != nil {
		s.mu.Unlock()
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}
	s.mu.Unlock()

	if got := s.ListHooks(); len(got) != 1 || got[0].Label != "CI" {
		t.Fatalf("ListHooks() = %+v, want exactly the minted hook", got)
	}
	if got := s.ListDevices(); len(got) != 1 || got[0].Label != "Phone" {
		t.Fatalf("ListDevices() = %+v, want exactly the paired phone", got)
	}
	if got := s.ListBrowsers(); len(got) != 0 {
		t.Fatalf("ListBrowsers() = %+v, want empty", got)
	}
}
