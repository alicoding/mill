package remoteauthsvc

import "testing"

// TestListDeviceRefs_ListsAllThreeKindsWithAccepts pins docs/goals/
// 0372's directory shape: every paired phone, browser, and webhook
// token appears, each carrying the Accepts vocabulary its kind
// declares (deviceAccepts) -- not remoteauthsvc's own storage-level
// Kind string.
func TestListDeviceRefs_ListsAllThreeKindsWithAccepts(t *testing.T) {
	s := newTestService(t)
	if _, err := s.mintDevice("Phone", "", KindDevice); err != nil {
		t.Fatalf("mintDevice(phone) = %v, want nil error", err)
	}
	if _, err := s.mintDevice("Chrome", "", KindBrowser); err != nil {
		t.Fatalf("mintDevice(browser) = %v, want nil error", err)
	}
	if _, err := s.MintHookToken("CI"); err != nil {
		t.Fatalf("MintHookToken() = %v, want nil error", err)
	}

	refs := s.ListDeviceRefs(nil)
	if len(refs) != 3 {
		t.Fatalf("ListDeviceRefs(nil) = %d refs, want 3", len(refs))
	}

	byLabel := map[string][]string{}
	for _, r := range refs {
		byLabel[r.Label] = r.Accepts
	}
	if got := byLabel["Phone"]; len(got) != 1 || got[0] != "notification" {
		t.Errorf("phone Accepts = %v, want [notification]", got)
	}
	if got := byLabel["Chrome"]; len(got) != 1 || got[0] != "browser-replay" {
		t.Errorf("browser Accepts = %v, want [browser-replay]", got)
	}
	if got := byLabel["CI"]; len(got) != 0 {
		t.Errorf("webhook token Accepts = %v, want empty", got)
	}
}

// TestListDeviceRefs_FiltersByNeeds pins the "declared need" half of
// the OptionsSource contract: only refs accepting at least one of
// needs are returned.
func TestListDeviceRefs_FiltersByNeeds(t *testing.T) {
	s := newTestService(t)
	if _, err := s.mintDevice("Phone", "", KindDevice); err != nil {
		t.Fatalf("mintDevice(phone) = %v, want nil error", err)
	}
	if _, err := s.MintHookToken("CI"); err != nil {
		t.Fatalf("MintHookToken() = %v, want nil error", err)
	}

	refs := s.ListDeviceRefs([]string{"notification"})
	if len(refs) != 1 || refs[0].Label != "Phone" {
		t.Fatalf("ListDeviceRefs([notification]) = %+v, want only the phone", refs)
	}
}
