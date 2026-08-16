package configuresvc

import "testing"

// TestPublishList_FreezesVersionAndAdvancesPublishedVersion mirrors
// PublishDecision's own proof shape (configuredecision_test.go's
// TestUpdateDecision_PreservesVersionsAndPublishedVersion sibling):
// Publish snapshots the current Columns+Rows as v1 and sets
// PublishedVersion, without disturbing the live draft itself.
func TestPublishList_FreezesVersionAndAdvancesPublishedVersion(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	l, err := cfg.CreateList("Tracker", "", trackerColumns())
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	if _, err := cfg.AddListRow(l.ID, map[string]string{"task": "Set up", "count": "1"}); err != nil {
		t.Fatalf("AddListRow: %v", err)
	}

	published, err := cfg.PublishList(l.ID)
	if err != nil {
		t.Fatalf("PublishList: %v", err)
	}
	if published.PublishedVersion != 1 {
		t.Fatalf("PublishedVersion = %d, want 1", published.PublishedVersion)
	}
	if len(published.Versions) != 1 || len(published.Versions[0].Rows) != 1 {
		t.Fatalf("Versions = %+v, want one v1 snapshot with one row", published.Versions)
	}
	if len(published.Rows) != 1 {
		t.Fatalf("live Rows = %+v, want the draft unchanged by Publish", published.Rows)
	}

	// A live edit after Publish must never reach back and mutate the
	// frozen v1 snapshot (docs/adr/0040 decision 4).
	if _, err := cfg.AddListRow(l.ID, map[string]string{"task": "Second", "count": "2"}); err != nil {
		t.Fatalf("AddListRow (post-publish): %v", err)
	}
	after := cfg.Lists()[0]
	if len(after.Rows) != 2 {
		t.Fatalf("live Rows after a post-publish edit = %d, want 2", len(after.Rows))
	}
	if len(after.Versions[0].Rows) != 1 {
		t.Fatalf("v1 snapshot Rows = %d after a live edit, want 1 (frozen, unaffected)", len(after.Versions[0].Rows))
	}
}

func TestPublishList_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.PublishList("does-not-exist"); err == nil {
		t.Fatal("PublishList against an unknown list returned nil error, want a rejection")
	}
}
