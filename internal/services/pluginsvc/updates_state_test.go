package pluginsvc

import (
	"encoding/json"
	"testing"
)

// The persisted shape round-trips through the state file.
func TestUpdateCheck_RoundTripsThroughState(t *testing.T) {
	svc, _ := newStoreService(t)
	writePlugin(t, svc.dir, "a", `{"id":"a","name":"A","version":"1.0.0"}`, nil)
	want := UpdateCheck{CheckedAt: "2026-01-01T00:00:00Z", Candidates: []UpdateCandidate{{ID: "a", Installed: "1.0.0", Available: "1.2.0", Tier: TierHashPinned}}, Problems: []string{}}
	_, err := svc.mutateState(func(st *marketplaceState) error {
		st.Updates = want
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.ListUpdates()
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(want)
	b, _ := json.Marshal(got)
	if string(a) != string(b) {
		t.Errorf("round trip = %s, want %s", b, a)
	}
}
