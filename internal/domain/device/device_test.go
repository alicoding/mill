package device

import "testing"

func TestFilter_EmptyNeedsReturnsEverything(t *testing.T) {
	refs := []Ref{
		{ID: "phone-1", Kind: KindPhone, Accepts: []string{"notification"}},
		{ID: "hook-1", Kind: KindWebhookToken, Accepts: nil},
	}
	got := Filter(refs, nil)
	if len(got) != len(refs) {
		t.Fatalf("Filter(nil needs) = %d refs, want %d (unfiltered)", len(got), len(refs))
	}
}

func TestFilter_KeepsOnlyRefsAcceptingAtLeastOneNeed(t *testing.T) {
	refs := []Ref{
		{ID: "phone-1", Kind: KindPhone, Accepts: []string{"notification"}},
		{ID: "browser-1", Kind: KindBrowser, Accepts: []string{"browser-replay"}},
		{ID: "hook-1", Kind: KindWebhookToken, Accepts: []string{}},
	}
	got := Filter(refs, []string{"notification"})
	if len(got) != 1 || got[0].ID != "phone-1" {
		t.Fatalf("Filter(needs=[notification]) = %+v, want only phone-1", got)
	}
}
